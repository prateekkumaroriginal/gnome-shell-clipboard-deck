# Clipboard

A personal Windows-style clipboard history extension for GNOME Shell 46.

## Behavior

- `Super+V` opens the popup.
- Type to search.
- `Up` and `Down` navigate.
- `Enter` copies and attempts to paste.
- `Shift+Enter` copies without direct paste.
- `Ctrl+P` pins or unpins.
- `Delete` removes the selected item.
- `Escape` closes without changing the clipboard.

History is stored locally at:

```text
~/.cache/windows-clipboard@local/history.json
```

The first release captures text only. Entries longer than 20,000 characters
are ignored, and unpinned history is limited to 200 items.

## Source layout

- `extension/extension.js`: clipboard capture, persistence, popup, and shortcuts
- `extension/stylesheet.css`: GNOME Shell presentation
- `extension/schemas/`: `Super+V` keybinding schema
- `PRODUCT.md` and `DESIGN.md`: product and visual contracts

## Local installation

The extension is installed at:

```text
~/.local/share/gnome-shell/extensions/windows-clipboard@local
```

GNOME notifications remain available on `Super+M`; `Super+V` is reserved for
Clipboard. A newly installed local UUID becomes available after logging out and
back in on this Wayland session.

To disable Clipboard:

```bash
gnome-extensions disable windows-clipboard@local
```

To restore the previously installed Clipboard Indicator:

```bash
gnome-extensions enable clipboard-indicator@tudmotu.com
```
