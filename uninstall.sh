#!/usr/bin/env bash
set -euo pipefail

readonly HOST_NAME="lol.animeplex.source_page_metadata"
readonly HOST_PATH="${HOME}/.local/lib/opera-source-page-metadata/source_page_metadata_host.py"
readonly MANIFEST_PATH="${HOME}/.config/opera/NativeMessagingHosts/${HOST_NAME}.json"

rm -f -- "${HOST_PATH}" "${MANIFEST_PATH}"
rmdir -- "${HOME}/.local/lib/opera-source-page-metadata" 2>/dev/null || true

echo "Native companion removed. Remove Source Page Metadata from opera://extensions to finish."
echo "Existing file metadata was left untouched."
