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
import {filterItems} from './search.js';

const HISTORY_LIMIT = 200;
const MAX_ITEM_CHARS = 20_000;
const MAX_NICKNAME_CHARS = 80;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_CACHE_LIMIT = 250 * 1024 * 1024;
const POPUP_WIDTH = 440;
const POPUP_HEIGHT = 580;
const HELP_PANEL_WIDTH = 300;
const PANEL_GAP = 12;
const SETTINGS_WIDTH = 680;
const SETTINGS_HEIGHT = 780;
const SAVE_DELAY_MS = 250;
const PASTE_DELAY_MS = 90;
const PASTE_FOCUS_RETRIES = 5;
const ARCHIVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const IMAGE_MIME_TYPES = new Map([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['image/bmp', 'bmp'],
]);
const LOCAL_SHORTCUTS = [
    [null, 'Paste selected item', 'Enter'],
    ['shortcut-copy', 'Copy without pasting', null],
    ['shortcut-pin', 'Pin or unpin item', null],
    ['shortcut-nickname', 'Add or edit nickname', null],
    [null, 'Move item to Recycle Bin', 'Delete'],
];
const SETTINGS_ACTIONS = [
    {
        id: 'open',
        settingsKey: 'toggle-popup',
        title: 'Open Clipboard Deck',
        subtitle: 'Works from anywhere',
        global: true,
        defaultShortcut: {
            keyval: Clutter.KEY_v,
            modifiers: Clutter.ModifierType.SUPER_MASK,
            label: 'Super+V',
            accelerator: '<Super>v',
        },
    },
    {
        id: 'copy',
        settingsKey: 'shortcut-copy',
        title: 'Copy without pasting',
        subtitle: 'Leaves the selected item on the clipboard',
        defaultShortcut: {
            keyval: Clutter.KEY_Return,
            modifiers: Clutter.ModifierType.SHIFT_MASK,
            label: 'Shift+Enter',
        },
    },
    {
        id: 'pin',
        settingsKey: 'shortcut-pin',
        title: 'Pin or unpin item',
        subtitle: 'Keeps frequently used items nearby',
        defaultShortcut: {
            keyval: Clutter.KEY_p,
            modifiers: Clutter.ModifierType.CONTROL_MASK,
            label: 'Ctrl+P',
        },
    },
    {
        id: 'nickname',
        settingsKey: 'shortcut-nickname',
        title: 'Add or edit nickname',
        subtitle: 'Makes an item easier to search',
        defaultShortcut: {
            keyval: Clutter.KEY_n,
            modifiers: Clutter.ModifierType.CONTROL_MASK,
            label: 'Ctrl+N',
        },
    },
];
const MODIFIER_KEYVALS = new Set([
    Clutter.KEY_Shift_L,
    Clutter.KEY_Shift_R,
    Clutter.KEY_Control_L,
    Clutter.KEY_Control_R,
    Clutter.KEY_Alt_L,
    Clutter.KEY_Alt_R,
    Clutter.KEY_Meta_L,
    Clutter.KEY_Meta_R,
    Clutter.KEY_Super_L,
    Clutter.KEY_Super_R,
    Clutter.KEY_Hyper_L,
    Clutter.KEY_Hyper_R,
]);
const SHORTCUT_MODIFIER_MASK =
    Clutter.ModifierType.SHIFT_MASK |
    Clutter.ModifierType.CONTROL_MASK |
    Clutter.ModifierType.MOD1_MASK |
    Clutter.ModifierType.SUPER_MASK |
    Clutter.ModifierType.HYPER_MASK |
    Clutter.ModifierType.META_MASK;

function compactPreview(text) {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 180 ? `${compact.slice(0, 179)}…` : compact;
}

function normalizedShortcutKeyval(keyval) {
    if (keyval >= Clutter.KEY_A && keyval <= Clutter.KEY_Z)
        return keyval + (Clutter.KEY_a - Clutter.KEY_A);
    return keyval;
}

function shortcutKeyName(keyval, display = true) {
    const names = new Map([
        [Clutter.KEY_BackSpace, 'Backspace'],
        [Clutter.KEY_Tab, 'Tab'],
        [Clutter.KEY_Return, 'Enter'],
        [Clutter.KEY_KP_Enter, 'Enter'],
        [Clutter.KEY_Escape, 'Escape'],
        [Clutter.KEY_space, display ? 'Space' : 'space'],
        [Clutter.KEY_Delete, 'Delete'],
        [Clutter.KEY_Insert, 'Insert'],
        [Clutter.KEY_Home, 'Home'],
        [Clutter.KEY_End, 'End'],
        [Clutter.KEY_Page_Up, 'Page_Up'],
        [Clutter.KEY_Page_Down, 'Page_Down'],
        [Clutter.KEY_Left, 'Left'],
        [Clutter.KEY_Right, 'Right'],
        [Clutter.KEY_Up, 'Up'],
        [Clutter.KEY_Down, 'Down'],
    ]);
    if (names.has(keyval))
        return names.get(keyval);

    for (let number = 1; number <= 12; number++) {
        if (keyval === Clutter[`KEY_F${number}`])
            return `F${number}`;
    }

    const unicode = Clutter.keysym_to_unicode(keyval);
    if (!unicode)
        return '';
    const key = String.fromCodePoint(unicode);
    return display ? key.toLocaleUpperCase() : key.toLocaleLowerCase();
}

function shortcutFromEvent(event) {
    const keyval = normalizedShortcutKeyval(event.get_key_symbol());
    const modifiers = event.get_state() & SHORTCUT_MODIFIER_MASK;
    const parts = [];
    if (modifiers & Clutter.ModifierType.CONTROL_MASK)
        parts.push('Ctrl');
    if (modifiers & Clutter.ModifierType.MOD1_MASK)
        parts.push('Alt');
    if (modifiers & Clutter.ModifierType.SHIFT_MASK)
        parts.push('Shift');
    if (modifiers & Clutter.ModifierType.SUPER_MASK)
        parts.push('Super');
    if (modifiers & Clutter.ModifierType.HYPER_MASK)
        parts.push('Hyper');
    if (modifiers & Clutter.ModifierType.META_MASK)
        parts.push('Meta');
    const keyName = shortcutKeyName(keyval);
    if (keyName)
        parts.push(keyName);
    return {keyval, modifiers, label: parts.join('+')};
}

function shortcutAccelerator(shortcut) {
    const parts = [];
    if (shortcut.modifiers & Clutter.ModifierType.CONTROL_MASK)
        parts.push('<Control>');
    if (shortcut.modifiers & Clutter.ModifierType.MOD1_MASK)
        parts.push('<Alt>');
    if (shortcut.modifiers & Clutter.ModifierType.SHIFT_MASK)
        parts.push('<Shift>');
    if (shortcut.modifiers & Clutter.ModifierType.SUPER_MASK)
        parts.push('<Super>');
    if (shortcut.modifiers & Clutter.ModifierType.HYPER_MASK)
        parts.push('<Hyper>');
    if (shortcut.modifiers & Clutter.ModifierType.META_MASK)
        parts.push('<Meta>');
    const keyName = shortcutKeyName(shortcut.keyval, false);
    return keyName ? `${parts.join('')}${keyName}` : '';
}

function canonicalShortcutLabel(label) {
    const order = new Map([
        ['ctrl', 0],
        ['control', 0],
        ['alt', 1],
        ['shift', 2],
        ['super', 3],
        ['hyper', 4],
        ['meta', 5],
    ]);
    return label.split('+')
        .map(part => part.trim().toLocaleLowerCase())
        .sort((first, second) =>
            (order.get(first) ?? 100) - (order.get(second) ?? 100))
        .join('+');
}

