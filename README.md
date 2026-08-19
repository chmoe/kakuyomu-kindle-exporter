# Kakuyomu Kindle Exporter

Chrome MV3 extension for exporting public Kakuyomu works as EPUB files for Kindle reading.

## Current Scope

- Detects Kakuyomu work pages.
- Reads work metadata and episode list from Kakuyomu's embedded `__NEXT_DATA__`.
- Fetches public episode pages with the user's browser session.
- Builds a dependency-free EPUB file in the popup.
- Automatically adds a generated cover and a front-matter book information page.
- Supports horizontal and vertical EPUB writing modes.
- Downloads the EPUB through Chrome's downloads API.

MOBI/AZW3 generation is not included in the first version. For Kindle, send the EPUB to Kindle or convert it with Calibre.

## Install Locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this project directory.
5. Open a Kakuyomu work page such as `https://kakuyomu.jp/works/{workId}`.
6. Click the extension icon and choose "导出 EPUB".

## Notes

Use this for personal offline reading of content you can access. The extension does not bypass paid or restricted content.
