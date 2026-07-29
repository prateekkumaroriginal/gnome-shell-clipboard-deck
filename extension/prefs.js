import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SHORTCUT = '<Super>v';

export default class ClipboardDeckPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Clipboard Deck',
            icon_name: 'edit-paste-symbolic',
        });

        const shortcutGroup = new Adw.PreferencesGroup({
            title: 'Keyboard shortcut',
            description: 'Clipboard shortcuts are assigned only after you choose one.',
        });
        const shortcutRow = new Adw.ActionRow({
            title: 'Open clipboard history',
        });
        const status = new Gtk.Label({
            valign: Gtk.Align.CENTER,
            css_classes: ['dim-label'],
        });
        const buttons = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
        });
        const disableButton = new Gtk.Button({label: 'Disable'});
        const useButton = new Gtk.Button({
            label: 'Use Super+V',
            css_classes: ['suggested-action'],
        });

        const refresh = () => {
            const enabled = settings.get_strv('toggle-popup').length > 0;
            status.label = enabled ? 'Super+V' : 'Not set';
            disableButton.sensitive = enabled;
            useButton.sensitive = !enabled;
        };

        disableButton.connect('clicked', () => {
            settings.set_strv('toggle-popup', []);
            refresh();
        });
        useButton.connect('clicked', () => {
            settings.set_strv('toggle-popup', [SHORTCUT]);
            refresh();
        });

        buttons.append(disableButton);
        buttons.append(useButton);
        shortcutRow.add_suffix(status);
        shortcutRow.add_suffix(buttons);
        shortcutGroup.add(shortcutRow);
        page.add(shortcutGroup);

        const privacyGroup = new Adw.PreferencesGroup({title: 'Privacy'});
        privacyGroup.add(new Adw.ActionRow({
            title: 'Local clipboard history',
            subtitle: 'Copied text and images are stored only in your user cache and are never transmitted.',
        }));
        page.add(privacyGroup);

        refresh();
        window.add(page);
    }
}
