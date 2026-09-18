# Clipboard Deck

Clipboard Deck is a keyboard-first clipboard history popup for GNOME Shell 46.
It keeps a bounded, searchable history of copied text and screenshots and presents it in a
compact Windows-inspired interface.

## Features

- Search up to 200 recent text and image entries.
- Give any entry a searchable nickname with `Ctrl+N` or its `#` button.
- Start a search with `#` to put matching nicknames before content matches.
- See screenshot thumbnails and put a saved screenshot back on the clipboard.
- Navigate with `Up` and `Down`.
- Press `Enter` to copy and attempt to paste the selected entry.
- Press `Shift+Enter` to copy without direct paste.
- Press `Ctrl+P` to pin or unpin an entry.
- Press `Ctrl+N` to add, edit, or clear the selected entry's nickname.
- Archive an entry with its archive-box icon or `Delete`; archived entries can be restored individually or all at once from the Recycle Bin for seven days.
- Press `Escape` to close the popup.
- Customize the global shortcut plus copy-only, pin, and nickname shortcuts in the in-panel Settings view. `Enter` for paste and `Delete` for archiving remain fixed.
- Open the keyboard-and-icon guide, pause capture, clear history after confirmation, restore all archived entries, open the extension's Recycle Bin, or open Settings from the popup header. Settings stays inside the Shell surface, so it opens immediately without creating a taskbar entry. Clearing moves entries to the Recycle Bin and none of these controls clear the system clipboard.

## Set the shortcut

GNOME's publication policy requires clipboard shortcuts to be chosen explicitly
by the user. After installation:

1. Open the Extensions app.
2. Open Clipboard Deck's preferences.
3. Select **Open Clipboard Deck**, then press your preferred key combination.

After the initial shortcut is set, the gear in Clipboard Deck opens the same controls inline. Paste, archive, arrow-key navigation, and `Escape` remain fixed so the popup is always navigable and dismissible. Duplicate shortcuts and unmodified typing keys are rejected.

The same preference window can be opened from a terminal:

```bash
gnome-extensions prefs clipboard-deck@prateekkumaroriginal.github.io
```

## Privacy

Clipboard Deck reads text and images from the system clipboard so it can maintain its
history. It never transmits clipboard contents or makes network requests.

History is stored locally as plaintext at:

```text
~/.cache/clipboard-deck@prateekkumaroriginal.github.io/history.json
```

Screenshot files are stored alongside it in the private `images/` directory.
The containing directory is accessible only to the current user and the history
and image files are written with mode `0600`. Clipboard histories can contain
passwords, tokens, and other sensitive content; pause capture when handling sensitive data.
Entries longer than 20,000 characters are ignored.
Individual images larger than 25 MiB are ignored, and saved images are capped
at 250 MiB total.

## Build and test

Requirements:

- GNOME Shell 46
- `gnome-extensions`
- `glib-compile-schemas`
- Node.js, for syntax validation
- `unzip`, for bundle integrity validation

Build the uploadable extension bundle:

```bash
make pack
```

Install the resulting bundle locally:

```bash
make install
```

During extension development, use this command instead. It packages, installs, and
reloads the extension so the active Shell copy cannot go stale:

```bash
pnpm reload
```

It requires the same local build tools plus `pnpm`.

## Web design lab

The development-only React and Tailwind CSS v4 design lab makes it faster to
explore the popup's layout, visual states, and mocked interaction feedback in a
browser. Install its dependencies and start the Vite development server:

```bash
pnpm install
pnpm preview
```

Vite prints the local URL to open. The design lab lives in `web-preview/` and is
not part of the GNOME extension. `make pack` also verifies that HTML, package
metadata, dependencies, and web preview files are absent from the uploadable ZIP.

## Install a GitHub release

Download the `.shell-extension.zip` file from the
[latest release](https://github.com/prateekkumaroriginal/gnome-shell-clipboard-deck/releases/latest),
then run:

```bash
gnome-extensions install --force \
  clipboard-deck@prateekkumaroriginal.github.io.shell-extension.zip
```

Log out and back in if this is the first installation, enable Clipboard Deck in
the Extensions app, and choose the shortcut in Preferences.

## Source layout

- `extension/extension.js`: clipboard capture, local history, popup, and inline shortcut settings
- `extension/prefs.js` and `extension/prefs.css`: native Preferences fallback for initial setup through GNOME Extensions
- `extension/stylesheet.css`: GNOME Shell presentation
- `web-preview/`: development-only React and Tailwind CSS v4 design lab
- `extension/schemas/`: GSettings schema
- `PRODUCT.md` and `DESIGN.md`: product and visual contracts

## License

[MIT](LICENSE)
