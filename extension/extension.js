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
const MAX_NICKNAME_CHARS = 80;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_CACHE_LIMIT = 250 * 1024 * 1024;
const POPUP_WIDTH = 440;
const POPUP_HEIGHT = 580;
const SAVE_DELAY_MS = 250;
const PASTE_DELAY_MS = 90;
const PASTE_FOCUS_RETRIES = 5;
const IMAGE_MIME_TYPES = new Map([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['image/bmp', 'bmp'],
]);

function compactPreview(text) {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 180 ? `${compact.slice(0, 179)}…` : compact;
}

class HistoryStore {
    constructor(uuid) {
        this._directory = GLib.build_filenamev([GLib.get_user_cache_dir(), uuid]);
        this._imageDirectory = GLib.build_filenamev([this._directory, 'images']);
        this._path = GLib.build_filenamev([this._directory, 'history.json']);
        this._file = Gio.File.new_for_path(this._path);
        this._saveSource = 0;
        this.items = [];
    }

    loadAsync(onLoaded) {
        this._file.load_contents_async(null, (file, result) => {
            try {
                const [ok, contents] = file.load_contents_finish(result);
                if (ok) {
                    const parsed = JSON.parse(new TextDecoder().decode(contents));
                    if (Array.isArray(parsed)) {
                        this.items = parsed
                            .map(item => this._deserialize(item))
                            .filter(item => item !== null);
                        this._prune();
                    }
                }
            } catch (error) {
                if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                    console.warn(`Clipboard Deck: could not load history: ${error.message}`);
                this.items = [];
            }

            onLoaded();
        });
    }

    add(text) {
        text = text.slice(0, MAX_ITEM_CHARS);
        const existingIndex = this.items.findIndex(item =>
            item.type === 'text' && item.text === text);
        let item;

        if (existingIndex >= 0)
            item = this.items.splice(existingIndex, 1)[0];
        else
            item = {
                id: GLib.uuid_string_random(),
                type: 'text',
                text,
                pinned: false,
                createdAt: 0,
            };

        item.createdAt = Date.now();
        this.items.unshift(item);
        this._prune();
        this.scheduleSave();
        return item;
    }

    addImage(mimeType, bytes, onAdded) {
        const extension = IMAGE_MIME_TYPES.get(mimeType);
        const byteSize = bytes.get_size();
        if (!extension || byteSize <= 0 || byteSize > MAX_IMAGE_BYTES)
            return;

        const checksum = GLib.compute_checksum_for_bytes(
            GLib.ChecksumType.SHA256,
            bytes
        );
        const fileName = `${checksum}.${extension}`;
        const path = GLib.build_filenamev([this._imageDirectory, fileName]);
        try {
            GLib.mkdir_with_parents(this._imageDirectory, 0o700);
            Gio.File.new_for_path(path).replace_contents_async(
                bytes.get_data(),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null,
                (file, result) => {
                    try {
                        file.replace_contents_finish(result);
                        GLib.chmod(path, 0o600);
                    } catch (error) {
                        console.warn(`Clipboard Deck: image save failed: ${error.message}`);
                        return;
                    }

                    let item;
                    const currentIndex = this.items.findIndex(candidate =>
                        candidate.type === 'image' &&
                        candidate.checksum === checksum);
                    if (currentIndex >= 0)
                        item = this.items.splice(currentIndex, 1)[0];
                    else
                        item = {
                            id: GLib.uuid_string_random(),
                            type: 'image',
                            checksum,
                            pinned: false,
                            createdAt: 0,
                        };

                    item.mimeType = mimeType;
                    item.fileName = fileName;
                    item.byteSize = byteSize;
                    item.createdAt = Date.now();
                    this.items.unshift(item);
                    this._prune();
                    this.scheduleSave();
                    onAdded?.(item);
                }
            );
        } catch (error) {
            console.warn(`Clipboard Deck: could not save image: ${error.message}`);
        }
    }

    imagePath(item) {
        return GLib.build_filenamev([this._imageDirectory, item.fileName]);
    }

    togglePinned(id) {
        const item = this.items.find(candidate => candidate.id === id);
        if (!item)
            return;
        item.pinned = !item.pinned;
        this.scheduleSave();
    }

    setNickname(id, nickname) {
        const item = this.items.find(candidate => candidate.id === id);
        if (!item)
            return;

        nickname = nickname.trim().slice(0, MAX_NICKNAME_CHARS);
        if (nickname)
            item.nickname = nickname;
        else
            delete item.nickname;
        this.scheduleSave();
    }

