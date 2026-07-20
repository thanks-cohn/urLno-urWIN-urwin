#!/usr/bin/env python3
"""Native-messaging host that attaches a source webpage URL to a downloaded file."""

from __future__ import annotations

import json
import os
from pathlib import Path
import struct
import sys
from typing import Any
from urllib.parse import urlparse


XATTR_NAME = "user.source_page_url"
MAX_MESSAGE_BYTES = 1024 * 1024
MAX_URL_BYTES = 16 * 1024


def allowed_roots() -> list[Path]:
    home = Path.home().resolve()
    roots = [home, Path("/run/media") / home.name, Path("/media") / home.name]

    extra = os.environ.get("SOURCE_PAGE_METADATA_EXTRA_ROOTS", "")
    roots.extend(Path(value).expanduser() for value in extra.split(os.pathsep) if value)

    return [root.resolve() for root in roots if root.exists()]


def is_beneath(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def validate_source_url(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("sourcePageUrl must be a string")

    encoded = value.encode("utf-8")
    if not encoded or len(encoded) > MAX_URL_BYTES:
        raise ValueError("sourcePageUrl is empty or too long")

    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("sourcePageUrl must be an absolute HTTP or HTTPS URL")

    return value


def validate_file_path(value: Any) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError("path must be a non-empty string")

    supplied = Path(value).expanduser()
    if not supplied.is_absolute():
        raise ValueError("path must be absolute")

    resolved = supplied.resolve(strict=True)
    if not resolved.is_file():
        raise ValueError("path is not a regular file")

    if not any(is_beneath(resolved, root) for root in allowed_roots()):
        raise ValueError("path is outside the allowed download locations")

    return resolved


def set_source_page_url(path_value: Any, url_value: Any) -> dict[str, Any]:
    path = validate_file_path(path_value)
    source_url = validate_source_url(url_value)
    encoded = source_url.encode("utf-8")

    os.setxattr(path, XATTR_NAME, encoded)
    written = os.getxattr(path, XATTR_NAME)
    if written != encoded:
        raise OSError("the extended attribute could not be verified")

    return {
        "ok": True,
        "path": str(path),
        "xattrName": XATTR_NAME,
        "sourcePageUrl": source_url,
    }


def handle_message(message: Any) -> dict[str, Any]:
    if not isinstance(message, dict):
        return {"ok": False, "error": "message must be a JSON object"}

    if message.get("action") != "set_source_page_url":
        return {"ok": False, "error": "unknown action"}

    try:
        return set_source_page_url(message.get("path"), message.get("sourcePageUrl"))
    except (OSError, ValueError) as error:
        return {"ok": False, "error": str(error)}


def read_exact(stream: Any, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            raise EOFError("native message ended unexpectedly")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_message() -> Any | None:
    header = sys.stdin.buffer.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise EOFError("invalid native-message header")

    length = struct.unpack("=I", header)[0]
    if length > MAX_MESSAGE_BYTES:
        raise ValueError("native message is too large")

    payload = read_exact(sys.stdin.buffer, length)
    return json.loads(payload.decode("utf-8"))


def write_message(message: dict[str, Any]) -> None:
    payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def native_main() -> int:
    while True:
        try:
            message = read_message()
            if message is None:
                return 0
            write_message(handle_message(message))
        except Exception as error:  # Keep stdout reserved for native protocol messages.
            print(f"Source Page Metadata host error: {error}", file=sys.stderr)
            try:
                write_message({"ok": False, "error": str(error)})
            except Exception:
                return 1


def cli_main(arguments: list[str]) -> int:
    if len(arguments) == 3 and arguments[0] == "--set-url":
        result = set_source_page_url(arguments[1], arguments[2])
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    print("Usage: source_page_metadata_host.py --set-url FILE URL", file=sys.stderr)
    return 2


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].startswith("--"):
        raise SystemExit(cli_main(sys.argv[1:]))
    raise SystemExit(native_main())
