const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { DOMParser, Node } = require("../test/dom-stub");

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

async function main() {
  const epub = loadEpubBuilder();
  const blob = await epub.buildEpubAsync({
    work: {
      id: "validate",
      title: "Validation Work",
      author: "Validator",
      description: "Generated for EPUB structure validation.",
      sourceUrl: "https://kakuyomu.jp/works/1"
    },
    chapters: [
      {
        title: "第一章 - 第一話",
        rawTitle: "第一話",
        chapterTitles: ["第一章"],
        body: ["本文", "<ruby>漢<rt>かん</rt></ruby>字"]
      },
      {
        title: "第一章 - 第二話",
        rawTitle: "第二話",
        chapterTitles: ["第一章"],
        body: ["続き"]
      }
    ],
    includeDescription: true,
    writingMode: "vertical"
  });

  const entries = await unzipStoredEntries(blob);
  validateRequiredEntries(entries);
  validateContainer(entries);
  validatePackage(entries);
  validateNav(entries);
  validateXhtml(entries);
  console.log(`EPUB validation passed (${entries.size} files checked).`);
}

function loadEpubBuilder() {
  const source = fs.readFileSync("epub.js", "utf8");
  const context = {
    Blob,
    TextEncoder,
    DOMParser,
    Node,
    crypto: {
      randomUUID() {
        return "validation-uuid";
      }
    },
    window: {}
  };
  vm.runInNewContext(source, context, { filename: "epub.js" });
  return context.window.KakuyomuEpub;
}

async function unzipStoredEntries(blob) {
  const data = new Uint8Array(await blob.arrayBuffer());
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;

  while (offset < data.length) {
    const signature = readU32(data, offset);
    if (signature !== 0x04034b50) break;

    const compressedSize = readU32(data, offset + 18);
    const nameLength = readU16(data, offset + 26);
    const extraLength = readU16(data, offset + 28);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(data.slice(nameStart, nameStart + nameLength));
    const content = decoder.decode(data.slice(contentStart, contentStart + compressedSize));
    entries.set(name, content);
    offset = contentStart + compressedSize;
  }

  return entries;
}

function validateRequiredEntries(entries) {
  assert.equal(entries.get("mimetype"), "application/epub+zip", "mimetype must be present and first");
  for (const name of [
    "META-INF/container.xml",
    "OEBPS/content.opf",
    "OEBPS/nav.xhtml",
    "OEBPS/toc.ncx",
    "OEBPS/styles/book.css",
    "OEBPS/cover.xhtml",
    "OEBPS/chapter-1.xhtml"
  ]) {
    assert.ok(entries.has(name), `missing ${name}`);
  }
}

function validateContainer(entries) {
  assert.match(
    entries.get("META-INF/container.xml"),
    /full-path="OEBPS\/content\.opf"/,
    "container must point to OEBPS/content.opf"
  );
}

function validatePackage(entries) {
  const opf = entries.get("OEBPS/content.opf");
  assert.match(opf, /<item id="nav" href="nav\.xhtml" media-type="application\/xhtml\+xml" properties="nav"\/>/);
  assert.match(opf, /<spine toc="ncx"/);

  for (const href of [...opf.matchAll(/href="([^"]+)"/g)].map((match) => match[1])) {
    assert.ok(entries.has(`OEBPS/${href}`), `manifest href missing file: ${href}`);
  }

  const manifestIds = new Set([...opf.matchAll(/<item id="([^"]+)"/g)].map((match) => match[1]));
  for (const idref of [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((match) => match[1])) {
    assert.ok(manifestIds.has(idref), `spine idref missing manifest item: ${idref}`);
  }
}

function validateNav(entries) {
  const nav = entries.get("OEBPS/nav.xhtml");
  assert.match(nav, /epub:type="toc"/);
  for (const href of [...nav.matchAll(/href="([^"]+)"/g)].map((match) => match[1])) {
    assert.ok(entries.has(`OEBPS/${href}`), `nav href missing file: ${href}`);
  }
}

function validateXhtml(entries) {
  for (const [name, content] of entries) {
    if (!name.endsWith(".xhtml")) continue;
    assert.match(content, /^<\?xml version="1\.0" encoding="UTF-8"\?>/, `${name} missing XML declaration`);
    assert.match(content, /xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/, `${name} missing XHTML namespace`);
    assert.doesNotMatch(content, /&(?!amp;|lt;|gt;|quot;|apos;)/, `${name} has unescaped ampersand`);
  }
}

function readU16(data, offset) {
  return data[offset] | (data[offset + 1] << 8);
}

function readU32(data, offset) {
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  ) >>> 0;
}
