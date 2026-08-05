import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const ACTIONS = [
    {
        id: 'open',
        settingsKey: 'toggle-popup',
        title: 'Open Clipboard Deck',
        subtitle: 'Works from anywhere',
        global: true,
        defaultShortcut: {keyval: Gdk.KEY_v, modifiers: Gdk.ModifierType.SUPER_MASK},
    },
    {
        id: 'paste',
        settingsKey: 'shortcut-paste',
        title: 'Paste selected item',
        subtitle: 'Copies the item and returns to your app',
        immutable: true,
        defaultShortcut: {keyval: Gdk.KEY_Return, modifiers: 0},
    },
    {
        id: 'copy',
        settingsKey: 'shortcut-copy',
        title: 'Copy without pasting',
        subtitle: 'Leaves the selected item on the clipboard',
        defaultShortcut: {keyval: Gdk.KEY_Return, modifiers: Gdk.ModifierType.SHIFT_MASK},
    },
    {
        id: 'pin',
        settingsKey: 'shortcut-pin',
        title: 'Pin or unpin item',
        subtitle: 'Keeps frequently used items nearby',
        defaultShortcut: {keyval: Gdk.KEY_p, modifiers: Gdk.ModifierType.CONTROL_MASK},
    },
    {
        id: 'nickname',
        settingsKey: 'shortcut-nickname',
        title: 'Add or edit nickname',
        subtitle: 'Makes an item easier to search',
        defaultShortcut: {keyval: Gdk.KEY_n, modifiers: Gdk.ModifierType.CONTROL_MASK},
    },
    {
        id: 'archive',
        settingsKey: 'shortcut-archive',
        title: 'Move to Recycle Bin',
        subtitle: 'Archived items remain recoverable for seven days',
        immutable: true,
        defaultShortcut: {keyval: Gdk.KEY_Delete, modifiers: 0},
    },
];

const MODIFIER_KEYVALS = new Set([
    Gdk.KEY_Shift_L,
    Gdk.KEY_Shift_R,
    Gdk.KEY_Control_L,
    Gdk.KEY_Control_R,
    Gdk.KEY_Alt_L,
    Gdk.KEY_Alt_R,
    Gdk.KEY_Meta_L,
    Gdk.KEY_Meta_R,
    Gdk.KEY_Super_L,
    Gdk.KEY_Super_R,
    Gdk.KEY_Hyper_L,
    Gdk.KEY_Hyper_R,
]);

function normalizedModifiers(modifiers) {
    return modifiers & Gtk.accelerator_get_default_mod_mask();
}

function normalizedKeyval(keyval) {
    return Gdk.keyval_to_lower(keyval);
}

function parseGlobalShortcut(settings) {
    const accelerator = settings.get_strv('toggle-popup')[0] ?? '';
    if (!accelerator)
        return {keyval: 0, modifiers: 0};

    const [success, keyval, modifiers] = Gtk.accelerator_parse(accelerator);
    return success
        ? {keyval: normalizedKeyval(keyval), modifiers: normalizedModifiers(modifiers)}
        : {keyval: 0, modifiers: 0};
}

function readShortcut(settings, action) {
    if (action.immutable)
        return action.defaultShortcut;
    if (action.global)
        return parseGlobalShortcut(settings);

    const [keyval, modifiers] = settings
        .get_value(action.settingsKey)
        .deep_unpack();
    return {
        keyval: normalizedKeyval(keyval),
        modifiers: normalizedModifiers(modifiers),
    };
}

function shortcutAccelerator(shortcut) {
    if (!shortcut.keyval)
        return '';
    return Gtk.accelerator_name(shortcut.keyval, shortcut.modifiers);
}

function shortcutDisplayLabel(shortcut) {
    if (!shortcut.keyval)
        return '';
    return Gtk.accelerator_get_label(shortcut.keyval, shortcut.modifiers)
        .replaceAll('Return', 'Enter')
        .replaceAll('KP Enter', 'Enter');
}