function createPinGlyph(filled) {
    const glyph = new St.DrawingArea({style_class: 'wc-item-action-icon'});
    glyph.connect('repaint', area => {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const color = area.get_theme_node().get_foreground_color();
        const red = color.red / 255;
        const green = color.green / 255;
        const blue = color.blue / 255;
        const alpha = color.alpha / 255;
        cr.scale(width / 16, height / 16);
        cr.moveTo(5, 1.5);
        cr.lineTo(11, 1.5);
        cr.lineTo(9.6, 5.5);
        cr.lineTo(12, 7.8);
        cr.lineTo(12, 8.8);
        cr.lineTo(8.8, 8.8);
        cr.lineTo(8.8, 14);
        cr.lineTo(8, 15);
        cr.lineTo(7.2, 14);
        cr.lineTo(7.2, 8.8);
        cr.lineTo(4, 8.8);
        cr.lineTo(4, 7.8);
        cr.lineTo(6.4, 5.5);
        cr.closePath();
        if (filled) {
            cr.setSourceRGBA(red, green, blue, alpha);
            cr.fill();
        } else {
            cr.setLineWidth(1.4);
            cr.setLineCap(1);
            cr.setLineJoin(1);
            cr.setSourceRGBA(red, green, blue, alpha);
            cr.stroke();
        }
        cr.$dispose();
    });
    glyph.set_pivot_point(0.5, 0.5);
    glyph.rotation_angle_z = 45;
    return glyph;
}

