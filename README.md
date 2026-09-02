# Kakuyomu Kindle Exporter

Chrome MV3 extension for exporting public Kakuyomu works as EPUB files for Kindle reading.

## Current Scope

- Detects Kakuyomu work and episode pages.
- Reads work metadata and episode list from Kakuyomu's embedded `__NEXT_DATA__`.
- Fetches public episode pages with the user's browser session.
- Builds a dependency-free EPUB file in the popup, yielding during long packaging work to keep the UI responsive.
- Automatically adds a generated cover and a front-matter book information page.
- Supports horizontal and vertical EPUB writing modes.
- Builds nested EPUB navigation when Kakuyomu volume/chapter hierarchy is available.
- Preserves common inline/body formatting such as ruby, emphasis, headings, and separators.
- Includes a Kindle compatibility mode with simplified layout and text cover.
- Previews selected chapters before export completion, with cached/current-page markers and a full-text toggle.
- Retries transient episode fetch failures and keeps in-progress chapters in per-chapter session cache.
- Saves and imports resumable `.kakuyomu-export.json` or compressed `.kakuyomu-export.json.gz` progress files.
- Shows cached chapter counts and can clear the current work's session cache.
- Offers current-chapter and from-current-chapter quick export buttons on episode pages.
- Supports EPUB file name templates and records recent exports for the current work.
- Groups popup controls into collapsible sections and shows categorized recovery hints for common errors.
- Downloads the EPUB through Chrome's downloads API.

MOBI/AZW3 generation is not included in the first version. For Kindle, send the EPUB to Kindle or convert it with Calibre.

## Install Locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this project directory.
5. Open a Kakuyomu work page such as `https://kakuyomu.jp/works/{workId}`. Episode pages under the same work URL are also supported.
6. Click the extension icon and choose "导出 EPUB".

## Options

- Use "Kindle 兼容模式" if Send to Kindle or an older device has trouble with the normal EPUB. It disables vertical layout metadata and replaces the SVG image cover with a simpler text cover.
- Use "预览章节" to fetch and inspect a selected chapter before the full export finishes. On an episode page, preview defaults to the current chapter.
- Use "清除缓存" to discard completed chapters stored for the current work in the browser session.
- On an episode page, use "仅当前章" or "从当前章开始" for quick partial exports.
- Choose a file name template under "排版选项" if you want author or chapter range details in exported EPUB names.
- Keep "压缩中间文件" enabled for smaller progress files. If a browser cannot import compressed progress files, save again as JSON by turning it off.

## Resume an Interrupted Export

If an export is cancelled or fails, the extension saves a progress file. To continue later:

1. Open the same Kakuyomu work page.
2. Click "导入中间文件" and choose the saved progress file.
3. Click "导出 EPUB" again.

The extension reuses completed chapters from the progress file and only fetches missing chapters.

## Notes

Use this for personal offline reading of content you can access. The extension does not bypass paid or restricted content.

## Development

Run the local parser and EPUB structure checks with:

```sh
npm test
```

Run the sample EPUB validator with:

```sh
npm run validate:epub
```