function shortcutsEqual(first, second) {
    return first.keyval === second.keyval &&
        first.modifiers === second.modifiers;
}

export default class ClipboardDeckPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const display = Gdk.Display.get_default();
        const cssProvider = new Gtk.CssProvider();
        cssProvider.load_from_path(`${this.path}/prefs.css`);
        Gtk.StyleContext.add_provider_for_display(
            display,
            cssProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1
        );

        window.set_default_size(850, 900);
        const headerBar = this._findWidget(
            window, widget => widget instanceof Adw.HeaderBar);
        headerBar?.add_css_class('clipboard-deck-header');
        const backButton = new Gtk.Button({
            label: 'Back',
            css_classes: ['prefs-back-button'],
            valign: Gtk.Align.CENTER,
        });
        backButton.connect('clicked', () => {
            settings.set_boolean('preview-popup-request', true);
            window.close();
        });
        headerBar?.pack_start(backButton);

        const page = new Adw.PreferencesPage({
            title: 'Keyboard Shortcuts',
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
            css_classes: ['clipboard-deck-page'],
        });
        const pageGroup = new Adw.PreferencesGroup();
        const root = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            height_request: 820,
            valign: Gtk.Align.START,
            css_classes: ['clipboard-deck-prefs'],
        });
        const rows = new Map();

        const intro = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 14,
            css_classes: ['prefs-intro'],
        });
        const iconTile = new Gtk.CenterBox({
            css_classes: ['prefs-icon-tile'],
            halign: Gtk.Align.START,
            valign: Gtk.Align.CENTER,
        });
        iconTile.set_size_request(52, 52);
        iconTile.set_center_widget(new Gtk.Image({
            file: `${this.path}/icons/preferences-clipboard-symbolic.svg`,
            pixel_size: 24,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        }));
        intro.append(iconTile);
        intro.append(new Gtk.Label({
            label: 'Keyboard shortcuts',
            xalign: 0,
            justify: Gtk.Justification.LEFT,
            halign: Gtk.Align.START,
            valign: Gtk.Align.CENTER,
            css_classes: ['prefs-title'],
        }));
        intro.append(new Gtk.Box({hexpand: true}));
        const resetAllButton = new Gtk.Button({
            label: 'Reset all',
            valign: Gtk.Align.CENTER,
            css_classes: ['prefs-reset-all'],
        });
        resetAllButton.connect('clicked', () => {
            for (const action of ACTIONS) {
                if (!action.immutable)
                    this._writeShortcut(settings, action, action.defaultShortcut);
            }
        });
        intro.append(resetAllButton);
        root.append(intro);

        root.append(this._sectionLabel('Anywhere'));
        const anywhereCard = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            css_classes: ['shortcut-card'],
        });
        root.append(anywhereCard);

        root.append(new Gtk.Label({
            label: 'GNOME may ask you to replace a shortcut already used by the system.',
            halign: Gtk.Align.START,
            wrap: true,
            css_classes: ['section-note'],
        }));
        root.append(this._sectionLabel(
            'While Clipboard Deck is open', true));
        const deckCard = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            css_classes: ['shortcut-card'],
        });
        root.append(deckCard);

        for (const action of ACTIONS) {
            if (action.immutable)
                continue;

            const rowWidgets = this._createShortcutRow(
                window, settings, action);
            const card = action.global ? anywhereCard : deckCard;
            if (card.get_first_child())
                card.append(new Gtk.Separator({css_classes: ['row-separator']}));
            card.append(rowWidgets.row);
            rows.set(action.id, {action, ...rowWidgets});
        }

        pageGroup.add(root);
        page.add(pageGroup);

        const refresh = () => {
            let hasChanges = false;
            for (const {action, keyCaps, resetButton} of rows.values()) {
                const shortcut = readShortcut(settings, action);
                this._setKeyCaps(keyCaps, shortcutDisplayLabel(shortcut));
                const changed = !shortcutsEqual(
                    shortcut, action.defaultShortcut);
                resetButton.visible = changed;
                hasChanges ||= changed;
            }
            resetAllButton.sensitive = hasChanges;
        };

        const settingsSignal = settings.connect('changed', refresh);
        window.connect('close-request', () => {
            settings.disconnect(settingsSignal);
            Gtk.StyleContext.remove_provider_for_display(display, cssProvider);
            return false;
        });

        refresh();
        window.add(page);
    }

    _findWidget(root, predicate) {
        if (predicate(root))
            return root;
        for (let child = root.get_first_child?.(); child;
            child = child.get_next_sibling()) {
            const match = this._findWidget(child, predicate);
            if (match)
                return match;
        }
        return null;
    }

    _sectionLabel(text, secondary = false) {
        return new Gtk.Label({
            label: text.toLocaleUpperCase(),
            halign: Gtk.Align.START,
            css_classes: secondary
                ? ['section-label', 'secondary-section-label']
                : ['section-label'],
        });
    }

    _createShortcutRow(window, settings, action) {
        const row = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            css_classes: ['shortcut-row'],
        });
        const copy = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            hexpand: true,
            valign: Gtk.Align.CENTER,
            css_classes: ['shortcut-copy'],
        });
        copy.append(new Gtk.Label({
            label: action.title,
            halign: Gtk.Align.START,
            ellipsize: 3,
            css_classes: ['shortcut-title'],
        }));
        copy.append(new Gtk.Label({
            label: action.subtitle,
            halign: Gtk.Align.START,
            ellipsize: 3,
            css_classes: ['shortcut-subtitle'],
        }));
        row.append(copy);

        const resetButton = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['shortcut-reset'],
            tooltip_text: `Reset ${action.title}`,
        });
        resetButton.connect('clicked', () =>
            this._writeShortcut(settings, action, action.defaultShortcut));
        if (!action.immutable)
            row.append(resetButton);

        const editContent = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            halign: Gtk.Align.CENTER,
        });
        const keyCaps = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 4,
            valign: Gtk.Align.CENTER,
            css_classes: ['key-caps'],
        });
        editContent.append(keyCaps);
        if (action.immutable) {
            editContent.add_css_class('shortcut-fixed');
            editContent.set_valign(Gtk.Align.CENTER);
            row.append(editContent);
        } else {
            const editButton = new Gtk.Button({
                child: editContent,
                valign: Gtk.Align.CENTER,
                css_classes: ['shortcut-edit'],
                tooltip_text: `Change ${action.title}`,
            });
            editButton.connect('clicked', () =>
                this._showShortcutDialog(window, settings, action));
            row.append(editButton);
        }
        return {row, keyCaps, resetButton};
    }

    _setKeyCaps(container, label, large = false) {
        while (container.get_first_child())
            container.remove(container.get_first_child());

        if (!label) {
            container.append(new Gtk.Label({
                label: 'Disabled',
                css_classes: ['shortcut-disabled'],
            }));
            return;
        }

        for (const token of label.split('+')) {
            container.append(new Gtk.Label({
                label: token.trim(),
                xalign: 0.5,
                css_classes: large
                    ? ['key-cap', 'large-key-cap']
                    : ['key-cap'],
            }));
        }
    }

    _showShortcutDialog(window, settings, action) {
        const dialog = new Adw.Dialog({
            title: 'Set shortcut',
            content_width: 390,
            content_height: 250,
            css_classes: ['shortcut-recorder'],
        });
        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            css_classes: ['shortcut-recorder-card'],
        });
        content.append(new Gtk.Label({
            label: action.title,
            halign: Gtk.Align.CENTER,
            css_classes: ['recorder-title'],
        }));
        const recordedShortcut = new Gtk.Box({
            halign: Gtk.Align.FILL,
            css_classes: ['recorded-shortcut'],
        });
        const keyCaps = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 5,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            css_classes: ['key-caps'],
        });
        recordedShortcut.append(keyCaps);
        const message = new Gtk.Label({
            label: 'Press the keys you want to use together',
            wrap: true,
            justify: Gtk.Justification.CENTER,
            margin_top: 4,
            css_classes: ['recorder-message'],
        });
        content.append(recordedShortcut);
        content.append(message);

        const spacer = new Gtk.Box({vexpand: true});
        content.append(spacer);
        const actions = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            halign: Gtk.Align.END,
            css_classes: ['recorder-actions'],
        });
        const cancelButton = new Gtk.Button({
            label: 'Cancel',
            css_classes: ['recorder-button'],
        });
        const setButton = new Gtk.Button({
            label: 'Set',
            css_classes: ['recorder-button', 'recorder-set'],
        });
        cancelButton.connect('clicked', () => dialog.close());
        actions.append(cancelButton);
        actions.append(setButton);
        content.append(actions);
        dialog.set_child(content);

        let candidate = readShortcut(settings, action);
        let candidateValid = candidate.keyval !== 0;

        const updateCandidate = (shortcut, error = '') => {
            candidate = shortcut;
            candidateValid = shortcut.keyval !== 0 && !error;
            this._setKeyCaps(
                keyCaps, shortcutDisplayLabel(shortcut), true);
            message.label = error || 'Press the keys you want to use together';
            if (error) {
                message.add_css_class('error');
                recordedShortcut.add_css_class('has-error');
            } else {
                message.remove_css_class('error');
                recordedShortcut.remove_css_class('has-error');
            }
            setButton.sensitive = candidateValid;
        };

        updateCandidate(candidate);

        const controller = new Gtk.EventControllerKey({
            propagation_phase: Gtk.PropagationPhase.CAPTURE,
        });
        controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
            if (keyval === Gdk.KEY_Escape) {
                dialog.close();
                return true;
            }
            if (MODIFIER_KEYVALS.has(keyval))
                return true;

            const modifiers = normalizedModifiers(state);
            const shortcut = {
                keyval: normalizedKeyval(keyval),
                modifiers,
            };

            if ([Gdk.KEY_Up, Gdk.KEY_Down, Gdk.KEY_Escape].includes(keyval)) {
                updateCandidate(shortcut,
                    'Arrow navigation and Escape stay available and cannot be reassigned.');
                return true;
            }

            const unicode = Gdk.keyval_to_unicode(keyval);
            if (modifiers === 0 && unicode >= 0x20 && unicode !== 0x7f) {
                updateCandidate(shortcut,
                    'Use Super, Ctrl, or Alt with typing keys so search still works.');
                return true;
            }

            if (!Gtk.accelerator_valid(keyval, modifiers)) {
                updateCandidate(shortcut,
                    'Use Super, Ctrl, or Alt with letters and numbers so search still works.');
                return true;
            }

            const conflict = ACTIONS.find(other =>
                other.id !== action.id &&
                shortcutsEqual(readShortcut(settings, other), shortcut));
            updateCandidate(shortcut, conflict
                ? `Already used for “${conflict.title}”.`
                : '');
            return true;
        });
        dialog.add_controller(controller);

        setButton.connect('clicked', () => {
            if (candidateValid) {
                this._writeShortcut(settings, action, candidate);
                dialog.close();
            }
        });
        dialog.set_default_widget(setButton);
        dialog.present(window);
    }

    _writeShortcut(settings, action, shortcut) {
        if (action.immutable)
            return;
        if (action.global) {
            const accelerator = shortcutAccelerator(shortcut);
            settings.set_strv('toggle-popup', accelerator ? [accelerator] : []);
            return;
        }

        const label = shortcut.keyval
            ? shortcutDisplayLabel(shortcut)
            : '';
        settings.set_value(action.settingsKey, new GLib.Variant('(uus)', [
            shortcut.keyval,
            shortcut.modifiers,
            label,
        ]));
    }
}
