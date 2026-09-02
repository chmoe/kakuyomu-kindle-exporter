const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { DOMParser, Node } = require("./dom-stub");

function loadEpubBuilder() {
  const source = fs.readFileSync("epub.js", "utf8");
  const context = {
    Blob,
    TextEncoder,
    crypto: {
      randomUUID() {
        return "test-uuid";
      }
    },
    DOMParser,
    Node,
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

test("builds a readable EPUB package with required entries", async () => {
  const epub = loadEpubBuilder();
  const blob = epub.buildEpub({
    work: {
      id: "1",
      title: "テスト & 作品",
      author: "作者 & 名",
      description: "紹介文",
      sourceUrl: "https://kakuyomu.jp/works/1"
    },
    chapters: [
      {
        title: "第一章 - 始まり",
        rawTitle: "第1話 - 始まり",
        chapterTitles: ["第一章"],
        body: ["<h2>小見出し</h2>", "本文と<em>強調</em>", "<ruby>漢<rt>かん</rt></ruby>字", "<hr/>"]
      }
    ],
    includeDescription: true,
    writingMode: "vertical"
  });

  const entries = await unzipStoredEntries(blob);

  assert.equal(entries.get("mimetype"), "application/epub+zip");
  assert.ok(entries.has("META-INF/container.xml"));
  assert.ok(entries.has("OEBPS/content.opf"));
  assert.ok(entries.has("OEBPS/nav.xhtml"));
  assert.ok(entries.has("OEBPS/chapter-1.xhtml"));
  assert.match(entries.get("OEBPS/content.opf"), /<dc:source>https:\/\/kakuyomu\.jp\/works\/1<\/dc:source>/);
  assert.match(entries.get("OEBPS/content.opf"), /page-progression-direction="rtl"/);
  assert.match(entries.get("OEBPS/content.opf"), /properties="nav"/);
  assert.match(entries.get("OEBPS/toc.ncx"), /<docTitle><text>テスト &amp; 作品<\/text><\/docTitle>/);
  assert.doesNotMatch(entries.get("OEBPS/toc.ncx"), /&amp;amp;/);
  assert.match(entries.get("OEBPS/nav.xhtml"), /<li><a href="chapter-1.xhtml">第一章 - 始まり<\/a><\/li>/);
  assert.doesNotMatch(entries.get("OEBPS/nav.xhtml"), /<span>第一章<\/span>/);
  assert.match(entries.get("OEBPS/styles/book.css"), /nav ol \{[\s\S]*list-style-type: none;/);
  assert.match(entries.get("OEBPS/styles/book.css"), /nav li \{[\s\S]*list-style-type: none;/);
  assert.match(entries.get("OEBPS/chapter-1.xhtml"), /<h2>小見出し<\/h2>/);
  assert.match(entries.get("OEBPS/chapter-1.xhtml"), /本文と<em>強調<\/em>/);
  assert.match(entries.get("OEBPS/chapter-1.xhtml"), /<ruby>漢<rt>かん<\/rt><\/ruby>字/);
});

test("compatible mode avoids image covers and vertical spine settings", async () => {
  const epub = loadEpubBuilder();
  const blob = epub.buildEpub({
    work: {
      id: "1",
      title: "互換作品",
      author: "作者",
      description: "",
      sourceUrl: "https://kakuyomu.jp/works/1"
    },
    chapters: [
      {
        title: "第一話",
        body: ["本文"]
      }
    ],
    includeDescription: false,
    writingMode: "vertical",
    compatibleMode: true
  });

  const entries = await unzipStoredEntries(blob);

  assert.equal(entries.has("OEBPS/images/cover.svg"), false);
  assert.doesNotMatch(entries.get("OEBPS/content.opf"), /cover-image/);
  assert.doesNotMatch(entries.get("OEBPS/content.opf"), /page-progression-direction="rtl"/);
  assert.doesNotMatch(entries.get("OEBPS/styles/book.css"), /writing-mode: vertical-rl/);
});

test("async EPUB builder yields the same required package structure", async () => {
  const epub = loadEpubBuilder();
  const seenProgress = [];
  const blob = await epub.buildEpubAsync({
    work: {
      id: "1",
      title: "非同期作品",
      author: "作者",
      description: "",
      sourceUrl: "https://kakuyomu.jp/works/1"
    },
    chapters: Array.from({ length: 13 }, (_, index) => ({
      title: `第${index + 1}話`,
      body: ["本文"]
    })),
    includeDescription: false,
    writingMode: "horizontal"
  }, {
    onProgress(event) {
      seenProgress.push(event.phase);
    }
  });

  const entries = await unzipStoredEntries(blob);

  assert.ok(entries.has("OEBPS/content.opf"));
  assert.ok(entries.has("OEBPS/chapter-13.xhtml"));
  assert.ok(seenProgress.includes("chapters"));
  assert.ok(seenProgress.includes("package"));
});
