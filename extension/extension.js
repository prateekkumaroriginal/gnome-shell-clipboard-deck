import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const HISTORY_LIMIT = 200;
const MAX_ITEM_CHARS = 20_000;
const POPUP_WIDTH = 440;
const POPUP_HEIGHT = 580;
const SAVE_DELAY_MS = 250;
const PASTE_DELAY_MS = 90;

const Clipboard = St.Clipboard.get_default();

function compactPreview(text) {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 180 ? `${compact.slice(0, 179)}…` : compact;
}

class HistoryStore {
    constructor(uuid) {
        this._directory = GLib.build_filenamev([GLib.get_user_cache_dir(), uuid]);
        this._path = GLib.build_filenamev([this._directory, 'history.json']);
        this._file = Gio.File.new_for_path(this._path);
        this._saveSource = 0;
        this.items = [];
    }

    load() {
        try {
            const [ok, contents] = GLib.file_get_contents(this._path);
            if (!ok)
                return;

            const parsed = JSON.parse(new TextDecoder().decode(contents));
            if (!Array.isArray(parsed))
                return;

            this.items = parsed
                .filter(item => item && typeof item.text === 'string')
                .map(item => ({
                    id: typeof item.id === 'string' ? item.id : GLib.uuid_string_random(),
                    text: item.text.slice(0, MAX_ITEM_CHARS),
                    pinned: Boolean(item.pinned),
                    createdAt: Number(item.createdAt) || Date.now(),
                }));
            this._prune();
        } catch (error) {
            console.warn(`Clipboard: could not load history: ${error.message}`);
            this.items = [];
        }
    }

    add(text) {
        text = text.slice(0, MAX_ITEM_CHARS);
        const existingIndex = this.items.findIndex(item => item.text === text);
        let item;

        if (existingIndex >= 0)
            item = this.items.splice(existingIndex, 1)[0];
        else
            item = {id: GLib.uuid_string_random(), text, pinned: false, createdAt: 0};

        item.createdAt = Date.now();
        this.items.unshift(item);
        this._prune();
        this.scheduleSave();
        return item;
    }

    togglePinned(id) {
        const item = this.items.find(candidate => candidate.id === id);
        if (!item)
            return;
        item.pinned = !item.pinned;
        this.scheduleSave();
    }

    remove(id) {
        this.items = this.items.filter(item => item.id !== id);
        this.scheduleSave();
    }

    ordered() {
        return [...this.items].sort((a, b) => {
            if (a.pinned !== b.pinned)
                return a.pinned ? -1 : 1;
            return b.createdAt - a.createdAt;
        });
    }

    scheduleSave() {
        if (this._saveSource)
            GLib.Source.source_remove(this._saveSource);

        this._saveSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT_IDLE,
            SAVE_DELAY_MS,
            () => {
                this._saveSource = 0;
                this._saveAsync();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    flush() {
        if (this._saveSource) {
            GLib.Source.source_remove(this._saveSource);
            this._saveSource = 0;
        }

        try {
            GLib.mkdir_with_parents(this._directory, 0o700);
            GLib.file_set_contents(this._path, JSON.stringify(this.items));
        } catch (error) {
            console.warn(`Clipboard: could not save history: ${error.message}`);
        }
    }

    _prune() {
        const pinned = this.items.filter(item => item.pinned);
        const recent = this.items
            .filter(item => !item.pinned)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, HISTORY_LIMIT);
        this.items = [...pinned, ...recent];
    }

    _saveAsync() {
        try {
            GLib.mkdir_with_parents(this._directory, 0o700);
            const bytes = new TextEncoder().encode(JSON.stringify(this.items));
            this._file.replace_contents_async(
                bytes,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null,
                (file, result) => {
                    try {
                        file.replace_contents_finish(result);
                    } catch (error) {
                        console.warn(`Clipboard: async save failed: ${error.message}`);
                    }
                }
            );
        } catch (error) {
            console.warn(`Clipboard: could not schedule save: ${error.message}`);
        }
    }
}

class ClipboardPopup {
    constructor(extension) {
        this._extension = extension;
        this._isOpen = false;
        this._selectedIndex = 0;
        this._visibleItems = [];
        this._rows = [];
        this._grab = null;
        this._toastSource = 0;
        this._caretSource = 0;
        this._caretVisible = false;
        this._signalIds = [];
        this._build();
    }

    destroy() {
        this.close(false);
        if (this._toastSource) {
            GLib.Source.source_remove(this._toastSource);
            this._toastSource = 0;
        }
        this._overlay.destroy();
    }

    toggle() {
        if (this._isOpen)
            this.close();
        else
            this.open();
    }

