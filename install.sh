#!/usr/bin/env bash
set -euo pipefail

readonly EXTENSION_ID="pjpjcjodnnbnehokojldkffjnbhcnblk"
readonly HOST_NAME="lol.animeplex.source_page_metadata"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly INSTALL_DIR="${HOME}/.local/lib/opera-source-page-metadata"
readonly HOST_PATH="${INSTALL_DIR}/source_page_metadata_host.py"
readonly MANIFEST_DIR="${HOME}/.config/opera/NativeMessagingHosts"
readonly MANIFEST_PATH="${MANIFEST_DIR}/${HOST_NAME}.json"

install -d -m 0755 -- "${INSTALL_DIR}" "${MANIFEST_DIR}"
install -m 0755 -- "${SCRIPT_DIR}/native/source_page_metadata_host.py" "${HOST_PATH}"

python3 - "${MANIFEST_PATH}" "${HOST_PATH}" "${HOST_NAME}" "${EXTENSION_ID}" <<'PY'
import json
from pathlib import Path
import sys

manifest_path, host_path, host_name, extension_id = sys.argv[1:]
payload = {
    "name": host_name,
    "description": "Writes the initiating webpage URL to completed downloads",
    "path": host_path,
    "type": "stdio",
    "allowed_origins": [f"chrome-extension://{extension_id}/"],
}
Path(manifest_path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY

echo "Native companion installed."
echo
echo "Now open opera://extensions"
echo "1. Enable Developer mode."
echo "2. Click Load unpacked."
echo "3. Select: ${SCRIPT_DIR}/extension"
echo "4. Confirm the extension ID is: ${EXTENSION_ID}"
echo
echo "Restart Opera once after loading the extension."
