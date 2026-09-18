UUID := clipboard-deck@prateekkumaroriginal.github.io
ZIP := dist/$(UUID).shell-extension.zip

.PHONY: validate pack verify-package install

validate:
	node --check extension/extension.js
	node --check extension/search.js
	node --check extension/prefs.js
	node --test test/*.test.js
	glib-compile-schemas --strict --dry-run extension/schemas

pack: validate
	mkdir -p dist
	gnome-extensions pack --force --out-dir=dist --extra-source=icons --extra-source=prefs.css --extra-source=search.js extension
	unzip -t $(ZIP)
	bash scripts/verify-package.sh $(ZIP)

verify-package:
	bash scripts/verify-package.sh $(ZIP)

install: pack
	gnome-extensions install --force $(ZIP)
