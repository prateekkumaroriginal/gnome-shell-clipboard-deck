# Clipboard Deck

Clipboard Deck is a keyboard-first clipboard history popup for GNOME Shell 46.
It keeps a bounded, searchable history of copied text and screenshots and presents it in a
compact Windows-inspired interface.

## Features

- Search up to 200 recent text and image entries.
- Give any entry a searchable nickname with `Ctrl+N` or its `#` button.
- See screenshot thumbnails and put a saved screenshot back on the clipboard.
- Navigate with `Up` and `Down`.
- Press `Enter` to copy and attempt to paste the selected entry.
- Press `Shift+Enter` to copy without direct paste.
- Press `Ctrl+P` to pin or unpin an entry.
- Press `Ctrl+N` to add, edit, or clear the selected entry's nickname.
- Press `Delete` to remove the selected entry.
- Press `Escape` to close the popup.
- Pause clipboard capture from the popup header.

## Set the shortcut

GNOME's publication policy requires clipboard shortcuts to be chosen explicitly
by the user. After installation:

1. Open the Extensions app.
2. Open Clipboard Deck's preferences.
3. Select **Use Super+V**.

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

On Wayland, a newly installed UUID may require logging out and back in before
GNOME Shell discovers it.

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

- `extension/extension.js`: clipboard capture, local history, popup, and shortcut
- `extension/prefs.js`: explicit shortcut and privacy preferences
- `extension/stylesheet.css`: GNOME Shell presentation
- `extension/schemas/`: GSettings schema
- `PRODUCT.md` and `DESIGN.md`: product and visual contracts

## License

[MIT](LICENSE)