    remove(id) {
        const item = this.items.find(candidate => candidate.id === id);
        this.items = this.items.filter(candidate => candidate.id !== id);
        if (item?.type === 'image')
            this._deleteImageIfUnused(item);
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
            GLib.Source.remove(this._saveSource);

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
            GLib.Source.remove(this._saveSource);
            this._saveSource = 0;
        }

        this._saveAsync();
    }

    _prune() {
        const ordered = [
            ...this.items
            .filter(item => item.pinned)
            .sort((a, b) => b.createdAt - a.createdAt),
            ...this.items
            .filter(item => !item.pinned)
            .sort((a, b) => b.createdAt - a.createdAt),
        ];
        const kept = [];
        const removedImages = [];
        let imageBytes = 0;

        for (const item of ordered) {
            const nextImageBytes = imageBytes +
                (item.type === 'image' ? item.byteSize : 0);
            if (kept.length >= HISTORY_LIMIT ||
                nextImageBytes > IMAGE_CACHE_LIMIT) {
                if (item.type === 'image')
                    removedImages.push(item);
                continue;
            }
            kept.push(item);
            imageBytes = nextImageBytes;
        }
        this.items = kept;
        for (const item of removedImages)
            this._deleteImageIfUnused(item);
    }

    _deserialize(item) {
        if (!item || typeof item !== 'object')
            return null;

        const common = {
            id: typeof item.id === 'string'
                ? item.id
                : GLib.uuid_string_random(),
            pinned: Boolean(item.pinned),
            createdAt: Number(item.createdAt) || Date.now(),
        };
        if (typeof item.nickname === 'string' && item.nickname.trim())
            common.nickname = item.nickname.trim().slice(0, MAX_NICKNAME_CHARS);

        if (item.type === 'image') {
            const safeFileName = typeof item.fileName === 'string' &&
                GLib.path_get_basename(item.fileName) === item.fileName;
            if (!safeFileName || !IMAGE_MIME_TYPES.has(item.mimeType) ||
                typeof item.checksum !== 'string')
                return null;
            const image = {
                ...common,
                type: 'image',
                mimeType: item.mimeType,
                fileName: item.fileName,
                checksum: item.checksum,
                byteSize: Math.max(0, Number(item.byteSize) || 0),
            };
            return Gio.File.new_for_path(this.imagePath(image)).query_exists(null)
                ? image
                : null;
        }

        if (typeof item.text !== 'string')
            return null;
        return {
            ...common,
            type: 'text',
            text: item.text.slice(0, MAX_ITEM_CHARS),
        };
    }

    _deleteImageIfUnused(item, items = this.items) {
        if (items.some(candidate =>
            candidate !== item &&
            candidate.type === 'image' &&
            candidate.fileName === item.fileName))
            return;

        Gio.File.new_for_path(this.imagePath(item)).delete_async(
            GLib.PRIORITY_DEFAULT,
            null,
            (file, result) => {
                try {
                    file.delete_finish(result);
                } catch (error) {
                    if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                        console.warn(`Clipboard Deck: image cleanup failed: ${error.message}`);
                }
            }
        );
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
                        GLib.chmod(this._path, 0o600);
                    } catch (error) {
                        console.warn(`Clipboard Deck: async save failed: ${error.message}`);
                    }
                }
            );
        } catch (error) {
            console.warn(`Clipboard Deck: could not schedule save: ${error.message}`);
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
        this._rowActions = [];
        this._grab = null;
        this._caretSource = 0;
        this._caretVisible = false;
        this._editingNicknameId = null;
        this._build();
    }

    destroy() {
        this.close(false);
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
        this._editingNicknameId = null;
        this._nicknameEditor.visible = false;
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
            Main.notify('Clipboard Deck', 'Could not open the keyboard popup.');
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
        this._editingNicknameId = null;
        this._nicknameEditor.visible = false;
        this._nicknameEntry.clutter_text.set_cursor_visible(false);
        try {
            this._stopCaretBlink();
        } catch (error) {
            console.warn(`Clipboard Deck: caret cleanup failed: ${error.message}`);
        }
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
            text: 'Clipboard Deck',
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
            hint_text: 'Search copied items or nicknames',
            can_focus: true,
            x_expand: true,
        });
        this._search.clutter_text.connect('text-changed', () => {
            this._selectedIndex = 0;
            this._render();
        });
        this._popup.add_child(this._search);

        this._nicknameEditor = new St.BoxLayout({
            style_class: 'wc-nickname-editor',
            x_expand: true,
            visible: false,
        });
        this._nicknameEditor.add_child(new St.Label({
            style_class: 'wc-nickname-editor-label',
            text: 'Nickname',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._nicknameEntry = new St.Entry({
            style_class: 'wc-nickname-entry',
            hint_text: 'e.g. greeting',
            can_focus: true,
            x_expand: true,
        });
        this._nicknameEntry.clutter_text.set_max_length(MAX_NICKNAME_CHARS);
        this._nicknameEntry.clutter_text.connect('key-press-event',
            (_actor, event) => this._onNicknameKeyPress(event));
        this._nicknameEditor.add_child(this._nicknameEntry);

        const nicknameSaveButton = new St.Button({
            style_class: 'wc-nickname-save',
            label: 'Save',
            can_focus: true,
            accessible_name: 'Save nickname',
        });
        nicknameSaveButton.connect('clicked', () =>
            this._finishNicknameEdit(true));
        this._usePointerCursor(nicknameSaveButton);
        this._nicknameEditor.add_child(nicknameSaveButton);
        this._popup.add_child(this._nicknameEditor);

        this._scroll = new St.ScrollView({
            style_class: 'wc-scroll',
            overlay_scrollbars: false,
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
        this._rowActions = [];

        const query = this._search.get_text().trim().toLocaleLowerCase();
        this._visibleItems = this._extension.store.ordered().filter(item => {
            if (!query)
                return true;
            if (item.nickname?.toLocaleLowerCase().includes(query))
                return true;
            return item.type === 'text'
                ? item.text.toLocaleLowerCase().includes(query)
                : 'screenshot image'.includes(query);
        });

        if (this._extension.paused || this._visibleItems.length === 0) {
            const text = this._extension.paused
                ? 'Capture is paused. Your saved history is still available after you resume.'
                : query
                    ? 'No copied items match this search.'
                    : 'Copy something, then use your configured shortcut to find it here.';
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
            const row = new St.Widget({
                style_class: 'wc-item',
                reactive: true,
                x_expand: true,
                layout_manager: new Clutter.BinLayout(),
            });
            row.track_hover = true;
            row.connect('notify::hover', () => this._updateRowActions(index));

            // This button deliberately extends beneath the row's padding and
            // border, so the visible outline is part of the click target.
            const hitTarget = new St.Button({
                style_class: 'wc-item-hit-target',
                can_focus: false,
                x_expand: true,
                y_expand: true,
                accessible_name: item.type === 'image'
                    ? `Paste screenshot${item.nickname
                        ? `, nickname ${item.nickname}`
                        : ''}`
                    : `Paste ${compactPreview(item.text)}${item.nickname
                        ? `, nickname ${item.nickname}`
                        : ''}`,
            });
            hitTarget.connect('clicked', () => this._activate(item, true));
            hitTarget.connect('notify::hover', () => this._updateRowActions(index));
            this._usePointerCursor(hitTarget);
            row.add_child(hitTarget);

            const itemLayout = new St.BoxLayout({
                style_class: 'wc-item-layout',
                x_expand: true,
                y_expand: true,
            });
            const mainContent = new St.BoxLayout({
                style_class: 'wc-item-main-content',
                vertical: true,
                x_expand: true,
            });
            if (item.nickname) {
                const nickname = new St.Label({
                    style_class: 'wc-nickname',
                    text: item.nickname,
                    x_expand: true,
                });
                nickname.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                mainContent.add_child(nickname);
            }

            const content = new St.BoxLayout({
                style_class: 'wc-item-content',
                x_expand: true,
            });

            if (item.type === 'image') {
                content.add_child(new St.Icon({
                    style_class: 'wc-thumbnail',
                    gicon: new Gio.FileIcon({
                        file: Gio.File.new_for_path(
                            this._extension.store.imagePath(item)
                        ),
                    }),
                    icon_size: 56,
                }));
            }

            const preview = new St.Label({
                style_class: 'wc-preview',
                text: item.type === 'image'
                    ? 'Screenshot'
                    : compactPreview(item.text),
                x_expand: true,
            });
            preview.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            content.add_child(preview);
            mainContent.add_child(content);
            itemLayout.add_child(mainContent);

            const nicknameButton = new St.Button({
                style_class: item.nickname ? 'wc-tag wc-tagged' : 'wc-tag',
                can_focus: false,
                accessible_name: item.nickname
                    ? `Edit nickname ${item.nickname}`
                    : 'Add nickname',
                y_align: Clutter.ActorAlign.START,
                visible: index === this._selectedIndex,
                child: new St.Label({text: '#'}),
            });
            nicknameButton.connect('clicked', () =>
                this._startNicknameEdit(item));
            this._usePointerCursor(nicknameButton);
            itemLayout.add_child(nicknameButton);

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
                visible: item.pinned || index === this._selectedIndex,
                child: pinIcon,
            });
            pinButton.connect('clicked', () => {
                this._extension.store.togglePinned(item.id);
                this._render();
                this._focusSearch();
            });
            this._usePointerCursor(pinButton);
            itemLayout.add_child(pinButton);

            row.add_child(itemLayout);

            if (index === this._selectedIndex)
                row.add_style_pseudo_class('selected');

            this._list.add_child(row);
            this._rows.push(row);
            this._rowActions.push({
                hitTarget,
                nicknameButton,
                pinButton,
                pinned: item.pinned,
            });
            this._updateRowActions(index);
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

    _startNicknameEdit(item) {
        this._editingNicknameId = item.id;
        this._nicknameEntry.set_text(item.nickname ?? '');
        this._nicknameEditor.visible = true;
        this._stopCaretBlink();
        global.stage.set_key_focus(this._nicknameEntry.clutter_text);
        this._nicknameEntry.clutter_text.set_cursor_position(-1);
        this._nicknameEntry.clutter_text.set_cursor_visible(true);
    }

    _finishNicknameEdit(save) {
        if (!this._editingNicknameId)
            return;

        if (save) {
            this._extension.store.setNickname(
                this._editingNicknameId,
                this._nicknameEntry.get_text()
            );
        }
        this._editingNicknameId = null;
        this._nicknameEditor.visible = false;
        this._nicknameEntry.clutter_text.set_cursor_visible(false);
        this._render();
        this._focusSearch();
    }

    _onNicknameKeyPress(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            this._finishNicknameEdit(true);
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Escape) {
            this._finishNicknameEdit(false);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
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
            GLib.Source.remove(this._caretSource);
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

        if (control && (symbol === Clutter.KEY_n || symbol === Clutter.KEY_N)) {
            const item = this._visibleItems[this._selectedIndex];
            if (item)
                this._startNicknameEdit(item);
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
            this._updateRowActions(index);
        }

        const selected = this._rows[this._selectedIndex];
        if (selected)
            ensureActorVisibleInScrollView(this._scroll, selected);
    }

    _updateRowActions(index) {
        const row = this._rows[index];
        const actions = this._rowActions[index];
        if (!row || !actions)
            return;

        const selected = index === this._selectedIndex;
        const hovered = row.hover || actions.hitTarget.hover;
        actions.nicknameButton.visible = selected ||
            (hovered && !actions.pinned);
        actions.pinButton.visible = selected || hovered || actions.pinned;
    }

    _activate(item, paste) {
        this.close();
        if (item.type === 'image') {
            if (this._extension.isCodexCliWindow(this._previousWindow)) {
                this._extension.setClipboard(
                    this._extension.store.imagePath(item),
                    true
                );
                if (paste)
                    this._extension.schedulePaste(this._previousWindow);
                return;
            }

            this._extension.setImageClipboard(item, success => {
                if (success && paste)
                    this._extension.schedulePaste(this._previousWindow);
            });
        } else {
            this._extension.store.add(item.text);
            this._extension.setClipboard(item.text);
            if (paste)
                this._extension.schedulePaste(this._previousWindow);
        }
    }
}

export default class ClipboardExtension extends Extension {
    enable() {
        this.paused = false;
        this.settings = this.getSettings();
        this.store = new HistoryStore(this.uuid);
        this.popup = new ClipboardPopup(this);
        this._clipboard = St.Clipboard.get_default();
        this._pasteSource = 0;
        this._captureSerial = 0;
        this._skippedClipboardText = null;

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

        const activeStore = this.store;
        activeStore.loadAsync(() => {
            if (this.store !== activeStore)
                return;

            this.popup?.refresh();
            this._selection = Shell.Global.get().get_display().get_selection();
            this._selectionSignal = this._selection.connect(
                'owner-changed',
                (_selection, selectionType) => {
                    if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD)
                        this._captureClipboard();
                }
            );
            this._captureClipboard();
        });
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
            GLib.Source.remove(this._pasteSource);
            this._pasteSource = 0;
        }

        this.popup?.destroy();
        this.popup = null;
        this.store?.flush();
        this.store = null;
        this.settings = null;
        this._clipboard = null;
    }

    setClipboard(text, skipCapture = false) {
        if (skipCapture)
            this._skippedClipboardText = text;
        this._clipboard?.set_text(St.ClipboardType.CLIPBOARD, text);
    }

    isTerminalWindow(window) {
        const identity = [
            window?.get_gtk_application_id?.(),
            window?.get_wm_class?.(),
        ].filter(Boolean).join(' ').toLocaleLowerCase();
        return /terminal|kitty|alacritty|wezterm|foot|terminator|tilix|xterm|hyper|warp/
            .test(identity);
    }

    isCodexCliWindow(window) {
        const title = (window?.get_title?.() ?? '').toLocaleLowerCase();
        return this.isTerminalWindow(window) && /\bcodex(?:[-_\s]|$)/.test(title);
    }

    setImageClipboard(item, onSet) {
        const file = Gio.File.new_for_path(this.store.imagePath(item));
        file.load_contents_async(null, (source, result) => {
            try {
                const [ok, contents] = source.load_contents_finish(result);
                if (!ok || !this._clipboard) {
                    onSet(false);
                    return;
                }
                this._clipboard.set_content(
                    St.ClipboardType.CLIPBOARD,
                    item.mimeType,
                    new GLib.Bytes(contents)
                );
                onSet(true);
            } catch (error) {
                console.warn(`Clipboard Deck: could not restore image: ${error.message}`);
                Main.notify('Clipboard Deck', 'The saved screenshot is no longer available.');
                onSet(false);
            }
        });
    }

    schedulePaste(expectedWindow) {
        if (this._pasteSource)
            GLib.Source.remove(this._pasteSource);

        let attempts = 0;
        this._pasteSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            PASTE_DELAY_MS,
            () => {
                if (expectedWindow && global.display.focus_window === expectedWindow) {
                    this._pasteSource = 0;
                    this._sendPasteShortcut(expectedWindow);
                    return GLib.SOURCE_REMOVE;
                }

                attempts++;
                if (expectedWindow && attempts < PASTE_FOCUS_RETRIES)
                    return GLib.SOURCE_CONTINUE;

                this._pasteSource = 0;
                Main.notify('Clipboard Deck', 'Copied. Press Ctrl+V to paste.');
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _captureClipboard() {
        if (this.paused || Main.sessionMode.isLocked)
            return;

        const serial = ++this._captureSerial;
        const mimeTypes = Array.from(this._clipboard?.get_mimetypes(
            St.ClipboardType.CLIPBOARD
        ) ?? []);
        const imageMimeType = mimeTypes.find(type =>
            IMAGE_MIME_TYPES.has(type.toLocaleLowerCase()));

        if (imageMimeType) {
            this._clipboard.get_content(
                St.ClipboardType.CLIPBOARD,
                imageMimeType,
                (_clipboard, bytes) => {
                    if (serial !== this._captureSerial || !this.store ||
                        this.paused || Main.sessionMode.isLocked || !bytes)
                        return;

                    this.store.addImage(
                        imageMimeType.toLocaleLowerCase(),
                        bytes,
                        () => this.popup?.refresh()
                    );
                }
            );
            return;
        }

        this._clipboard?.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => {
            if (serial !== this._captureSerial || !this.store ||
                this.paused || Main.sessionMode.isLocked || !text)
                return;

            if (text === this._skippedClipboardText) {
                this._skippedClipboardText = null;
                return;
            }

            if (!text.trim() || text.length > MAX_ITEM_CHARS)
                return;

            this.store.add(text);
            this.popup?.refresh();
        });
    }

    _sendPasteShortcut(window) {
        try {
            const keyboard = Clutter.get_default_backend()
                .get_default_seat()
                .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            const keys = this.isTerminalWindow(window)
                ? [29, 42, 47] // Ctrl+Shift+V
                : [42, 110]; // Shift+Insert
            const time = GLib.get_monotonic_time();

            for (const key of keys)
                keyboard.notify_key(time, key, Clutter.KeyState.PRESSED);
            for (const key of [...keys].reverse())
                keyboard.notify_key(time, key, Clutter.KeyState.RELEASED);
        } catch (error) {
            console.warn(`Clipboard Deck: direct paste unavailable: ${error.message}`);
            Main.notify('Clipboard Deck', 'Copied. Press Ctrl+V to paste.');
        }
    }
}
