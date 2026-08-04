#!/usr/bin/env bash
set -euo pipefail

archive_path="${1:?usage: verify-package.sh EXTENSION_ZIP}"

while IFS= read -r packaged_file; do
    case "$packaged_file" in
        web-preview/*|*.html|*node_modules/*|package.json|package-lock.json|pnpm-lock.yaml)
            echo "Unexpected web preview file in extension package: $packaged_file" >&2
            exit 1
            ;;
    esac
done < <(unzip -Z1 "$archive_path")

echo "Verified: development web preview is excluded from $archive_path"
