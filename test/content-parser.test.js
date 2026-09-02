const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { DOMParser, Node } = require("./dom-stub");

function loadParser() {
  const source = fs.readFileSync("content.js", "utf8");
  const context = {
    chrome: {
      runtime: {
        onMessage: {
          addListener() {}
        }
      }
    },
    DOMParser,
    Node,
    URL,
    globalThis: {}
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "content.js" });
  return context.KakuyomuContentParser;
}

function fakeDocument(nextData) {
  return {
    title: "",
    getElementById(id) {
      if (id !== "__NEXT_DATA__") return null;
      return { textContent: JSON.stringify(nextData) };
    },
    querySelector() {
      return null;
    }
  };
}

test("parses work metadata and ordered table of contents entries", () => {
  const parser = loadParser();
  const nextData = {
    query: { workId: "1", episodeId: "100" },
    props: {
      pageProps: {
        __APOLLO_STATE__: {
          "Work:1": {
            id: "1",
            title: "テスト作品",
            introduction: "紹介文",
            author: { __ref: "User:7" },
            tableOfContentsV2: [{ __ref: "TableOfContentsChapter:10" }]
          },
          "User:7": {
            activityName: "作者名"
          },
          "TableOfContentsChapter:10": {
            __typename: "TableOfContentsChapter",
            chapter: { __ref: "Chapter:10" },
            episodeUnions: [{ __ref: "Episode:100" }, { __ref: "Episode:101" }]
          },
          "Chapter:10": {
            title: "第一章",
            level: 1
          },
          "Episode:100": {
            id: "100",
            title: "始まり",
            body: ["<ruby>漢<rt>かん</rt></ruby>字"]
          },
          "Episode:101": {
            id: "101",
            title: "続き",
            body: ["本文"]
          }
        }
      }
    }
  };

  const parsed = parser.parseKakuyomuDocument(
    fakeDocument(nextData),
    "https://kakuyomu.jp/works/1/episodes/100"
  );

  assert.equal(parsed.work.title, "テスト作品");
  assert.equal(parsed.work.author, "作者名");
  assert.equal(
    JSON.stringify(parsed.episodes.map((episode) => episode.title)),
    JSON.stringify(["第一章 - 第1話 - 始まり", "第一章 - 第2話 - 続き"])
  );
  assert.equal(parsed.episodes[0].rawTitle, "第1話 - 始まり");
  assert.equal(JSON.stringify(parsed.episodes[0].chapterTitles), JSON.stringify(["第一章"]));
  assert.equal(parsed.currentEpisode.body[0], "<ruby>漢<rt>かん</rt></ruby>字");
});

test("merges generated episode numbers with author-written chapter titles", () => {
  const parser = loadParser();
  const nextData = {
    query: { workId: "1" },
    props: {
      pageProps: {
        __APOLLO_STATE__: {
          "Work:1": {
            id: "1",
            title: "テスト作品",
            tableOfContentsV2: [{ __ref: "TableOfContentsChapter:10" }]
          },
          "TableOfContentsChapter:10": {
            __typename: "TableOfContentsChapter",
            chapter: { __ref: "Chapter:10" },
            episodeUnions: [{ __ref: "Episode:100" }]
          },
          "Chapter:10": {
            title: "第一章　感情なんていらない",
            level: 1
          },
          "Episode:100": {
            id: "100",
            title: "",
            body: ["本文"]
          }
        }
      }
    }
  };

  const parsed = parser.parseKakuyomuDocument(
    fakeDocument(nextData),
    "https://kakuyomu.jp/works/1"
  );

  assert.equal(parsed.episodes[0].title, "第一章　感情なんていらない - 第1話");
  assert.equal(parsed.episodes[0].rawTitle, "第1話");
});
