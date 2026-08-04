#!/usr/bin/env bash
set -euo pipefail

extension_uuid='clipboard-deck@prateekkumaroriginal.github.io'
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$script_dir/.." && pwd)"

cd "$project_dir"
make install
gnome-extensions disable "$extension_uuid"
gnome-extensions enable "$extension_uuid"
gnome-extensions info "$extension_uuid"
