#!/usr/bin/env bash
set -euo pipefail

readonly HOST_PATH="${HOME}/.local/lib/opera-source-page-metadata/source_page_metadata_host.py"
readonly MANIFEST_PATH="${HOME}/.config/opera/NativeMessagingHosts/lol.animeplex.source_page_metadata.json"
readonly TEST_DIR="${HOME}/.cache/opera-source-page-metadata"
readonly TEST_FILE="${TEST_DIR}/metadata-test.cbz"
readonly TEST_URL="https://example.invalid/source-page-test"

test -x "${HOST_PATH}" || { echo "Missing native host: ${HOST_PATH}" >&2; exit 1; }
test -f "${MANIFEST_PATH}" || { echo "Missing Opera host manifest: ${MANIFEST_PATH}" >&2; exit 1; }

install -d -m 0700 -- "${TEST_DIR}"
: > "${TEST_FILE}"
"${HOST_PATH}" --set-url "${TEST_FILE}" "${TEST_URL}" >/dev/null

python3 - "${TEST_FILE}" "${TEST_URL}" <<'PY'
import os
import sys

path, expected = sys.argv[1:]
actual = os.getxattr(path, "user.source_page_url").decode("utf-8")
if actual != expected:
    raise SystemExit(f"Metadata mismatch: {actual!r}")
print(f"Metadata test passed: {actual}")
PY

rm -f -- "${TEST_FILE}"
rmdir -- "${TEST_DIR}" 2>/dev/null || true
echo "Opera companion installation looks correct."