function centerActionGlyph(glyph) {
    glyph.x_align = Clutter.ActorAlign.CENTER;
    glyph.y_align = Clutter.ActorAlign.CENTER;
    const slot = new St.Widget({
        style_class: 'wc-item-action-slot',
        layout_manager: new Clutter.BinLayout(),
    });
    slot.add_child(glyph);
    return slot;
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
                        this.purgeExpired();
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

    archive(id) {
        const item = this.items.find(candidate => candidate.id === id);
        if (!item || this._isArchived(item))
            return;

        item.deletedAt = Date.now();
        this.scheduleSave();
    }

    archiveAll() {
        const deletedAt = Date.now();
        let changed = false;
        for (const item of this.items) {
            if (this._isArchived(item))
                continue;
            item.deletedAt = deletedAt;
            changed = true;
        }
        if (changed)
            this.scheduleSave();
    }

    restore(id) {
        const item = this.items.find(candidate => candidate.id === id);
        if (!item || !this._isArchived(item))
            return;

        delete item.deletedAt;
        this._prune();
        this.scheduleSave();
    }

    restoreAll() {
        let changed = false;
        for (const item of this.items) {
            if (!this._isArchived(item))
                continue;
            delete item.deletedAt;
            changed = true;
        }
        if (!changed)
            return;

        this._prune();
        this.scheduleSave();
    }

    delete(id) {
        const item = this.items.find(candidate => candidate.id === id);
        if (!item)
            return;

        this.items = this.items.filter(candidate => candidate.id !== id);
        if (item.type === 'image')
            this._deleteImageIfUnused(item);
        this.scheduleSave();
    }

    ordered() {
        return this.items.filter(item => !this._isArchived(item)).sort((a, b) => {
            if (a.pinned !== b.pinned)
                return a.pinned ? -1 : 1;
            return b.createdAt - a.createdAt;
        });
    }

    archived() {
        return this.items.filter(item => this._isArchived(item)).sort((a, b) =>
            b.deletedAt - a.deletedAt);
    }

    purgeExpired(now = Date.now()) {
        const expired = this.items.filter(item => this._isArchived(item) &&
            item.deletedAt + ARCHIVE_RETENTION_MS <= now);
        if (expired.length === 0)
            return false;

        this.items = this.items.filter(item => !expired.includes(item));
        for (const item of expired) {
            if (item.type === 'image')
                this._deleteImageIfUnused(item);
        }
        this.scheduleSave();
        return true;
    }

    nextArchiveExpiry() {
        const archived = this.archived();
        if (archived.length === 0)
            return null;
        return Math.min(...archived.map(item =>
            item.deletedAt + ARCHIVE_RETENTION_MS));
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
        const archived = this.items.filter(item => this._isArchived(item));
        const ordered = [
            ...this.items
            .filter(item => !this._isArchived(item))
            .filter(item => item.pinned)
            .sort((a, b) => b.createdAt - a.createdAt),
            ...this.items
            .filter(item => !this._isArchived(item))
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
        this.items = [...kept, ...archived];
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
        if (Number.isFinite(item.deletedAt) && item.deletedAt > 0)
            common.deletedAt = item.deletedAt;

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

    _isArchived(item) {
        return Number.isFinite(item.deletedAt) && item.deletedAt > 0;
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
        this._tooltipOwner = null;
        this._editingNicknameId = null;
        this._showTrash = false;
        this._showHelp = false;
        this._showSettings = false;
        this._recordingAction = null;
        this._settingsRows = new Map();
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
        this._showTrash = false;
        this._showHelp = false;
        this._showSettings = false;
        this._recordingAction = null;
        this._helpPanel.visible = false;
        this._helpButton.checked = false;
        this._shortcutRecorderOverlay.visible = false;
        this._popup.visible = true;
        this._settingsView.visible = false;
        this._trashButton.checked = false;
        this._trashButton.accessible_name = 'Show Recycle Bin';
        this._clearConfirmOverlay.visible = false;
        this._title.set_text('Clipboard Deck');
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
        this._showHelp = false;
        this._showSettings = false;
        this._recordingAction = null;
        this._helpPanel.visible = false;
        this._helpButton.checked = false;
        this._shortcutRecorderOverlay.visible = false;
        this._nicknameEditor.visible = false;
        this._clearConfirmOverlay.visible = false;
        this._nicknameEntry.clutter_text.set_cursor_visible(false);
        this._hideTooltip();
        try {
            this._stopCaretBlink();
        } catch (error) {
            console.warn(`Clipboard Deck: caret cleanup failed: ${error.message}`);
        }
        global.display.set_cursor(Meta.Cursor.DEFAULT);
        this._pointerCursorActors?.clear();

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

    _extensionIcon(fileName, iconSize = 16, styleClass = null) {
        return new St.Icon({
            style_class: styleClass,
            gicon: new Gio.FileIcon({
                file: Gio.File.new_for_path(GLib.build_filenamev([
                    this._extension.path,
                    'icons',
                    fileName,
                ])),
            }),
            icon_size: iconSize,
        });
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
        this._title = new St.Label({
            style_class: 'wc-title',
            text: 'Clipboard Deck',
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._title);
        header.add_child(new St.Widget({x_expand: true}));

        this._helpButton = new St.Button({
            style_class: 'wc-help-button',
            can_focus: true,
            toggle_mode: true,
            accessible_name: 'Show help',
            child: this._extensionIcon('help-symbolic.svg'),
        });
        this._helpButton.connect('clicked', () =>
            this._setHelpVisible(this._helpButton.checked));
        this._usePointerCursor(this._helpButton);
        this._addTooltip(this._helpButton, () => this._showHelp
            ? 'Hide help'
            : 'Show help');
        header.add_child(this._helpButton);

        this._pauseButton = new St.Button({
            style_class: 'wc-pause-button',
            can_focus: true,
            toggle_mode: true,
            accessible_name: 'Pause clipboard capture',
            child: new St.Icon({
                icon_name: 'media-playback-pause-symbolic',
                icon_size: 16,
            }),
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
        this._addTooltip(this._pauseButton, () => this._extension.paused
            ? 'Resume clipboard capture'
            : 'Pause clipboard capture');
        header.add_child(this._pauseButton);

        this._clearButton = new St.Button({
            style_class: 'wc-clear-button',
            can_focus: true,
            accessible_name: 'Clear clipboard history',
            child: new St.Icon({
                icon_name: 'action-unavailable-symbolic',
                icon_size: 16,
            }),
        });
        this._clearButton.connect('clicked', () =>
            this._showClearConfirmation());
        this._usePointerCursor(this._clearButton);
        this._addTooltip(this._clearButton, 'Clear clipboard history');
        header.add_child(this._clearButton);

        this._restoreAllButton = new St.Button({
            style_class: 'wc-restore-all-button',
            can_focus: true,
            visible: false,
            accessible_name: 'Restore all archived items',
            child: new St.Icon({
                icon_name: 'document-revert-symbolic',
                icon_size: 16,
            }),
        });
        this._restoreAllButton.connect('clicked', () => this._restoreAll());
        this._usePointerCursor(this._restoreAllButton);
        this._addTooltip(this._restoreAllButton,
            'Restore all archived items');
        header.add_child(this._restoreAllButton);

        this._trashButton = new St.Button({
            style_class: 'wc-trash-button',
            can_focus: true,
            toggle_mode: true,
            accessible_name: 'Show Recycle Bin',
            child: this._extensionIcon('recycle-bin-symbolic.svg', 18),
        });
        this._trashButton.connect('clicked', () => {
            this._showTrash = this._trashButton.checked;
            this._trashButton.accessible_name = this._showTrash
                ? 'Show clipboard history'
                : 'Show Recycle Bin';
            this._title.set_text(this._showTrash
                ? 'Clipboard Deck — Recycle Bin'
                : 'Clipboard Deck');
            this._selectedIndex = 0;
            this._render();
            this._focusSearch();
        });
        this._usePointerCursor(this._trashButton);
        this._addTooltip(this._trashButton, () => this._showTrash
            ? 'Show clipboard history'
            : 'Show Recycle Bin');
        header.add_child(this._trashButton);

        this._settingsButton = new St.Button({
            style_class: 'wc-settings-button',
            can_focus: true,
            accessible_name: 'Open settings',
            child: new St.Icon({
                icon_name: 'preferences-system-symbolic',
                icon_size: 16,
            }),
        });
        this._settingsButton.connect('clicked', () =>
            this._setSettingsVisible(true));
        this._usePointerCursor(this._settingsButton);
        this._addTooltip(this._settingsButton, 'Open settings');
        header.add_child(this._settingsButton);
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

        this._buildSettingsView();
        this._overlay.add_child(this._settingsView);

        this._overlay.connect('key-press-event', (_actor, event) =>
            this._onKeyPress(event));
        this._search.clutter_text.connect('key-press-event', (_actor, event) =>
            this._onKeyPress(event));

        this._buildHelpPanel();
        this._overlay.add_child(this._helpPanel);

        this._clearConfirmOverlay = new St.Widget({
            style_class: 'wc-confirm-overlay',
            reactive: true,
            visible: false,
            layout_manager: new Clutter.BinLayout(),
        });
        const confirmDialog = new St.BoxLayout({
            style_class: 'wc-confirm-dialog',
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        confirmDialog.add_child(new St.Label({
            style_class: 'wc-confirm-title',
            text: 'Clear clipboard history?',
        }));
        confirmDialog.add_child(new St.Label({
            style_class: 'wc-confirm-description',
            text: 'All items will move to Recycle Bin and remain restorable for seven days.',
        }));
        const confirmActions = new St.BoxLayout({
            style_class: 'wc-confirm-actions',
            x_align: Clutter.ActorAlign.END,
        });
        this._clearCancelButton = new St.Button({
            style_class: 'wc-confirm-cancel',
            label: 'Cancel',
            can_focus: true,
            accessible_name: 'Cancel clearing clipboard history',
        });
        this._clearCancelButton.connect('clicked', () =>
            this._hideClearConfirmation());
        this._usePointerCursor(this._clearCancelButton);
        confirmActions.add_child(this._clearCancelButton);
        const clearConfirmButton = new St.Button({
            style_class: 'wc-confirm-delete',
            label: 'Delete',
            can_focus: true,
            accessible_name: 'Delete clipboard history to Recycle Bin',
        });
        clearConfirmButton.connect('clicked', () =>
            this._confirmClearHistory());
        this._usePointerCursor(clearConfirmButton);
        confirmActions.add_child(clearConfirmButton);
        confirmDialog.add_child(confirmActions);
        this._clearConfirmOverlay.add_child(confirmDialog);
        this._overlay.add_child(this._clearConfirmOverlay);

        this._buildShortcutRecorder();
        this._overlay.add_child(this._shortcutRecorderOverlay);

        this._tooltip = new St.Label({
            style_class: 'wc-tooltip',
            visible: false,
        });
        this._overlay.add_child(this._tooltip);

        Main.layoutManager.uiGroup.add_child(this._overlay);
    }

    _buildSettingsView() {
        this._settingsView = new St.BoxLayout({
            style_class: 'wc-settings-window',
            vertical: true,
            reactive: true,
            can_focus: true,
            visible: false,
        });

        const header = new St.BoxLayout({
            style_class: 'wc-settings-window-header',
            x_expand: true,
        });
        this._settingsBackButton = new St.Button({
            style_class: 'wc-settings-back',
            label: 'Back',
            can_focus: true,
            accessible_name: 'Back to clipboard history',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._settingsBackButton.connect('clicked', () =>
            this._setSettingsVisible(false));
        this._usePointerCursor(this._settingsBackButton);
        header.add_child(this._settingsBackButton);
        header.add_child(new St.Widget({x_expand: true}));

        const windowTitle = new St.BoxLayout({
            style_class: 'wc-settings-window-title',
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        windowTitle.add_child(new St.Label({
            style_class: 'wc-settings-window-name',
            text: 'Clipboard Deck',
        }));
        windowTitle.add_child(new St.Label({
            style_class: 'wc-settings-window-subtitle',
            text: 'Preferences',
        }));
        header.add_child(windowTitle);
        header.add_child(new St.Widget({x_expand: true}));

        const closeSlot = new St.Widget({
            style_class: 'wc-settings-close-slot',
            layout_manager: new Clutter.BinLayout(),
        });
        const closeButton = new St.Button({
            style_class: 'wc-settings-close',
            can_focus: true,
            accessible_name: 'Close settings',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            child: this._extensionIcon('close-symbolic.svg', 14),
        });
        closeButton.connect('clicked', () => this.close());
        this._usePointerCursor(closeButton);
        closeSlot.add_child(closeButton);
        header.add_child(closeSlot);
        this._settingsView.add_child(header);

        const scroll = new St.ScrollView({
            style_class: 'wc-settings-scroll',
            overlay_scrollbars: false,
            x_expand: true,
            y_expand: true,
        });
        const content = new St.BoxLayout({
            style_class: 'wc-settings-content',
            vertical: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });

        const intro = new St.BoxLayout({
            style_class: 'wc-settings-intro',
            x_expand: true,
        });
        const iconTile = new St.Widget({
            style_class: 'wc-settings-icon-tile',
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        iconTile.add_child(new St.Icon({
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
            icon_size: 24,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        intro.add_child(iconTile);
        intro.add_child(new St.Label({
            style_class: 'wc-settings-intro-title',
            text: 'Keyboard shortcuts',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        intro.add_child(new St.Widget({x_expand: true}));
        this._settingsResetAllButton = new St.Button({
            style_class: 'wc-settings-reset-all',
            label: 'Reset all',
            can_focus: true,
            accessible_name: 'Reset all keyboard shortcuts',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._settingsResetAllButton.connect('clicked', () => {
            for (const action of SETTINGS_ACTIONS)
                this._writeSettingsShortcut(action, action.defaultShortcut);
            this._refreshSettingsRows();
        });
        this._usePointerCursor(this._settingsResetAllButton);
        intro.add_child(this._settingsResetAllButton);
        content.add_child(intro);

        const addSection = (title, actions, secondary = false) => {
            content.add_child(new St.Label({
                style_class: secondary
                    ? 'wc-settings-section-label wc-settings-secondary-section-label'
                    : 'wc-settings-section-label',
                text: title.toLocaleUpperCase(),
                x_expand: true,
            }));
            const card = new St.BoxLayout({
                style_class: 'wc-settings-card',
                vertical: true,
                x_expand: true,
            });
            for (const [index, action] of actions.entries()) {
                if (index > 0) {
                    card.add_child(new St.Widget({
                        style_class: 'wc-settings-separator',
                        x_expand: true,
                    }));
                }
                card.add_child(this._createSettingsRow(action));
            }
            content.add_child(card);
        };

        addSection('Anywhere', SETTINGS_ACTIONS.filter(action => action.global));
        content.add_child(new St.Label({
            style_class: 'wc-settings-note',
            text: 'GNOME may ask before replacing a system shortcut.',
            x_expand: true,
        }));
        addSection('While Clipboard Deck is open',
            SETTINGS_ACTIONS.filter(action => !action.global), true);

        scroll.set_child(content);
        this._settingsView.add_child(scroll);
    }

    _createSettingsRow(action) {
        const row = new St.BoxLayout({
            style_class: 'wc-settings-row',
            x_expand: true,
        });
        const copy = new St.BoxLayout({
            style_class: 'wc-settings-row-copy',
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        copy.add_child(new St.Label({
            style_class: 'wc-settings-row-title',
            text: action.title,
            x_expand: true,
        }));
        copy.add_child(new St.Label({
            style_class: 'wc-settings-row-subtitle',
            text: action.subtitle,
            x_expand: true,
        }));
        row.add_child(copy);

        const resetButton = new St.Button({
            style_class: 'wc-settings-row-reset',
            can_focus: true,
            accessible_name: `Reset ${action.title}`,
            child: new St.Icon({
                icon_name: 'edit-undo-symbolic',
                icon_size: 14,
            }),
        });
        resetButton.connect('clicked', () => {
            this._writeSettingsShortcut(action, action.defaultShortcut);
            this._refreshSettingsRows();
        });
        this._usePointerCursor(resetButton);
        row.add_child(resetButton);

        const keyCaps = new St.BoxLayout({
            style_class: 'wc-settings-key-caps',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const editButton = new St.Button({
            style_class: 'wc-settings-row-edit',
            can_focus: true,
            accessible_name: `Change ${action.title}`,
            child: keyCaps,
        });
        editButton.connect('clicked', () =>
            this._openShortcutRecorder(action));
        this._usePointerCursor(editButton);
        row.add_child(editButton);
        this._settingsRows.set(action.id, {
            editButton,
            keyCaps,
            resetButton,
        });
        return row;
    }

    _buildShortcutRecorder() {
        this._shortcutRecorderOverlay = new St.Widget({
            style_class: 'wc-shortcut-recorder-overlay',
            reactive: true,
            can_focus: true,
            visible: false,
            layout_manager: new Clutter.BinLayout(),
        });
        this._shortcutRecorderOverlay.connect('captured-event',
            (_actor, event) => event.type() === Clutter.EventType.KEY_PRESS
                ? this._onShortcutRecorderKeyPress(event)
                : Clutter.EVENT_PROPAGATE);
        const dialog = new St.BoxLayout({
            style_class: 'wc-shortcut-recorder',
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._recorderTitle = new St.Label({
            style_class: 'wc-shortcut-recorder-title',
            text: 'Set shortcut',
        });
        dialog.add_child(this._recorderTitle);
        this._recorderKeyArea = new St.Widget({
            style_class: 'wc-shortcut-recorder-key-area',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        this._recorderKeys = new St.BoxLayout({
            style_class: 'wc-settings-key-caps',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._recorderKeyArea.add_child(this._recorderKeys);
        dialog.add_child(this._recorderKeyArea);
        this._recorderMessage = new St.Label({
            style_class: 'wc-shortcut-recorder-message',
            text: 'Press the keys you want to use together',
            x_expand: true,
        });
        this._recorderMessage.clutter_text.line_wrap = true;
        this._recorderMessage.clutter_text.line_wrap_mode =
            Pango.WrapMode.WORD_CHAR;
        dialog.add_child(this._recorderMessage);
        dialog.add_child(new St.Widget({y_expand: true}));
        const actions = new St.BoxLayout({
            style_class: 'wc-shortcut-recorder-actions',
            x_align: Clutter.ActorAlign.END,
        });
        this._recorderCancelButton = new St.Button({
            style_class: 'wc-shortcut-recorder-cancel',
            label: 'Cancel',
            can_focus: true,
        });
        this._recorderCancelButton.connect('clicked', () =>
            this._closeShortcutRecorder());
        this._usePointerCursor(this._recorderCancelButton);
        actions.add_child(this._recorderCancelButton);
        this._recorderSetButton = new St.Button({
            style_class: 'wc-shortcut-recorder-set',
            label: 'Set',
            can_focus: true,
        });
        this._recorderSetButton.connect('clicked', () => {
            if (!this._recorderCandidate || !this._recordingAction)
                return;
            this._writeSettingsShortcut(
                this._recordingAction, this._recorderCandidate);
            this._refreshSettingsRows();
            this._closeShortcutRecorder();
        });
        this._usePointerCursor(this._recorderSetButton);
        actions.add_child(this._recorderSetButton);
        dialog.add_child(actions);
        this._shortcutRecorderOverlay.add_child(dialog);
    }

    _setSettingsVisible(visible) {
        this._showSettings = Boolean(visible);
        this._hideTooltip();
        this._pointerCursorActors?.clear();
        global.display.set_cursor(Meta.Cursor.DEFAULT);
        if (this._showSettings && this._showHelp)
            this._setHelpVisible(false);

        this._popup.visible = !this._showSettings;
        this._settingsView.visible = this._showSettings;
        this._position();

        if (this._showSettings) {
            this._stopCaretBlink();
            this._refreshSettingsRows();
            global.stage.set_key_focus(this._settingsView);
        } else {
            this._render();
            this._focusSearch();
        }
    }

    _settingsShortcut(action) {
        if (action.global) {
            const accelerator = this._extension.settings
                .get_strv(action.settingsKey)[0] ?? '';
            if (!accelerator)
                return {keyval: 0, modifiers: 0, label: 'Disabled'};

            let modifiers = 0;
            if (/<Control>|<Ctrl>|<Primary>/i.test(accelerator))
                modifiers |= Clutter.ModifierType.CONTROL_MASK;
            if (/<Alt>|<Mod1>/i.test(accelerator))
                modifiers |= Clutter.ModifierType.MOD1_MASK;
            if (/<Shift>/i.test(accelerator))
                modifiers |= Clutter.ModifierType.SHIFT_MASK;
            if (/<Super>/i.test(accelerator))
                modifiers |= Clutter.ModifierType.SUPER_MASK;
            if (/<Hyper>/i.test(accelerator))
                modifiers |= Clutter.ModifierType.HYPER_MASK;
            if (/<Meta>/i.test(accelerator))
                modifiers |= Clutter.ModifierType.META_MASK;
            const rawKey = accelerator.replaceAll(/<[^>]+>/g, '');
            let keyval = Clutter[`KEY_${rawKey}`] ?? 0;
            if (!keyval && [...rawKey].length === 1)
                keyval = Clutter.unicode_to_keysym(rawKey.codePointAt(0));
            return {
                keyval: normalizedShortcutKeyval(keyval),
                modifiers,
                label: this._extension._acceleratorTokens(accelerator)
                    .join('+'),
                accelerator,
            };
        }
        const [keyval, _modifiers, label] = this._extension.settings
            .get_value(action.settingsKey)
            .deep_unpack();
        return {
            keyval,
            modifiers: _modifiers,
            label: keyval && label ? label : 'Disabled',
        };
    }

    _settingsShortcutLabel(action) {
        return this._settingsShortcut(action).label;
    }

    _setShortcutKeyCaps(container, label, large = false) {
        container.destroy_all_children();
        if (!label || label === 'Disabled') {
            container.add_child(new St.Label({
                style_class: 'wc-settings-shortcut-disabled',
                text: 'Disabled',
            }));
            return;
        }

        for (const token of label.split('+')) {
            const keyCap = new St.Widget({
                style_class: large
                    ? 'wc-settings-key-cap wc-settings-key-cap-large'
                    : 'wc-settings-key-cap',
                layout_manager: new Clutter.BinLayout(),
            });
            keyCap.add_child(new St.Label({
                style_class: 'wc-settings-key-cap-label',
                text: token.trim(),
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            container.add_child(keyCap);
        }
    }

    _refreshSettingsRows() {
        let hasChanges = false;
        for (const action of SETTINGS_ACTIONS) {
            const row = this._settingsRows.get(action.id);
            if (!row)
                continue;
            const label = this._settingsShortcutLabel(action);
            const changed = label !== action.defaultShortcut.label;
            this._setShortcutKeyCaps(row.keyCaps, label);
            row.resetButton.visible = changed;
            hasChanges ||= changed;
        }
        this._settingsResetAllButton.reactive = hasChanges;
        this._settingsResetAllButton.opacity = hasChanges ? 255 : 96;
    }

    _writeSettingsShortcut(action, shortcut) {
        if (action.global) {
            const accelerator = shortcut.accelerator ??
                shortcutAccelerator(shortcut);
            this._extension.settings.set_strv(
                action.settingsKey, accelerator ? [accelerator] : []);
            return;
        }
        this._extension.settings.set_value(
            action.settingsKey,
            new GLib.Variant('(uus)', [
                shortcut.keyval,
                shortcut.modifiers,
                shortcut.label,
            ])
        );
    }

    _openShortcutRecorder(action) {
        this._recordingAction = action;
        this._recorderTitle.set_text(action.title);
        this._setRecorderCandidate(this._settingsShortcut(action));
        this._shortcutRecorderOverlay.visible = true;
        global.stage.set_key_focus(this._shortcutRecorderOverlay);
    }

    _closeShortcutRecorder() {
        this._shortcutRecorderOverlay.visible = false;
        this._recordingAction = null;
        this._recorderCandidate = null;
        if (this._showSettings)
            global.stage.set_key_focus(this._settingsView);
    }

    _setRecorderCandidate(shortcut, error = '') {
        this._recorderCandidate = error ? null : shortcut;
        this._setShortcutKeyCaps(
            this._recorderKeys, shortcut?.label || 'Disabled', true);
        this._recorderMessage.set_text(
            error || 'Press the keys you want to use together');
        if (error) {
            this._recorderKeyArea.add_style_pseudo_class('error');
            this._recorderMessage.add_style_pseudo_class('error');
        } else {
            this._recorderKeyArea.remove_style_pseudo_class('error');
            this._recorderMessage.remove_style_pseudo_class('error');
        }
        const valid = Boolean(shortcut) && !error;
        this._recorderSetButton.reactive = valid;
        this._recorderSetButton.opacity = valid ? 255 : 96;
    }

    _onShortcutRecorderKeyPress(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            this._closeShortcutRecorder();
            return Clutter.EVENT_STOP;
        }
        if (MODIFIER_KEYVALS.has(symbol))
            return Clutter.EVENT_STOP;

        const shortcut = shortcutFromEvent(event);
        if ([Clutter.KEY_Up, Clutter.KEY_Down].includes(symbol)) {
            this._setRecorderCandidate(shortcut,
                'Arrow navigation and Escape stay available.');
            return Clutter.EVENT_STOP;
        }

        const unicode = Clutter.keysym_to_unicode(symbol);
        if (shortcut.modifiers === 0 && unicode >= 0x20 && unicode !== 0x7f) {
            this._setRecorderCandidate(shortcut,
                'Use Super, Ctrl, or Alt with typing keys.');
            return Clutter.EVENT_STOP;
        }
        if (!shortcutKeyName(shortcut.keyval, false)) {
            this._setRecorderCandidate(shortcut,
                'That key cannot be used as a shortcut.');
            return Clutter.EVENT_STOP;
        }

        let conflict = null;
        if (shortcut.modifiers === 0 &&
            [Clutter.KEY_Return, Clutter.KEY_KP_Enter].includes(symbol)) {
            conflict = 'Paste selected item';
        } else if (shortcut.modifiers === 0 && symbol === Clutter.KEY_Delete) {
            conflict = 'Move to Recycle Bin';
        } else {
            conflict = SETTINGS_ACTIONS.find(action =>
                action.id !== this._recordingAction.id &&
                canonicalShortcutLabel(this._settingsShortcutLabel(action)) ===
                    canonicalShortcutLabel(shortcut.label))?.title;
        }
        this._setRecorderCandidate(shortcut, conflict
            ? `Already used for “${conflict}”.`
            : '');
        return Clutter.EVENT_STOP;
    }

    _buildHelpPanel() {
        this._helpPanel = new St.BoxLayout({
            style_class: 'wc-help-panel',
            vertical: true,
            reactive: true,
            visible: false,
        });

        const header = new St.BoxLayout({
            style_class: 'wc-help-header',
            x_expand: true,
        });
        header.add_child(new St.Label({
            style_class: 'wc-help-title',
            text: 'Guide',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(new St.Widget({x_expand: true}));
        this._helpCloseButton = new St.Button({
            style_class: 'wc-help-close',
            can_focus: true,
            accessible_name: 'Close help',
            y_align: Clutter.ActorAlign.CENTER,
            child: this._extensionIcon('close-symbolic.svg', 16),
        });
        this._helpCloseButton.connect('clicked', () =>
            this._setHelpVisible(false));
        this._usePointerCursor(this._helpCloseButton);
        header.add_child(this._helpCloseButton);
        this._helpPanel.add_child(header);
        this._helpPanel.add_child(new St.Widget({
            style_class: 'wc-help-separator',
            x_expand: true,
        }));

        const scroll = new St.ScrollView({
            style_class: 'wc-help-scroll',
            overlay_scrollbars: false,
            x_expand: true,
            y_expand: true,
        });
        const content = new St.BoxLayout({
            style_class: 'wc-help-content',
            vertical: true,
            x_expand: true,
        });

        content.add_child(new St.Label({
            style_class: 'wc-help-section-title',
            text: 'Keyboard shortcuts',
        }));
        this._helpShortcuts = new St.BoxLayout({
            style_class: 'wc-help-shortcuts',
            vertical: true,
            x_expand: true,
        });
        this._refreshHelpShortcuts();
        content.add_child(this._helpShortcuts);

        content.add_child(new St.Label({
            style_class: 'wc-help-section-title wc-help-icons-title',
            text: 'Icon meanings',
        }));

        const iconDefinitions = [
            [this._extensionIcon('help-symbolic.svg', 14), 'Help', 'Open this guide'],
            [new St.Icon({icon_name: 'media-playback-pause-symbolic', icon_size: 14}), 'Pause', 'Pause or resume capture'],
            [new St.Icon({icon_name: 'action-unavailable-symbolic', icon_size: 14}), 'Clear', 'Move all history to Recycle Bin'],
            [this._extensionIcon('recycle-bin-symbolic.svg', 14), 'Recycle Bin', 'Open archived items'],
            [new St.Icon({icon_name: 'preferences-system-symbolic', icon_size: 14}), 'Settings', 'Customize keyboard shortcuts'],
            [this._extensionIcon('archive-symbolic.svg', 14), 'Archive', 'Move an item to Recycle Bin'],
            [new St.Icon({icon_name: 'document-revert-symbolic', icon_size: 14}), 'Restore', 'Restore archived items'],
            [this._extensionIcon('hash-symbolic.svg', 14), 'Nickname', 'Add or edit a nickname'],
            [createPinGlyph(true), 'Pin', 'Keep an item in history'],
            [new St.Icon({icon_name: 'user-trash-symbolic', icon_size: 14}), 'Delete', 'Delete an item permanently'],
        ];
        const iconGuide = new St.BoxLayout({
            style_class: 'wc-help-icon-guide',
            vertical: true,
            x_expand: true,
        });
        for (const definition of iconDefinitions)
            iconGuide.add_child(this._createHelpIconCard(...definition));
        content.add_child(iconGuide);

        const privacy = new St.BoxLayout({
            style_class: 'wc-help-privacy',
            vertical: true,
            x_expand: true,
        });
        privacy.add_child(new St.Label({
            style_class: 'wc-help-privacy-title',
            text: 'Private by design',
        }));
        const privacyDescription = new St.Label({
            style_class: 'wc-help-privacy-description',
            text: 'Your history stays on this device. Recycle Bin items are cleared after seven days.',
            x_expand: true,
        });
        privacyDescription.clutter_text.line_wrap = true;
        privacyDescription.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        privacyDescription.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        privacy.add_child(privacyDescription);
        content.add_child(privacy);

        scroll.set_child(content);
        this._helpPanel.add_child(scroll);
    }

    _refreshHelpShortcuts() {
        if (!this._helpShortcuts)
            return;

        for (const child of this._helpShortcuts.get_children())
            child.destroy();

        for (const [keys, description] of this._extension.shortcutDefinitions()) {
            const row = new St.BoxLayout({
                style_class: 'wc-help-shortcut-row',
                x_expand: true,
            });
            const keyGroup = new St.BoxLayout({
                style_class: 'wc-help-shortcut-keys',
            });
            for (const key of keys) {
                keyGroup.add_child(new St.Label({
                    style_class: 'wc-help-key',
                    text: key,
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }
            row.add_child(keyGroup);
            row.add_child(new St.Label({
                style_class: 'wc-help-shortcut-description',
                text: description,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            this._helpShortcuts.add_child(row);
        }
    }

    _createHelpIconCard(icon, title, description) {
        const card = new St.BoxLayout({
            style_class: 'wc-help-icon-card',
            x_expand: true,
        });
        icon.x_align = Clutter.ActorAlign.CENTER;
        icon.y_align = Clutter.ActorAlign.CENTER;
        const iconSlot = new St.Widget({
            style_class: 'wc-help-icon-slot',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout(),
        });
        iconSlot.add_child(icon);
        card.add_child(iconSlot);

        const copy = new St.BoxLayout({
            style_class: 'wc-help-icon-copy',
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        copy.add_child(new St.Label({
            style_class: 'wc-help-icon-name',
            text: title,
        }));
        const descriptionLabel = new St.Label({
            style_class: 'wc-help-icon-description',
            text: description,
            x_expand: true,
        });
        descriptionLabel.clutter_text.line_wrap = true;
        descriptionLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        descriptionLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        copy.add_child(descriptionLabel);
        card.add_child(copy);
        return card;
    }

    _setHelpVisible(visible) {
        this._showHelp = Boolean(visible);
        this._helpButton.checked = this._showHelp;
        this._helpButton.accessible_name = this._showHelp
            ? 'Hide help'
            : 'Show help';
        this._helpPanel.visible = this._showHelp;
        this._position();

        if (this._showHelp) {
            this._refreshHelpShortcuts();
            this._stopCaretBlink();
            global.stage.set_key_focus(this._helpCloseButton);
        } else {
            this._focusSearch();
        }
    }

    _position() {
        const monitor = Main.layoutManager.currentMonitor ??
            Main.layoutManager.primaryMonitor;
        const popupHeight = Math.min(
            POPUP_HEIGHT,
            Math.max(420, monitor.height - 96)
        );
        const popupY = Math.max(
            48,
            Math.round(monitor.height * 0.42 - POPUP_HEIGHT / 2)
        );
        const hasSideRoom = monitor.width >=
            POPUP_WIDTH + PANEL_GAP + HELP_PANEL_WIDTH + 40;
        let popupX = Math.round((monitor.width - POPUP_WIDTH) / 2);
        let helpX = Math.round((monitor.width - HELP_PANEL_WIDTH) / 2);
        let helpWidth = HELP_PANEL_WIDTH;
        const settingsWidth = Math.min(
            SETTINGS_WIDTH,
            Math.max(420, monitor.width - 40)
        );
        const settingsHeight = Math.min(
            SETTINGS_HEIGHT,
            Math.max(520, monitor.height - 56)
        );

        if (this._showHelp && hasSideRoom) {
            const groupWidth = POPUP_WIDTH + PANEL_GAP + HELP_PANEL_WIDTH;
            popupX = Math.round((monitor.width - groupWidth) / 2);
            helpX = popupX + POPUP_WIDTH + PANEL_GAP;
        } else if (this._showHelp) {
            helpWidth = Math.min(POPUP_WIDTH, monitor.width - 20);
            helpX = Math.round((monitor.width - helpWidth) / 2);
        }

        this._overlay.set_position(monitor.x, monitor.y);
        this._overlay.set_size(monitor.width, monitor.height);
        this._backdrop.set_size(monitor.width, monitor.height);
        this._clearConfirmOverlay.set_position(0, 0);
        this._clearConfirmOverlay.set_size(monitor.width, monitor.height);
        this._shortcutRecorderOverlay.set_position(0, 0);
        this._shortcutRecorderOverlay.set_size(monitor.width, monitor.height);
        this._popup.set_position(popupX, popupY);
        this._popup.set_size(POPUP_WIDTH, popupHeight);
        this._settingsView.set_position(
            Math.round((monitor.width - settingsWidth) / 2),
            Math.round((monitor.height - settingsHeight) / 2)
        );
        this._settingsView.set_size(settingsWidth, settingsHeight);
        this._helpPanel.set_position(helpX, popupY);
        this._helpPanel.set_size(helpWidth, popupHeight);
    }

    _render() {
        if (this._showSettings) {
            this._refreshSettingsRows();
            return;
        }

        this._list.destroy_all_children();
        this._rows = [];
        this._rowActions = [];
        this._clearButton.visible = !this._showTrash;
        this._clearButton.reactive = this._extension.store.ordered().length > 0;
        this._clearButton.opacity = this._clearButton.reactive ? 255 : 96;
        this._restoreAllButton.visible = this._showTrash;
        this._restoreAllButton.reactive =
            this._extension.store.archived().length > 0;
        this._restoreAllButton.opacity =
            this._restoreAllButton.reactive ? 255 : 96;

        const query = this._search.get_text();
        const items = this._showTrash
            ? this._extension.store.archived()
            : this._extension.store.ordered();
        this._visibleItems = filterItems(items, query);
        const hasQuery = Boolean(query.trim());

        if ((!this._showTrash && this._extension.paused) ||
            this._visibleItems.length === 0) {
            const text = this._showTrash
                ? hasQuery
                    ? 'No archived items match this search.'
                    : 'Recycle Bin is empty. Archived items stay here for seven days.'
                : this._extension.paused
                ? 'Capture is paused. Your saved history is still available after you resume.'
                : hasQuery
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
            const archived = this._showTrash;
            const row = new St.BoxLayout({
                style_class: 'wc-item',
                reactive: true,
                x_expand: true,
            });
            row.track_hover = true;
            row.connect('notify::hover', () => this._updateRowActions(index));
            if (archived) {
                row.add_style_class_name('wc-item-archived');
            } else {
                // The row's padding and gaps are part of its click target too.
                this._usePointerCursor(row);
            }

            const mainButton = new St.Button({
                style_class: 'wc-item-main',
                can_focus: false,
                x_expand: true,
                accessible_name: item.type === 'image'
                    ? `Paste screenshot${item.nickname
                        ? `, nickname ${item.nickname}`
                        : ''}`
                    : `Paste ${compactPreview(item.text)}${item.nickname
                        ? `, nickname ${item.nickname}`
                        : ''}`,
            });
            mainButton.reactive = !archived;
            if (!archived)
                mainButton.connect('clicked', () => this._activate(item, true));
            const mainContent = new St.BoxLayout({
                style_class: 'wc-item-main-content',
                vertical: true,
                x_expand: true,
            });
            let nickname = null;
            if (item.nickname) {
                nickname = new St.Label({
                    style_class: 'wc-nickname',
                    text: item.nickname,
                    x_expand: true,
                });
                nickname.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            }
            let expiry = null;
            if (archived) {
                expiry = new St.Label({
                    style_class: 'wc-expiry',
                    text: this._archiveExpiryLabel(item),
                    x_expand: true,
                });
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
            } else {
                if (nickname)
                    mainContent.add_child(nickname);
                if (expiry)
                    mainContent.add_child(expiry);
            }

            const preview = new St.Label({
                style_class: 'wc-preview',
                text: item.type === 'image'
                    ? 'Screenshot'
                    : compactPreview(item.text),
                x_expand: true,
            });
            preview.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            if (item.type === 'image') {
                const imageDetails = new St.BoxLayout({
                    style_class: 'wc-item-image-details',
                    vertical: true,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                if (nickname)
                    imageDetails.add_child(nickname);
                if (expiry)
                    imageDetails.add_child(expiry);
                imageDetails.add_child(preview);
                content.add_child(imageDetails);
            } else {
                content.add_child(preview);
            }
            mainContent.add_child(content);
            mainButton.set_child(mainContent);
            row.add_child(mainButton);

            const actions = archived
                ? this._addTrashActions(row, item, index)
                : this._addHistoryActions(row, item, index);

            const rowClick = new Clutter.ClickAction();
            row.add_action(rowClick);
            rowClick.connect('clicked', () => {
                const rowActions = this._rowActions[index];
                if (archived || !rowActions ||
                    rowActions.mainButton.hover ||
                    rowActions.nicknameButton?.hover ||
                    rowActions.pinButton?.hover ||
                    rowActions.archiveButton?.hover ||
                    rowActions.restoreButton?.hover ||
                    rowActions.deleteButton?.hover)
                    return;
                this._activate(item, true);
            });

            if (index === this._selectedIndex)
                row.add_style_pseudo_class('selected');

            this._list.add_child(row);
            this._rows.push(row);
            this._rowActions.push({
                mainButton,
                ...actions,
                pinned: item.pinned,
                archived,
            });
            this._updateRowActions(index);
        }
    }

    _addHistoryActions(row, item, index) {
        const nicknameButton = new St.Button({
            style_class: item.nickname
                ? 'wc-item-action wc-tag wc-tagged'
                : 'wc-item-action wc-tag',
            can_focus: false,
            accessible_name: item.nickname
                ? `Edit nickname ${item.nickname}`
                : 'Add nickname',
            y_align: Clutter.ActorAlign.START,
            visible: index === this._selectedIndex,
            child: centerActionGlyph(new St.Icon({
                style_class: 'wc-item-action-icon',
                gicon: new Gio.FileIcon({
                    file: Gio.File.new_for_path(GLib.build_filenamev([
                        this._extension.path,
                        'icons',
                        'hash-symbolic.svg',
                    ])),
                }),
                icon_size: 14,
            })),
        });
        nicknameButton.connect('clicked', () => this._startNicknameEdit(item));
        this._usePointerCursor(nicknameButton);
        this._addTooltip(nicknameButton, () => item.nickname
            ? 'Edit nickname'
            : 'Add nickname');
        row.add_child(nicknameButton);

        const pinIcon = createPinGlyph(item.pinned);

        const pinButton = new St.Button({
            style_class: 'wc-item-action wc-pin',
            can_focus: false,
            toggle_mode: true,
            checked: item.pinned,
            accessible_name: item.pinned ? 'Unpin item' : 'Pin item',
            y_align: Clutter.ActorAlign.START,
            visible: item.pinned || index === this._selectedIndex,
            child: centerActionGlyph(pinIcon),
        });
        pinButton.connect('clicked', () => {
            this._extension.store.togglePinned(item.id);
            this._render();
            this._focusSearch();
        });
        this._usePointerCursor(pinButton);
        this._addTooltip(pinButton, () => item.pinned
            ? 'Unpin item'
            : 'Pin item');

        const archiveButton = new St.Button({
            style_class: 'wc-item-action wc-delete',
            can_focus: false,
            accessible_name: 'Archive item to Recycle Bin',
            y_align: Clutter.ActorAlign.START,
            visible: index === this._selectedIndex,
            child: centerActionGlyph(this._extensionIcon(
                'archive-symbolic.svg',
                14,
                'wc-item-action-icon'
            )),
        });
        archiveButton.connect('clicked', () => this._archiveItem(item));
        this._usePointerCursor(archiveButton);
        this._addTooltip(archiveButton, 'Archive to Recycle Bin');
        row.add_child(archiveButton);
        row.add_child(pinButton);

        return {nicknameButton, pinButton, archiveButton};
    }

    _addTrashActions(row, item, index) {
        const restoreButton = new St.Button({
            style_class: 'wc-item-action wc-restore',
            can_focus: false,
            accessible_name: 'Restore archived item',
            y_align: Clutter.ActorAlign.START,
            visible: index === this._selectedIndex,
            child: centerActionGlyph(new St.Icon({
                style_class: 'wc-item-action-icon',
                icon_name: 'edit-undo-symbolic',
                icon_size: 14,
            })),
        });
        restoreButton.connect('clicked', () => this._restoreItem(item));
        this._usePointerCursor(restoreButton);
        this._addTooltip(restoreButton, 'Restore item');
        row.add_child(restoreButton);

        const deleteButton = new St.Button({
            style_class: 'wc-item-action wc-delete',
            can_focus: false,
            accessible_name: 'Delete archived item permanently',
            y_align: Clutter.ActorAlign.START,
            visible: index === this._selectedIndex,
            child: centerActionGlyph(new St.Icon({
                style_class: 'wc-item-action-icon',
                icon_name: 'user-trash-symbolic',
                icon_size: 14,
            })),
        });
        deleteButton.connect('clicked', () => this._deleteArchivedItem(item));
        this._usePointerCursor(deleteButton);
        this._addTooltip(deleteButton, 'Delete permanently');
        row.add_child(deleteButton);

        return {restoreButton, deleteButton};
    }

    _archiveExpiryLabel(item) {
        const now = Date.now();
        const archivedDays = Math.floor((now - item.deletedAt) / DAY_MS);
        const remainingDays = Math.max(0, Math.ceil(
            (item.deletedAt + ARCHIVE_RETENTION_MS - now) / DAY_MS
        ));
        const archivedText = archivedDays === 0
            ? 'Archived today'
            : `Archived ${archivedDays} day${archivedDays === 1 ? '' : 's'} ago`;
        const expiryText = remainingDays === 0
            ? 'Deletes today'
            : `Deletes in ${remainingDays} day${remainingDays === 1 ? '' : 's'}`;
        return `${archivedText} · ${expiryText}`;
    }

    _addTooltip(actor, text) {
        actor.connect('notify::hover', () => {
            if (!actor.hover) {
                if (this._tooltipOwner === actor)
                    this._hideTooltip();
                return;
            }

            this._hideTooltip();
            this._tooltipOwner = actor;
            if (!this._isOpen || !this._tooltip)
                return;

            const label = typeof text === 'function' ? text() : text;
            this._showTooltip(actor, label);
        });
        actor.connect('destroy', () => {
            if (this._tooltipOwner === actor)
                this._hideTooltip();
        });
    }

    _showTooltip(actor, text) {
        if (!text)
            return;

        this._tooltip.set_text(text);
        this._tooltip.visible = true;
        const [actorX, actorY] = actor.get_transformed_position();
        const [actorWidth, actorHeight] = actor.get_transformed_size();
        const [overlayX, overlayY] = this._overlay.get_transformed_position();
        const [, naturalWidth] = this._tooltip.get_preferred_width(-1);
        const [, naturalHeight] = this._tooltip.get_preferred_height(naturalWidth);
        const maxX = Math.max(8, this._overlay.width - naturalWidth - 8);
        const x = Math.min(
            maxX,
            Math.max(8, Math.round(
                actorX - overlayX + actorWidth / 2 - naturalWidth / 2
            ))
        );
        let y = Math.round(actorY - overlayY + actorHeight + 8);
        if (y + naturalHeight > this._overlay.height - 8)
            y = Math.round(actorY - overlayY - naturalHeight - 8);
        this._tooltip.set_position(x, y);
    }

    _hideTooltip() {
        this._tooltipOwner = null;
        if (this._tooltip)
            this._tooltip.visible = false;
    }

    _usePointerCursor(actor) {
        this._pointerCursorActors ??= new Set();
        actor.track_hover = true;
        actor.connect('notify::hover', () => {
            if (actor.hover)
                this._pointerCursorActors.add(actor);
            else
                this._pointerCursorActors.delete(actor);
            global.display.set_cursor(this._pointerCursorActors.size > 0
                ? Meta.Cursor.POINTING_HAND
                : Meta.Cursor.DEFAULT);
        });
        actor.connect('destroy', () => {
            this._pointerCursorActors.delete(actor);
            if (this._pointerCursorActors.size === 0)
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

    _showClearConfirmation() {
        if (this._extension.store.ordered().length === 0)
            return;

        this._stopCaretBlink();
        this._clearConfirmOverlay.visible = true;
        global.stage.set_key_focus(this._clearCancelButton);
    }

    _hideClearConfirmation() {
        this._clearConfirmOverlay.visible = false;
        this._focusSearch();
    }

    _confirmClearHistory() {
        this._clearConfirmOverlay.visible = false;
        this._extension.store.archiveAll();
        this._extension.scheduleArchivePurge();
        this._editingNicknameId = null;
        this._nicknameEditor.visible = false;
        this._nicknameEntry.clutter_text.set_cursor_visible(false);
        this._selectedIndex = 0;
        this._render();
        this._focusSearch();
    }

    _restoreAll() {
        this._extension.store.restoreAll();
        this._extension.scheduleArchivePurge();
        this._selectedIndex = 0;
        this._render();
        this._focusSearch();
    }

    _archiveItem(item) {
        this._extension.store.archive(item.id);
        this._extension.scheduleArchivePurge();
        this._render();
        this._focusSearch();
    }

    _restoreItem(item) {
        this._extension.store.restore(item.id);
        this._extension.scheduleArchivePurge();
        this._render();
        this._focusSearch();
    }

    _deleteArchivedItem(item) {
        this._extension.store.delete(item.id);
        this._extension.scheduleArchivePurge();
        this._render();
        this._focusSearch();
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
        if (this._recordingAction)
            return this._onShortcutRecorderKeyPress(event);

        const symbol = event.get_key_symbol();
        const modifiers = event.get_state() & SHORTCUT_MODIFIER_MASK;

        if (symbol === Clutter.KEY_Escape) {
            if (this._clearConfirmOverlay.visible) {
                this._hideClearConfirmation();
                return Clutter.EVENT_STOP;
            }
            if (this._showHelp) {
                this._setHelpVisible(false);
                return Clutter.EVENT_STOP;
            }
            if (this._showSettings) {
                this._setSettingsVisible(false);
                return Clutter.EVENT_STOP;
            }
            this.close();
            return Clutter.EVENT_STOP;
        }

        if (this._showSettings)
            return Clutter.EVENT_PROPAGATE;

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

        if (this._extension.matchesShortcut(event, 'shortcut-copy')) {
            const item = this._visibleItems[this._selectedIndex];
            if (item && !this._showTrash)
                this._activate(item, false);
            return Clutter.EVENT_STOP;
        }

        if ((symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) &&
            modifiers === 0) {
            const item = this._visibleItems[this._selectedIndex];
            if (item && !this._showTrash)
                this._activate(item, true);
            return Clutter.EVENT_STOP;
        }

        if (symbol === Clutter.KEY_Delete && modifiers === 0) {
            const item = this._visibleItems[this._selectedIndex];
            if (item) {
                if (this._showTrash)
                    this._deleteArchivedItem(item);
                else
                    this._archiveItem(item);
            }
            return Clutter.EVENT_STOP;
        }

        if (this._extension.matchesShortcut(event, 'shortcut-pin')) {
            const item = this._visibleItems[this._selectedIndex];
            if (item && !this._showTrash) {
                this._extension.store.togglePinned(item.id);
                this._render();
            }
            return Clutter.EVENT_STOP;
        }

        if (this._extension.matchesShortcut(event, 'shortcut-nickname')) {
            const item = this._visibleItems[this._selectedIndex];
            if (item && !this._showTrash)
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
        const hovered = row.hover || actions.mainButton.hover;
        if (actions.archived) {
            actions.restoreButton.visible = selected || hovered;
            actions.deleteButton.visible = selected || hovered;
            return;
        }

        actions.nicknameButton.visible = selected || hovered;
        actions.pinButton.visible = selected || hovered || actions.pinned;
        actions.archiveButton.visible = selected || hovered;
    }

    _activate(item, paste) {
        this.close();
        if (item.type === 'image') {
            if (this._extension.isTerminalWindow(this._previousWindow)) {
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
        this._archivePurgeSource = 0;
        this._captureSerial = 0;
        this._skippedClipboardText = null;

        this._previewSignal = this.settings.connect(
            'changed::preview-popup-request',
            () => {
                if (!this.settings.get_boolean('preview-popup-request'))
                    return;
                this.settings.set_boolean('preview-popup-request', false);
                this.popup?.open();
            }
        );
        if (this.settings.get_boolean('preview-popup-request'))
            this.settings.set_boolean('preview-popup-request', false);

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
            this.scheduleArchivePurge();
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

        if (this._previewSignal) {
            this.settings.disconnect(this._previewSignal);
            this._previewSignal = 0;
        }

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

        if (this._archivePurgeSource) {
            GLib.Source.remove(this._archivePurgeSource);
            this._archivePurgeSource = 0;
        }

        this.popup?.destroy();
        this.popup = null;
        this.store?.flush();
        this.store = null;
        this.settings = null;
        this._clipboard = null;
    }

    matchesShortcut(event, settingsKey) {
        const [keyval, modifiers] = this.settings
            .get_value(settingsKey)
            .deep_unpack();
        if (!keyval)
            return false;

        const eventModifiers = event.get_state() & SHORTCUT_MODIFIER_MASK;
        return normalizedShortcutKeyval(event.get_key_symbol()) === keyval &&
            eventModifiers === (modifiers & SHORTCUT_MODIFIER_MASK);
    }

    shortcutLabel(settingsKey) {
        if (settingsKey === 'shortcut-paste')
            return 'Enter';
        if (settingsKey === 'shortcut-archive')
            return 'Delete';
        const [keyval, _modifiers, label] = this.settings
            .get_value(settingsKey)
            .deep_unpack();
        return keyval && label ? label : 'Disabled';
    }

    shortcutDefinitions() {
        const shortcuts = [];
        const globalAccelerator = this.settings.get_strv('toggle-popup')[0];
        if (globalAccelerator) {
            shortcuts.push([
                this._acceleratorTokens(globalAccelerator),
                'Open Clipboard Deck',
            ]);
        }

        for (const [settingsKey, description, fixedLabel] of LOCAL_SHORTCUTS) {
            if (fixedLabel) {
                shortcuts.push([[fixedLabel], description]);
                continue;
            }
            const [keyval, _modifiers, label] = this.settings
                .get_value(settingsKey)
                .deep_unpack();
            if (keyval && label)
                shortcuts.push([label.split('+'), description]);
        }

        shortcuts.push(
            [['↑', '↓'], 'Move through history'],
            [['Esc'], 'Close this panel or Deck']
        );
        return shortcuts;
    }

    _acceleratorTokens(accelerator) {
        const modifierNames = {
            Alt: 'Alt',
            Control: 'Ctrl',
            Ctrl: 'Ctrl',
            Hyper: 'Hyper',
            Meta: 'Meta',
            Mod1: 'Alt',
            Primary: 'Ctrl',
            Shift: 'Shift',
            Super: 'Super',
        };
        const tokens = [...accelerator.matchAll(/<([^>]+)>/g)]
            .map(match => modifierNames[match[1]] ?? match[1]);
        const rawKey = accelerator.replaceAll(/<[^>]+>/g, '');
        const keyNames = {
            Delete: 'Delete',
            KP_Enter: 'Enter',
            Return: 'Enter',
            space: 'Space',
        };
        const key = keyNames[rawKey] ??
            (rawKey.length === 1 ? rawKey.toLocaleUpperCase() : rawKey);
        if (key)
            tokens.push(key);
        return tokens;
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

    scheduleArchivePurge() {
        if (this._archivePurgeSource) {
            GLib.Source.remove(this._archivePurgeSource);
            this._archivePurgeSource = 0;
        }

        const nextExpiry = this.store?.nextArchiveExpiry();
        if (!nextExpiry)
            return;

        const delay = Math.max(1_000, Math.min(
            nextExpiry - Date.now(),
            0x7fffffff
        ));
        this._archivePurgeSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            delay,
            () => {
                this._archivePurgeSource = 0;
                if (this.store?.purgeExpired())
                    this.popup?.refresh();
                this.scheduleArchivePurge();
                return GLib.SOURCE_REMOVE;
            }
        );
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
