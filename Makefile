UUID := clipboard-deck@prateekkumaroriginal.github.io
ZIP := dist/$(UUID).shell-extension.zip

.PHONY: validate pack install

validate:
	node --check extension/extension.js
	node --check extension/prefs.js
	glib-compile-schemas --strict --dry-run extension/schemas

pack: validate
	mkdir -p dist
	gnome-extensions pack --force --out-dir=dist --extra-source=icons extension
	unzip -t $(ZIP)

install: pack
	gnome-extensions install --force $(ZIP)
