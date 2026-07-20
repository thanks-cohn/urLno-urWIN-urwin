#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path
import tempfile

from native.source_page_metadata_host import XATTR_NAME, set_source_page_url


def main() -> None:
    project_root = Path(__file__).resolve().parents[1]
    os.environ["SOURCE_PAGE_METADATA_EXTRA_ROOTS"] = str(project_root)

    source_url = "https://example.test/gallery/tab-b"
    with tempfile.NamedTemporaryFile(dir=project_root, suffix=".cbz") as handle:
        result = set_source_page_url(handle.name, source_url)
        assert result["ok"] is True
        assert os.getxattr(handle.name, XATTR_NAME).decode("utf-8") == source_url

    print("native host xattr test passed")


if __name__ == "__main__":
    main()
