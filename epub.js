(function () {
  const encoder = new TextEncoder();
  const PARAGRAPH_INDENT = "\u3000";

  window.KakuyomuEpub = {
    buildEpub,
    buildEpubAsync
  };

  const BUILD_CHUNK_SIZE = 12;

  function buildEpub({ work, chapters, includeDescription, writingMode = "horizontal", compatibleMode = false }) {
    const bookWritingMode = compatibleMode ? "horizontal" : writingMode;
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const bookId = `urn:kakuyomu:${work.id || crypto.randomUUID()}`;
    const safeTitle = escapeXml(work.title || "Kakuyomu Work");
    const safeAuthor = escapeXml(work.author || "Unknown Author");
    const hasImageCover = !compatibleMode;
    const coverSvg = hasImageCover ? buildCoverSvg(work, chapters.length) : "";
    const entries = [];

    entries.push(file("mimetype", "application/epub+zip"));
    entries.push(file("META-INF/container.xml", xml(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)));

    entries.push(file("OEBPS/styles/book.css", css(bookWritingMode, compatibleMode)));
    if (hasImageCover) {
      entries.push(file("OEBPS/images/cover.svg", coverSvg));
    }

    const xhtmlFiles = [];
    const readingOrder = [{ id: "cover", href: "cover.xhtml", title: "表紙" }];
    const cover = xhtml("cover", "表紙", coverBody(work, chapters.length, safeTitle, bookWritingMode, hasImageCover), bookWritingMode);
    entries.push(file("OEBPS/cover.xhtml", cover));
    xhtmlFiles.push({ id: "cover", href: "cover.xhtml", title: "表紙" });

    if (includeDescription) {
      const intro = xhtml("intro", "本書について", [
        `<section class="book-info" epub:type="frontmatter">`,
        `<h1>${formatText(work.title || "Kakuyomu Work", bookWritingMode)}</h1>`,
        `<p class="author">${formatText(work.author || "Unknown Author", bookWritingMode)}</p>`,
        `<h2>${formatText("作品紹介", bookWritingMode)}</h2>`,
        ...descriptionParagraphs(work.description, bookWritingMode),
        `<dl class="metadata">`,
        `<dt>${formatText("収録話数", bookWritingMode)}</dt><dd>${formatText(`${chapters.length}話`, bookWritingMode)}</dd>`,
        `<dt>${formatText("出典", bookWritingMode)}</dt><dd>${formatText(work.sourceUrl || "", bookWritingMode)}</dd>`,
        `<dt>${formatText("生成日時", bookWritingMode)}</dt><dd>${formatText(formatDate(now), bookWritingMode)}</dd>`,
        `</dl>`,
        `</section>`
      ], bookWritingMode);
      entries.push(file("OEBPS/intro.xhtml", intro));
      xhtmlFiles.push({ id: "intro", href: "intro.xhtml", title: "本書について" });
      readingOrder.push({ id: "intro", href: "intro.xhtml", title: "本書について" });
    }

    readingOrder.push({ id: "nav", href: "nav.xhtml", title: "目次" });

    chapters.forEach((chapter, index) => {
      const id = `chapter-${index + 1}`;
      const href = `${id}.xhtml`;
      entries.push(file(`OEBPS/${href}`, xhtml(id, chapter.title, [
        `<h1>${formatText(chapter.title, bookWritingMode)}</h1>`,
        ...chapter.body.map((line) => renderBodyLine(line, bookWritingMode))
      ], bookWritingMode)));
      xhtmlFiles.push({
        id,
        href,
        title: chapter.title,
        rawTitle: chapter.rawTitle || chapter.title,
        chapterTitles: Array.isArray(chapter.chapterTitles) ? chapter.chapterTitles : []
      });
      readingOrder.push({ id, href, title: chapter.title });
    });

    entries.push(file("OEBPS/nav.xhtml", navXhtml(work, xhtmlFiles, bookWritingMode)));
    entries.push(file("OEBPS/toc.ncx", ncx({
      bookId,
      title: work.title || "Kakuyomu Work",
      author: work.author || "Unknown Author",
      files: xhtmlFiles
    })));
    entries.push(file("OEBPS/content.opf", opf({
      bookId,
      title: safeTitle,
      author: safeAuthor,
      sourceUrl: work.sourceUrl || "",
      modified: now,
      files: xhtmlFiles,
      readingOrder,
      writingMode: bookWritingMode,
      hasCover: hasImageCover
    })));

    return makeZip(entries);
  }

  async function buildEpubAsync(options, hooks = {}) {
    const buildOptions = normalizeBuildOptions(options);
    const { work, chapters, includeDescription, bookWritingMode, hasImageCover, coverSvg, now, bookId, safeTitle, safeAuthor } = buildOptions;
    const entries = [];

    entries.push(file("mimetype", "application/epub+zip"));
    entries.push(file("META-INF/container.xml", xml(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)));

    entries.push(file("OEBPS/styles/book.css", css(bookWritingMode, options.compatibleMode)));
    if (hasImageCover) {
      entries.push(file("OEBPS/images/cover.svg", coverSvg));
    }

    const xhtmlFiles = [];
    const readingOrder = [{ id: "cover", href: "cover.xhtml", title: "表紙" }];
    entries.push(file("OEBPS/cover.xhtml", xhtml(
      "cover",
      "表紙",
      coverBody(work, chapters.length, safeTitle, bookWritingMode, hasImageCover),
      bookWritingMode
    )));
    xhtmlFiles.push({ id: "cover", href: "cover.xhtml", title: "表紙" });

    if (includeDescription) {
      entries.push(file("OEBPS/intro.xhtml", introXhtml(work, chapters.length, now, bookWritingMode)));
      xhtmlFiles.push({ id: "intro", href: "intro.xhtml", title: "本書について" });
      readingOrder.push({ id: "intro", href: "intro.xhtml", title: "本書について" });
    }

    readingOrder.push({ id: "nav", href: "nav.xhtml", title: "目次" });
    await yieldToUi();

    for (let index = 0; index < chapters.length; index++) {
      const chapter = chapters[index];
      const id = `chapter-${index + 1}`;
      const href = `${id}.xhtml`;
      entries.push(file(`OEBPS/${href}`, chapterXhtml(id, chapter, bookWritingMode)));
      xhtmlFiles.push({
        id,
        href,
        title: chapter.title,
        rawTitle: chapter.rawTitle || chapter.title,
        chapterTitles: Array.isArray(chapter.chapterTitles) ? chapter.chapterTitles : []
      });
      readingOrder.push({ id, href, title: chapter.title });

      if ((index + 1) % BUILD_CHUNK_SIZE === 0) {
        hooks.onProgress?.({
          phase: "chapters",
          done: index + 1,
          total: chapters.length,
          title: chapter.title
        });
        await yieldToUi();
      }
    }

    hooks.onProgress?.({ phase: "package", done: chapters.length, total: chapters.length, title: "" });
    await yieldToUi();

    entries.push(file("OEBPS/nav.xhtml", navXhtml(work, xhtmlFiles, bookWritingMode)));
    entries.push(file("OEBPS/toc.ncx", ncx({
      bookId,
      title: work.title || "Kakuyomu Work",
      author: work.author || "Unknown Author",
      files: xhtmlFiles
    })));
    entries.push(file("OEBPS/content.opf", opf({
      bookId,
      title: safeTitle,
      author: safeAuthor,
      sourceUrl: work.sourceUrl || "",
      modified: now,
      files: xhtmlFiles,
      readingOrder,
      writingMode: bookWritingMode,
      hasCover: hasImageCover
    })));

    await yieldToUi();
    return makeZip(entries);
  }

  function normalizeBuildOptions({ work, chapters, includeDescription, writingMode = "horizontal", compatibleMode = false }) {
    const bookWritingMode = compatibleMode ? "horizontal" : writingMode;
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const bookId = `urn:kakuyomu:${work.id || crypto.randomUUID()}`;
    const safeTitle = escapeXml(work.title || "Kakuyomu Work");
    const safeAuthor = escapeXml(work.author || "Unknown Author");
    const hasImageCover = !compatibleMode;
    return {
      work,
      chapters,
      includeDescription,
      bookWritingMode,
      hasImageCover,
      coverSvg: hasImageCover ? buildCoverSvg(work, chapters.length) : "",
      now,
      bookId,
      safeTitle,
      safeAuthor
    };
  }

  function introXhtml(work, chapterCount, now, writingMode) {
    return xhtml("intro", "本書について", [
      `<section class="book-info" epub:type="frontmatter">`,
      `<h1>${formatText(work.title || "Kakuyomu Work", writingMode)}</h1>`,
      `<p class="author">${formatText(work.author || "Unknown Author", writingMode)}</p>`,
      `<h2>${formatText("作品紹介", writingMode)}</h2>`,
      ...descriptionParagraphs(work.description, writingMode),
      `<dl class="metadata">`,
      `<dt>${formatText("収録話数", writingMode)}</dt><dd>${formatText(`${chapterCount}話`, writingMode)}</dd>`,
      `<dt>${formatText("出典", writingMode)}</dt><dd>${formatText(work.sourceUrl || "", writingMode)}</dd>`,
      `<dt>${formatText("生成日時", writingMode)}</dt><dd>${formatText(formatDate(now), writingMode)}</dd>`,
      `</dl>`,
      `</section>`
    ], writingMode);
  }

  function chapterXhtml(id, chapter, writingMode) {
    return xhtml(id, chapter.title, [
      `<h1>${formatText(chapter.title, writingMode)}</h1>`,
      ...chapter.body.map((line) => renderBodyLine(line, writingMode))
    ], writingMode);
  }

  function coverBody(work, chapterCount, safeTitle, writingMode, hasImageCover) {
    if (hasImageCover) {
      return [
        `<section class="cover-page" epub:type="cover"><img class="cover-image" src="images/cover.svg" alt="${safeTitle}"/></section>`
      ];
    }

    return [
      `<section class="cover-page text-cover" epub:type="cover">`,
      `<h1>${formatText(work.title || "Kakuyomu Work", writingMode)}</h1>`,
      `<p class="author">${formatText(work.author || "Unknown Author", writingMode)}</p>`,
      `<p class="source">${formatText(`${chapterCount} episodes`, writingMode)}</p>`,
      `</section>`
    ];
  }

  function xhtml(id, title, body, writingMode) {
    const vertical = writingMode === "vertical";
    return xml(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
  <head>
    <meta charset="UTF-8"/>
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="styles/book.css"/>
  </head>
  <body id="${id}"${vertical ? ' class="vertical-page"' : ""}>
    ${body.join("\n    ")}
  </body>
</html>`);
  }

  function navXhtml(work, files, writingMode) {
    const tree = buildNavTree(files);
    return xhtml("toc", "目次", [
      `<h1>${formatText(work.title || "目次", writingMode)}</h1>`,
      `<nav epub:type="toc" id="toc-nav">${navList(tree, writingMode)}</nav>`
    ], writingMode);
  }

  function opf({ bookId, title, author, sourceUrl, modified, files, readingOrder, writingMode, hasCover }) {
    const manifestItems = files
      .map((item) => `<item id="${item.id}" href="${item.href}" media-type="application/xhtml+xml"/>`)
      .join("\n    ");
    const spineItems = readingOrder
      .map((item) => `<itemref idref="${item.id}"/>`)
      .join("\n    ");

    return xml(`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>ja</dc:language>
    ${sourceUrl ? `<dc:source>${escapeXml(sourceUrl)}</dc:source>` : ""}
    ${hasCover ? `<meta name="cover" content="cover-image"/>` : ""}
    <meta property="dcterms:modified">${modified}</meta>
    ${writingMode === "vertical" ? `<meta property="rendition:layout">reflowable</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">auto</meta>
    <meta property="rendition:flow">paginated</meta>` : ""}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
    ${hasCover ? `<item id="cover-image" href="images/cover.svg" media-type="image/svg+xml" properties="cover-image"/>` : ""}
    ${manifestItems}
  </manifest>
  <spine toc="ncx"${writingMode === "vertical" ? ' page-progression-direction="rtl"' : ""}>
    ${spineItems}
  </spine>
</package>`);
  }

  function ncx({ bookId, title, author, files }) {
    let playOrder = 0;
    const navPoints = ncxNavPoints(buildNavTree(files), () => {
      playOrder += 1;
      return playOrder;
    });

    return xml(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="ja">
  <head>
    <meta name="dtb:uid" content="${escapeXml(bookId)}"/>
    <meta name="dtb:depth" content="${navDepth(buildNavTree(files))}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <docAuthor><text>${escapeXml(author)}</text></docAuthor>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`);
  }

  function css(writingMode, compatibleMode) {
    const vertical = writingMode === "vertical" && !compatibleMode;
    return `html,
body {
  width: 100%;
  height: 100%;
}
body {
  color: #1c1f21;
  font-family: "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif CJK JP", serif;
  line-height: 1.85;
  margin: 0;
  padding: ${vertical ? "1.5em 1.2em" : "1em"};
  box-sizing: border-box;
  text-align: start;
  writing-mode: ${vertical ? "vertical-rl" : "horizontal-tb"};
  -epub-writing-mode: ${vertical ? "vertical-rl" : "horizontal-tb"};
  ${vertical ? "-webkit-writing-mode: vertical-rl;" : ""}
  ${vertical ? "text-orientation: mixed;" : ""}
  ${vertical ? "line-break: strict;" : ""}
  ${vertical ? "-epub-line-break: strict;" : ""}
  ${vertical ? "word-break: normal;" : ""}
  ${vertical ? "overflow-wrap: break-word;" : ""}
  ${vertical ? "text-align: justify;" : ""}
  ${vertical ? "text-justify: inter-ideograph;" : ""}
  ${vertical ? "letter-spacing: 0;" : ""}
  ${vertical ? 'font-feature-settings: "vpal" 1, "pkna" 1;' : ""}
  ${vertical ? "-webkit-font-feature-settings: \"vpal\" 1, \"pkna\" 1;" : ""}
}
h1 {
  font-size: ${vertical ? "1.45em" : "1.35em"};
  line-height: ${vertical ? "1.55" : "1.45"};
  text-align: start;
  margin: ${vertical ? "0 0 0 2.4em" : "0 0 1.6em"};
  page-break-after: avoid;
  break-after: avoid;
  font-weight: 700;
}
p {
  text-align: ${vertical ? "justify" : "start"};
  text-indent: 0;
  white-space: pre-wrap;
  margin: ${vertical ? "0 0 0 1em" : "0 0 0.85em"};
  widows: 1;
  orphans: 1;
}
em {
  font-style: normal;
  -webkit-text-emphasis: filled sesame;
  text-emphasis: filled sesame;
}
strong,
b {
  font-weight: 700;
}
i {
  font-style: italic;
}
h2,
h3 {
  font-size: ${vertical ? "1.1em" : "1.05em"};
  line-height: 1.5;
  margin: ${vertical ? "0 0 0 1.8em" : "1.4em 0 0.75em"};
}
hr {
  border: 0;
  border-${vertical ? "left" : "top"}: 1px solid #999;
  margin: ${vertical ? "0 0 0 1.5em" : "1.5em 0"};
}
ruby {
  ruby-align: center;
  ruby-position: over;
}
rt {
  font-size: 0.5em;
  line-height: 1;
}
.blank {
  text-indent: 0;
  margin-${vertical ? "left" : "bottom"}: 1.85em;
}
.tcy {
  text-combine-upright: all;
  -webkit-text-combine: horizontal;
  -epub-text-combine: horizontal;
}
.upright {
  text-orientation: upright;
}
.author,
.source {
  color: #555;
}
nav ol {
  margin: ${vertical ? "0 0 0 1em" : "0"};
  padding: 0;
  list-style-type: none;
  list-style-position: inside;
}
nav li {
  margin: ${vertical ? "0 0 0 0.9em" : "0 0 0.55em"};
  list-style-type: none;
}
nav a {
  color: inherit;
  text-decoration: none;
}
body#cover {
  padding: 0;
  background: #1d2b36;
}
.cover-page {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  page-break-after: always;
  break-after: page;
  text-align: center;
}
.text-cover {
  display: block;
  padding: ${vertical ? "2em 1.5em" : "4em 2em"};
  background: #fff;
  color: #1c1f21;
  text-align: start;
}
.cover-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.book-info h2 {
  font-size: ${vertical ? "1.05em" : "1.1em"};
  margin: ${vertical ? "0 0 0 1.8em" : "1.8em 0 0.9em"};
}
.metadata {
  margin: ${vertical ? "0 1.5em 0 0" : "1.8em 0 0"};
}
.metadata dt {
  color: #555;
  font-size: 0.86em;
  margin: ${vertical ? "0 0 0 0.4em" : "0.8em 0 0.2em"};
}
.metadata dd {
  margin: ${vertical ? "0 0 0 1em" : "0 0 0.7em"};
}`;
  }

  function paragraphs(text, writingMode) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => paragraph(line, writingMode));
  }

  function descriptionParagraphs(text, writingMode) {
    const items = paragraphs(text, writingMode);
    return items.length ? items : [paragraph("作品紹介は取得できませんでした。", writingMode)];
  }

  function paragraph(text, writingMode) {
    return `<p>${formatText(`${PARAGRAPH_INDENT}${String(text || "").trimStart()}`, writingMode)}</p>`;
  }

  function renderBodyLine(line, writingMode) {
    const text = String(line || "");
    if (!text) return '<p class="blank"><br/></p>';
    if (text === "<hr/>") return "<hr/>";

    const heading = text.match(/^<(h[23])>([\s\S]*)<\/\1>$/i);
    if (heading) {
      return `<${heading[1].toLowerCase()}>${formatText(heading[2], writingMode)}</${heading[1].toLowerCase()}>`;
    }

    return paragraph(text, writingMode);
  }

  function buildNavTree(files) {
    return files.map((file) => ({
      title: file.title,
      href: file.href,
      children: []
    }));
  }

  function navList(items, writingMode) {
    return `<ol>${items.map((item) => {
      const label = item.href
        ? `<a href="${item.href}">${formatText(item.title, writingMode)}</a>`
        : `<span>${formatText(item.title, writingMode)}</span>`;
      return `<li>${label}${item.children.length ? navList(item.children, writingMode) : ""}</li>`;
    }).join("")}</ol>`;
  }

  function ncxNavPoints(items, nextPlayOrder) {
    return items.map((item) => {
      const order = nextPlayOrder();
      const href = item.href || firstLeafHref(item);
      const children = item.children.length ? `\n      ${ncxNavPoints(item.children, nextPlayOrder)}` : "";
      return `<navPoint id="navPoint-${order}" playOrder="${order}">
      <navLabel><text>${escapeXml(item.title)}</text></navLabel>
      <content src="${escapeXml(href)}"/>${children}
    </navPoint>`;
    }).join("\n    ");
  }

  function navDepth(items) {
    if (!items.length) return 0;
    return Math.max(...items.map((item) => 1 + navDepth(item.children)));
  }

  function firstLeafHref(item) {
    if (item.href) return item.href;
    for (const child of item.children) {
      const href = firstLeafHref(child);
      if (href) return href;
    }
    return "";
  }

  function buildCoverSvg(work, chapterCount) {
    const title = splitCoverLines(work.title || "Kakuyomu Work", 11, 4);
    const author = work.author || "Unknown Author";
    const palette = coverPalette(work.title || work.id || author);
    const titleLines = title
      .map((line, index) => `<text x="80" y="${270 + index * 72}" class="title">${escapeXml(line)}</text>`)
      .join("");

    return xml(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2560" viewBox="0 0 1600 2560" role="img" aria-label="${escapeXml(work.title || "Kakuyomu Work")}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bg1}"/>
      <stop offset="100%" stop-color="${palette.bg2}"/>
    </linearGradient>
    <style>
      .title { fill: #f8f3ea; font: 700 76px serif; letter-spacing: 0; }
      .author { fill: #f8f3ea; font: 400 42px serif; }
      .meta { fill: #d9d1c3; font: 32px serif; }
      .rule { stroke: #f8f3ea; stroke-width: 4; opacity: 0.75; }
      .mark { fill: none; stroke: ${palette.accent}; stroke-width: 10; opacity: 0.85; }
    </style>
  </defs>
  <rect width="1600" height="2560" fill="url(#bg)"/>
  <path class="mark" d="M1260 260c120 210 82 430-105 610s-230 405-105 625"/>
  <path class="mark" d="M1380 390c78 160 44 320-88 460s-170 310-72 455"/>
  <line class="rule" x1="80" y1="190" x2="610" y2="190"/>
  ${titleLines}
  <text x="80" y="2080" class="author">${escapeXml(author)}</text>
  <text x="80" y="2160" class="meta">Kakuyomu Kindle Edition</text>
  <text x="80" y="2210" class="meta">${escapeXml(String(chapterCount))} episodes</text>
</svg>`);
  }

  function splitCoverLines(value, maxLength, maxLines) {
    const text = String(value || "").trim();
    if (!text) return ["Kakuyomu Work"];

    const lines = [];
    let current = "";
    for (const char of text) {
      current += char;
      if (current.length >= maxLength) {
        lines.push(current);
        current = "";
      }
      if (lines.length === maxLines) break;
    }
    if (current && lines.length < maxLines) lines.push(current);
    if (text.length > maxLength * maxLines) {
      lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(1, maxLength - 1))}...`;
    }
    return lines;
  }

  function coverPalette(seed) {
    const palettes = [
      { bg1: "#1d2b36", bg2: "#6a3d48", accent: "#d8b26e" },
      { bg1: "#233428", bg2: "#385e68", accent: "#d4c17a" },
      { bg1: "#34283a", bg2: "#6b4b39", accent: "#d7a46a" },
      { bg1: "#202b42", bg2: "#7a3840", accent: "#c9d179" }
    ];
    let hash = 0;
    for (const char of String(seed || "")) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return palettes[hash % palettes.length];
  }

  function formatDate(value) {
    return String(value || "").replace("T", " ").replace("Z", " UTC");
  }

  function formatText(value, writingMode) {
    if (hasInlineMarkup(value)) return formatInlineHtml(value, writingMode);
    return formatPlainText(value, writingMode);
  }

  function formatPlainText(value, writingMode) {
    if (writingMode !== "vertical") return escapeXml(value);

    return String(value || "")
      .split(/([0-9０-９]{1,2}|[A-Za-z]{1,3})/g)
      .map((part) => {
        if (/^[0-9０-９]{1,2}$/.test(part)) {
          return `<span class="tcy">${escapeXml(part)}</span>`;
        }
        if (/^[A-Za-z]{1,3}$/.test(part)) {
          return `<span class="upright">${escapeXml(part)}</span>`;
        }
        return escapeXml(part);
      })
      .join("");
  }

  function hasInlineMarkup(value) {
    return /<(?:ruby|rb|rt|rtc|br|em|strong|b|i|span)\b/i.test(String(value || ""));
  }

  function formatInlineHtml(value, writingMode) {
    const doc = new DOMParser().parseFromString(`<span>${value}</span>`, "text/html");
    const root = doc.body.firstElementChild;
    return [...(root?.childNodes || [])]
      .map((node) => formatInlineNode(node, writingMode))
      .join("");
  }

  function formatInlineNode(node, writingMode) {
    if (node.nodeType === Node.TEXT_NODE) {
      return formatPlainText(node.textContent || "", writingMode);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "<br/>";
    if (!["ruby", "rb", "rt", "rtc", "em", "strong", "b", "i"].includes(tag)) {
      return [...node.childNodes].map((child) => formatInlineNode(child, writingMode)).join("");
    }

    const children = [...node.childNodes]
      .map((child) => formatInlineNode(child, writingMode))
      .join("");
    return `<${tag}>${children}</${tag}>`;
  }

  function makeZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      const data = toBytes(entry.content);
      const crc = crc32(data);
      const local = concat(
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
        name, data
      );
      localParts.push(local);

      centralParts.push(concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), name
      ));

      offset += local.length;
    }

    const centralOffset = offset;
    const central = concat(...centralParts);
    const end = concat(
      u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
      u32(central.length), u32(centralOffset), u16(0)
    );

    return new Blob([...localParts, central, end], { type: "application/epub+zip" });
  }

  function file(name, content) {
    return { name, content };
  }

  function yieldToUi() {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => resolve());
      } else if (typeof setTimeout === "function") {
        setTimeout(resolve, 0);
      } else {
        resolve();
      }
    });
  }

  function xml(text) {
    return text.trim();
  }

  function toBytes(content) {
    return typeof content === "string" ? encoder.encode(content) : content;
  }

  function concat(...parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function u16(value) {
    return new Uint8Array([value & 255, (value >>> 8) & 255]);
  }

  function u32(value) {
    return new Uint8Array([
      value & 255,
      (value >>> 8) & 255,
      (value >>> 16) & 255,
      (value >>> 24) & 255
    ]);
  }

  function crc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 255];
    }
    return (crc ^ -1) >>> 0;
  }

  const table = (() => {
    const out = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      out[i] = c >>> 0;
    }
    return out;
  })();

  function escapeXml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
})();