    open() {
        if (this._isOpen)
            return;

        this._position();
        this._previousWindow = global.display.focus_window;
        this._search.set_text('');
        this._selectedIndex = 0;
        this._render();
        this._overlay.visible = true;
        this._overlay.opacity = 0;
        this._popup.scale_x = 0.98;
        this._popup.scale_y = 0.98;

        const grab = Main.pushModal(this._overlay);
        if (!grab || (grab.get_seat_state() & Clutter.GrabState.KEYBOARD) === 0) {
            if (grab)
                Main.popModal(grab);
            this._overlay.visible = false;
            Main.notify('Clipboard', 'Could not open the keyboard popup.');
            return;
        }

        this._grab = grab;
        this._isOpen = true;
        this._focusSearch();
        this._overlay.ease({
            opacity: 255,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._popup.ease({
            scale_x: 1,
            scale_y: 1,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    close(animate = true) {
        if (!this._isOpen && !this._overlay.visible)
            return;

        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._isOpen = false;
        this._stopCaretBlink();
        global.display.set_cursor(Meta.Cursor.DEFAULT);

        if (!animate) {
            this._overlay.visible = false;
            this._overlay.opacity = 0;
            return;
        }

        this._overlay.ease({
            opacity: 0,
            duration: 110,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._isOpen)
                    this._overlay.visible = false;
            },
        });
    }

    refresh() {
        if (this._isOpen)
            this._render();
    }

    _build() {
        this._overlay = new St.Widget({
            style_class: 'wc-overlay',
            reactive: true,
            visible: false,
            layout_manager: new Clutter.FixedLayout(),
        });

        this._backdrop = new St.Button({
            style_class: 'wc-backdrop',
            reactive: true,
            can_focus: false,
            x_expand: true,
            y_expand: true,
        });
        this._backdrop.connect('clicked', () => this.close());
        this._usePointerCursor(this._backdrop);
        this._overlay.add_child(this._backdrop);

        this._popup = new St.BoxLayout({
            style_class: 'wc-popup',
            vertical: true,
            reactive: true,
        });
        this._overlay.add_child(this._popup);

        const header = new St.BoxLayout({
            style_class: 'wc-header',
            x_expand: true,
        });
        header.add_child(new St.Label({
            style_class: 'wc-title',
            text: 'Clipboard',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(new St.Widget({x_expand: true}));

        this._pauseButton = new St.Button({
            style_class: 'wc-pause-button',
            can_focus: true,
            toggle_mode: true,
            accessible_name: 'Pause clipboard capture',
            child: new St.Icon({icon_name: 'media-playback-pause-symbolic'}),
        });
        this._pauseButton.connect('clicked', () => {
            this._extension.paused = !this._extension.paused;
            this._pauseButton.checked = this._extension.paused;
            this._pauseButton.accessible_name = this._extension.paused
                ? 'Resume clipboard capture'
                : 'Pause clipboard capture';
            this._render();
            this._focusSearch();
        });
        this._usePointerCursor(this._pauseButton);
        header.add_child(this._pauseButton);
        this._popup.add_child(header);

        this._search = new St.Entry({
            style_class: 'wc-search',
            hint_text: 'Search copied items',
            can_focus: true,
            x_expand: true,
        });
        this._search.clutter_text.connect('text-changed', () => {
            this._selectedIndex = 0;
            this._render();
        });
        this._popup.add_child(this._search);

        this._scroll = new St.ScrollView({
            style_class: 'wc-scroll',
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        this._list = new St.BoxLayout({
            style_class: 'wc-list',
            vertical: true,
            x_expand: true,
        });
        this._scroll.set_child(this._list);
        this._popup.add_child(this._scroll);

        const footer = new St.BoxLayout({
            style_class: 'wc-footer',
            x_expand: true,
        });
        for (const hint of ['↑↓  Navigate', 'Enter  Paste', 'Esc  Close'])
            footer.add_child(new St.Label({style_class: 'wc-hint', text: hint}));
        this._popup.add_child(footer);

        this._overlay.connect('key-press-event', (_actor, event) =>
            this._onKeyPress(event));
        this._search.clutter_text.connect('key-press-event', (_actor, event) =>
            this._onKeyPress(event));

        Main.layoutManager.uiGroup.add_child(this._overlay);
    }

    _position() {
        const monitor = Main.layoutManager.currentMonitor ??
            Main.layoutManager.primaryMonitor;
        this._overlay.set_position(monitor.x, monitor.y);
        this._overlay.set_size(monitor.width, monitor.height);
        this._backdrop.set_size(monitor.width, monitor.height);
        this._popup.set_position(
            Math.round((monitor.width - POPUP_WIDTH) / 2),
            Math.max(48, Math.round(monitor.height * 0.42 - POPUP_HEIGHT / 2))
        );
        this._popup.set_size(POPUP_WIDTH, Math.min(
            POPUP_HEIGHT,
            Math.max(420, monitor.height - 96)
        ));
    }

    _render() {
        this._list.destroy_all_children();
        this._rows = [];

        const query = this._search.get_text().trim().toLocaleLowerCase();
        this._visibleItems = this._extension.store.ordered().filter(item =>
            !query || item.text.toLocaleLowerCase().includes(query)
        );

        if (this._extension.paused || this._visibleItems.length === 0) {
            const text = this._extension.paused
                ? 'Capture is paused. Your saved history is still available after you resume.'
                : query
                    ? 'No copied items match this search.'
                    : 'Copy something, then press Super+V to find it here.';
            this._list.add_child(new St.Label({
                style_class: 'wc-empty',
                text,
                x_expand: true,
            }));
            this._selectedIndex = -1;
            return;
        }

        this._selectedIndex = Math.min(
            Math.max(0, this._selectedIndex),
            this._visibleItems.length - 1
        );

        for (const [index, item] of this._visibleItems.entries()) {
            const row = new St.BoxLayout({
                style_class: 'wc-item',
                reactive: true,
                x_expand: true,
            });

            const mainButton = new St.Button({
                style_class: 'wc-item-main',
                can_focus: false,
                x_expand: true,
                accessible_name: `Paste ${compactPreview(item.text)}`,
            });
            const content = new St.BoxLayout({x_expand: true});
            const preview = new St.Label({
                style_class: 'wc-preview',
                text: compactPreview(item.text),
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            preview.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            content.add_child(preview);
            mainButton.set_child(content);
            mainButton.connect('clicked', () => this._activate(item, true));
            this._usePointerCursor(mainButton);
            row.add_child(mainButton);

            const pinIcon = new St.Icon({
                gicon: new Gio.FileIcon({
                    file: Gio.File.new_for_path(GLib.build_filenamev([
                        this._extension.path,
                        'icons',
                        item.pinned
                            ? 'pin-filled-symbolic.svg'
                            : 'pin-outline-symbolic.svg',
                    ])),
                }),
                icon_size: 14,
            });
            pinIcon.set_pivot_point(0.5, 0.5);
            pinIcon.rotation_angle_z = 45;

            const pinButton = new St.Button({
                style_class: 'wc-pin',
                can_focus: false,
                toggle_mode: true,
                checked: item.pinned,
                accessible_name: item.pinned ? 'Unpin item' : 'Pin item',
                y_align: Clutter.ActorAlign.START,
                child: pinIcon,
            });
            pinButton.connect('clicked', () => {
                this._extension.store.togglePinned(item.id);
                this._render();
                this._focusSearch();
            });
            this._usePointerCursor(pinButton);
            row.add_child(pinButton);

            if (index === this._selectedIndex)
                row.add_style_pseudo_class('selected');

            this._list.add_child(row);
            this._rows.push(row);
        }
    }

    _usePointerCursor(actor) {
        actor.track_hover = true;
        actor.connect('notify::hover', () => {
            global.display.set_cursor(
                actor.hover ? Meta.Cursor.POINTING_HAND : Meta.Cursor.DEFAULT
            );
        });
        actor.connect('destroy', () => {
            if (actor.hover)
                global.display.set_cursor(Meta.Cursor.DEFAULT);
        });
    }

    _focusSearch() {
        if (!this._isOpen)
            return;

        global.stage.set_key_focus(this._search.clutter_text);
        this._startCaretBlink();
    }

    _startCaretBlink() {
        this._stopCaretBlink();
        this._caretVisible = true;
        this._search.clutter_text.set_cursor_visible(true);
        this._caretSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            530,
            () => {
                if (!this._isOpen) {
                    this._caretSource = 0;
                    return GLib.SOURCE_REMOVE;
                }

                const searchText = this._search.clutter_text;
                if (global.stage.get_key_focus() !== searchText) {
                    this._caretVisible = false;
                    searchText.set_cursor_visible(false);
                    return GLib.SOURCE_CONTINUE;
                }

                this._caretVisible = !this._caretVisible;
                searchText.set_cursor_visible(this._caretVisible);
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _stopCaretBlink() {
        if (this._caretSource) {
            GLib.Source.source_remove(this._caretSource);
            this._caretSource = 0;
        }

        this._caretVisible = false;
        if (this._search)
            this._search.clutter_text.set_cursor_visible(false);
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const control = Boolean(state & Clutter.ModifierType.CONTROL_MASK);
        const shift = Boolean(state & Clutter.ModifierType.SHIFT_MASK);

        if (symbol === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }

        if (symbol === Clutter.KEY_Down || symbol === Clutter.KEY_Up) {
            if (this._visibleItems.length === 0)
                return Clutter.EVENT_STOP;
            const delta = symbol === Clutter.KEY_Down ? 1 : -1;
            this._selectedIndex = (
                this._selectedIndex + delta + this._visibleItems.length
            ) % this._visibleItems.length;
            this._updateSelection();
            return Clutter.EVENT_STOP;
        }

        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            const item = this._visibleItems[this._selectedIndex];
            if (item)
                this._activate(item, !shift);
            return Clutter.EVENT_STOP;
        }

        if (symbol === Clutter.KEY_Delete) {
            const item = this._visibleItems[this._selectedIndex];
            if (item) {
                this._extension.store.remove(item.id);
                this._render();
            }
            return Clutter.EVENT_STOP;
        }

        if (control && (symbol === Clutter.KEY_p || symbol === Clutter.KEY_P)) {
            const item = this._visibleItems[this._selectedIndex];
            if (item) {
                this._extension.store.togglePinned(item.id);
                this._render();
            }
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _updateSelection() {
        for (const [index, row] of this._rows.entries()) {
            if (index === this._selectedIndex)
                row.add_style_pseudo_class('selected');
            else
                row.remove_style_pseudo_class('selected');
        }

        const selected = this._rows[this._selectedIndex];
        if (selected)
            ensureActorVisibleInScrollView(this._scroll, selected);
    }

    _activate(item, paste) {
        this._extension.store.add(item.text);
        this._extension.setClipboard(item.text);
        this.close();
        if (paste)
            this._extension.schedulePaste(this._previousWindow);
    }
}

export default class ClipboardExtension extends Extension {
    enable() {
        this.paused = false;
        this.settings = this.getSettings();
        this.store = new HistoryStore(this.uuid);
        this.store.load();
        this.popup = new ClipboardPopup(this);
        this._pasteSource = 0;

        this._selection = Shell.Global.get().get_display().get_selection();
        this._selectionSignal = this._selection.connect(
            'owner-changed',
            (_selection, selectionType) => {
                if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD)
                    this._captureClipboard();
            }
        );
        this._sessionSignal = Main.sessionMode.connect('updated', () => {
            if (Main.sessionMode.isLocked)
                this.popup?.close(false);
        });

        Main.wm.addKeybinding(
            'toggle-popup',
            this.settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => this.popup.toggle()
        );

        this._captureClipboard();
    }

    disable() {
        Main.wm.removeKeybinding('toggle-popup');

        if (this._selectionSignal) {
            this._selection.disconnect(this._selectionSignal);
            this._selectionSignal = 0;
        }
        this._selection = null;

        if (this._sessionSignal) {
            Main.sessionMode.disconnect(this._sessionSignal);
            this._sessionSignal = 0;
        }

        if (this._pasteSource) {
            GLib.Source.source_remove(this._pasteSource);
            this._pasteSource = 0;
        }

        this.popup?.destroy();
        this.popup = null;
        this.store?.flush();
        this.store = null;
        this.settings = null;
    }

    setClipboard(text) {
        Clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
    }

    schedulePaste(expectedWindow) {
        if (this._pasteSource)
            GLib.Source.source_remove(this._pasteSource);

        this._pasteSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            PASTE_DELAY_MS,
            () => {
                this._pasteSource = 0;
                if (expectedWindow && global.display.focus_window === expectedWindow)
                    this._sendShiftInsert();
                else
                    Main.notify('Clipboard', 'Copied. Press Ctrl+V to paste.');
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _captureClipboard() {
        if (this.paused || Main.sessionMode.isLocked)
            return;

        Clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => {
            if (!this.store || this.paused || Main.sessionMode.isLocked || !text)
                return;

            if (!text.trim() || text.length > MAX_ITEM_CHARS)
                return;

            this.store.add(text);
            this.popup?.refresh();
        });
    }

    _sendShiftInsert() {
        try {
            const keyboard = Clutter.get_default_backend()
                .get_default_seat()
                .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            const time = Clutter.get_current_event_time() * 1000;
            const shiftLeft = 42;
            const insert = 110;

            keyboard.notify_key(time, shiftLeft, Clutter.KeyState.PRESSED);
            keyboard.notify_key(time, insert, Clutter.KeyState.PRESSED);
            keyboard.notify_key(time, insert, Clutter.KeyState.RELEASED);
            keyboard.notify_key(time, shiftLeft, Clutter.KeyState.RELEASED);
        } catch (error) {
            console.warn(`Clipboard: direct paste unavailable: ${error.message}`);
            Main.notify('Clipboard', 'Copied. Press Ctrl+V to paste.');
        }
    }
}
