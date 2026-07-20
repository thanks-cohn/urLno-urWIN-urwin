# Source Page Metadata for Opera

This extension attaches the exact webpage from which each download was initiated to the completed file as the Linux extended attribute:

```text
user.source_page_url
```

It works with images, ZIP, CBZ, PDF, video, audio, and every other regular file. The file contents and checksum are not changed.

**[Download the complete extension as a ZIP](https://github.com/thanks-cohn/urLno-urWIN-urwin/archive/refs/heads/main.zip)**

## The rule it follows

Every initiating action is captured inside its own tab. The extension records the initiating `tabId`, webpage URL, outgoing request, and resulting `downloadId`.

It never reads whichever tab happens to be active later, and it never keeps a global “last page URL.” If a download cannot be associated safely, it is left untagged rather than receiving another tab's URL.

## Install on native Opera for Linux

Download and unzip the package, open a terminal inside the extracted folder, and run:

```bash
chmod +x install.sh verify-install.sh uninstall.sh run-tests.sh
./install.sh
```

Then:

1. Open `opera://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the package's `extension` directory.
5. Confirm that Opera shows extension ID `pjpjcjodnnbnehokojldkffjnbhcnblk`.
6. Restart Opera once.

The included manifest key keeps the extension ID stable even if the extracted folder is moved.

This package targets native Opera. A Flatpak browser cannot normally launch a host program outside its sandbox without additional portal/Flatpak configuration.

## Confirm the companion works

Run:

```bash
./verify-install.sh
```

Then download something from an ordinary webpage. Click the extension icon to see the file, initiating URL, and whether the URL was attached.

Read a downloaded file's URL without installing any extra package:

```bash
python3 -c 'import os,sys; print(os.getxattr(sys.argv[1], "user.source_page_url").decode())' '/path/to/file.cbz'
```

If the `attr` package is installed, this also works:

```bash
getfattr --only-values -n user.source_page_url '/path/to/file.cbz'
```

## Multiple tabs

The correlation is maintained per initiating tab and then frozen per download ID:

```text
Tab A -> download 101 -> page A
Tab B -> download 102 -> page B
Tab C -> download 103 -> page C
```

Switching tabs or navigating elsewhere after starting a download cannot change an existing binding.

Download buttons that open a temporary `about:blank` child tab are also supported. The child request inherits the frozen source page through Opera's opener/navigation-target relationship, not from whichever tab is active later.

## Filesystem note

Extended attributes are filesystem metadata. They remain attached without modifying ZIP/CBZ/PDF/image bytes, but a copy operation, cloud service, archive operation, or filesystem that does not preserve Linux extended attributes may discard them.

## Remove

Remove the extension from `opera://extensions`, then run:

```bash
./uninstall.sh
```

Uninstalling does not remove metadata already written to downloaded files.
