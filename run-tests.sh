#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

node --check "${SCRIPT_DIR}/extension/background.js"
node --check "${SCRIPT_DIR}/extension/content.js"
node --check "${SCRIPT_DIR}/extension/matcher.js"
node --check "${SCRIPT_DIR}/extension/popup.js"
node "${SCRIPT_DIR}/tests/matcher.test.js"

PYTHONPATH="${SCRIPT_DIR}" python3 "${SCRIPT_DIR}/tests/test_native_host.py"
python3 -m py_compile "${SCRIPT_DIR}/native/source_page_metadata_host.py"

python3 - "${SCRIPT_DIR}/extension/manifest.json" <<'PY'
import json
import base64
import hashlib
from pathlib import Path
import sys

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert manifest["manifest_version"] == 3
assert manifest["background"]["service_worker"] == "background.js"
assert "downloads" in manifest["permissions"]
assert "nativeMessaging" in manifest["permissions"]
assert "webRequest" in manifest["permissions"]
public_key = base64.b64decode(manifest["key"])
digest = hashlib.sha256(public_key).digest()[:16]
extension_id = "".join(chr(97 + (byte >> 4)) + chr(97 + (byte & 15)) for byte in digest)
assert extension_id == "pjpjcjodnnbnehokojldkffjnbhcnblk"
print("manifest test passed")
PY

if rg -n 'tabs\.query|lastPageUrl|activeTab' "${SCRIPT_DIR}/extension"; then
  echo "Forbidden active-tab or global-last-URL logic found." >&2
  exit 1
fi

echo "All tests passed."
