(function () {
  const KAKUYOMU_ORIGIN = "https://kakuyomu.jp";

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "KAKUYOMU_GET_WORK") {
      respondAsync(sendResponse, () => getWorkFromCurrentPage());
      return true;
    }

    if (message?.type === "KAKUYOMU_FETCH_EPISODE") {
      respondAsync(sendResponse, () => fetchEpisode(message.url));
      return true;
    }

    return false;
  });

  async function respondAsync(sendResponse, handler) {
    try {
      const data = await handler();
      sendResponse({ ok: true, data });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  function getWorkFromCurrentPage() {
    const workId = getWorkId(location.href);
    if (!workId) {
      throw new Error("当前页面不是カクヨム作品页。");
    }

    const parsed = parseKakuyomuDocument(document, location.href);
    if (!parsed.work || parsed.work.id !== workId) {
      parsed.work = parsed.work || {};
      parsed.work.id = workId;
    }

    if (!parsed.episodes.length) {
      throw new Error("没有找到章节目录。请在作品首页执行导出。");
    }

    return {
      work: normalizeWork(parsed.work, document),
      episodes: parsed.episodes
    };
  }

  async function fetchEpisode(url) {
    const absoluteUrl = new URL(url, KAKUYOMU_ORIGIN).href;
    if (!absoluteUrl.startsWith(`${KAKUYOMU_ORIGIN}/works/`)) {
      throw new Error("章节 URL 不属于カクヨム。");
    }

    const response = await fetch(absoluteUrl, {
      credentials: "include",
      cache: "no-cache"
    });

    if (!response.ok) {
      throw new Error(`章节请求失败：HTTP ${response.status}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const parsed = parseKakuyomuDocument(doc, absoluteUrl);
    const episode = parsed.currentEpisode || parseEpisodeFromDom(doc, absoluteUrl);

    if (!episode?.body?.length) {
      throw new Error("未能解析章节正文。");
    }

    return episode;
  }

  function parseKakuyomuDocument(doc, url) {
    const nextData = readNextData(doc);
    const state = nextData?.props?.pageProps?.__APOLLO_STATE__ || {};
    const workId = nextData?.query?.workId || getWorkId(url);
    const episodeId = nextData?.query?.episodeId || getEpisodeId(url);
    const work = parseWork(state, workId, doc);
    const episodes = parseEpisodes(state, workId);
    const currentEpisode = parseCurrentEpisode(state, episodeId, doc, url);
    return { work, episodes, currentEpisode };
  }

  function readNextData(doc) {
    const el = doc.getElementById("__NEXT_DATA__");
    if (!el?.textContent) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (_error) {
      return null;
    }
  }

  function parseWork(state, workId, doc) {
    const work =
      state[`Work:${workId}`] ||
      Object.entries(state).find(([key]) => key.startsWith("Work:"))?.[1] ||
      {};
    const author = resolveAuthor(state, work);

    return {
      id: String(workId || work.id || ""),
      title: firstText(
        work.title,
        work.name,
        doc.getElementById("workTitle")?.textContent,
        doc.querySelector("h1")?.textContent,
        doc.title?.replace(/（.+?） - カクヨム$/, "")
      ),
      author: firstText(
        author?.activityName,
        author?.name,
        author?.username,
        doc.getElementById("workAuthor")?.textContent
      ),
      description: firstText(
        work.introduction,
        work.catchphrase,
        work.description,
        doc.querySelector("#introduction")?.textContent,
        doc.querySelector('[data-testid="work-introduction"]')?.textContent
      ),
      sourceUrl: workId ? `${KAKUYOMU_ORIGIN}/works/${workId}` : location.href
    };
  }

  function resolveAuthor(state, work) {
    const ref =
      work?.author?.__ref ||
      work?.user?.__ref ||
      work?.owner?.__ref ||
      work?.writer?.__ref;
    if (ref && state[ref]) return state[ref];
    return Object.entries(state).find(([key]) => key.startsWith("User:"))?.[1];
  }

  function parseEpisodes(state, workId) {
    const work = state[`Work:${workId}`] || {};
    let orderedEntries = [];

    orderedEntries = collectEpisodeEntries(work.tableOfContentsV2, state);
    if (!orderedEntries.length) {
      orderedEntries = collectEpisodeEntries(work.tableOfContents, state);
    }

    if (!orderedEntries.length) {
      for (const key of Object.keys(state)) {
        if (isEpisodeRef(key)) {
          orderedEntries.push({ ref: key, chapterTitles: [] });
        }
      }
    }

    const seen = new Set();
    return orderedEntries
      .map((entry) => ({ entry, episode: state[entry.ref] || {} }))
      .filter(({ episode }) => episode.id && !seen.has(episode.id) && seen.add(episode.id))
      .map(({ entry, episode }, index) => ({
        id: String(episode.id),
        title: formatEpisodeTitle(episode.title, entry.chapterTitles, index),
        url: `${KAKUYOMU_ORIGIN}/works/${workId}/episodes/${episode.id}`,
        publishedAt: episode.publishedAt || episode.createdAt || ""
      }));
  }

  function collectEpisodeEntries(value, state) {
    const out = [];
    collectEpisodeEntriesFromValue(value, state, out, [], new Set());
    return out;
  }

  function collectEpisodeEntriesFromValue(value, state, out, chapterTitles, seen) {
    if (!value) return;

    if (Array.isArray(value)) {
      collectEpisodeEntriesFromArray(value, state, out, chapterTitles, seen);
      return;
    }

    if (typeof value === "object") {
      if (value.__ref) {
        const ref = value.__ref;
        if (seen.has(ref)) return;
        seen.add(ref);
        if (isEpisodeRef(ref)) {
          out.push({ ref, chapterTitles: [...chapterTitles] });
        } else {
          collectEpisodeEntriesFromValue(state[ref], state, out, chapterTitles, seen);
        }
        return;
      }

      if (value.__typename === "TableOfContentsChapter") {
        collectTableOfContentsChapter(value, state, out, chapterTitles, seen);
        return;
      }

      for (const item of Object.values(value)) {
        collectEpisodeEntriesFromValue(item, state, out, chapterTitles, seen);
      }
    }
  }

  function collectEpisodeEntriesFromArray(items, state, out, chapterTitles, seen) {
    const chapterStack = [...chapterTitles];

    for (const item of items) {
      const node = resolveRef(item, state) || item;
      if (node?.__typename === "TableOfContentsChapter") {
        const titles = chapterTitlesForNode(node, state, chapterStack);
        collectTableOfContentsChapter(node, state, out, titles, seen);
      } else {
        collectEpisodeEntriesFromValue(item, state, out, chapterStack, seen);
      }
    }
  }

  function collectTableOfContentsChapter(node, state, out, chapterTitles, seen) {
    collectEpisodeEntriesFromValue(
      node.episodeUnions || node.episodes || node.children,
      state,
      out,
      chapterTitles,
      seen
    );
  }

  function chapterTitlesForNode(node, state, chapterStack) {
    const chapter = resolveRef(node.chapter, state) || {};
    const title = firstText(chapter.title, node.title);
    if (!title) return [...chapterStack];

    const level = Math.max(1, Number(chapter.level || node.level || 1));
    chapterStack.splice(level - 1);
    chapterStack[level - 1] = title;

    return chapterStack.filter(Boolean);
  }

  function resolveRef(value, state) {
    return value?.__ref ? state[value.__ref] : null;
  }

  function isEpisodeRef(ref) {
    return /^(Episode|EmptyEpisode):/.test(ref);
  }

  function formatEpisodeTitle(episodeTitle, chapterTitles, index) {
    const title = firstText(episodeTitle, `第${index + 1}話`);
    const prefix = [...new Set((chapterTitles || []).map(cleanText).filter(Boolean))].join(" - ");
    if (!prefix || title === prefix || title.startsWith(prefix)) return title;
    return `${prefix} - ${title}`;
  }

  function parseCurrentEpisode(state, episodeId, doc, url) {
    const episode =
      state[`Episode:${episodeId}`] ||
      Object.entries(state).find(([key]) => key.startsWith("Episode:"))?.[1] ||
      {};
    const body = normalizeBody(episode.body || episode.content || episode.text);

    return {
      id: String(episodeId || episode.id || getEpisodeId(url) || ""),
      title: firstText(episode.title, doc.querySelector("h1")?.textContent, "Untitled"),
      url,
      body: body.length ? body : parseBodyFromDom(doc)
    };
  }

  function parseEpisodeFromDom(doc, url) {
    return {
      id: getEpisodeId(url) || "",
      title: firstText(doc.querySelector("h1")?.textContent, doc.title, "Untitled"),
      url,
      body: parseBodyFromDom(doc)
    };
  }

  function parseBodyFromDom(doc) {
    const root =
      doc.querySelector("#episodeBody") ||
      doc.querySelector(".widget-episodeBody") ||
      doc.querySelector('[data-testid="episode-body"]') ||
      doc.querySelector("article");
    if (!root) return [];

    const paragraphs = [...root.querySelectorAll("p")]
      .map((p) => cleanInlineHtml(p));

    return paragraphs.length ? paragraphs : normalizeBody(root.textContent || "");
  }

  function normalizeBody(body) {
    if (Array.isArray(body)) {
      return body.map(cleanBodyFragment);
    }

    if (typeof body !== "string") return [];

    const doc = new DOMParser().parseFromString(body, "text/html");
    const paragraphs = [...doc.querySelectorAll("p")]
      .map((p) => cleanInlineHtml(p));

    if (paragraphs.length) return paragraphs;

    if (hasInlineMarkup(body)) {
      const wrapper = doc.createElement("span");
      wrapper.innerHTML = body;
      return cleanInlineHtml(wrapper).split(/\r?\n/).map(cleanText);
    }

    return body
      .split(/\r?\n/)
      .map(cleanText);
  }

  function normalizeWork(work, doc) {
    return {
      id: work.id || getWorkId(location.href) || "",
      title: firstText(work.title, doc.title, "Kakuyomu Work"),
      author: firstText(work.author, "Unknown Author"),
      description: firstText(work.description, ""),
      sourceUrl: work.sourceUrl || location.href
    };
  }

  function firstText(...values) {
    for (const value of values) {
      const text = cleanText(value);
      if (text) return text;
    }
    return "";
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function cleanInlineHtml(root) {
    return cleanInlineWhitespace([...root.childNodes].map(sanitizeInlineNode).join(""));
  }

  function cleanBodyFragment(value) {
    const text = String(value || "");
    if (!hasInlineMarkup(text)) return cleanText(text);

    const doc = new DOMParser().parseFromString(`<span>${text}</span>`, "text/html");
    return cleanInlineHtml(doc.body.firstElementChild);
  }

  function hasInlineMarkup(value) {
    return /<(?:ruby|rb|rt|rtc|br)\b/i.test(String(value || ""));
  }

  function sanitizeInlineNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(node.textContent || "");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "<br/>";

    if (tag === "ruby") {
      return `<ruby>${[...node.childNodes].map(sanitizeRubyNode).join("")}</ruby>`;
    }

    return [...node.childNodes].map(sanitizeInlineNode).join("");
  }

  function sanitizeRubyNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(node.textContent || "");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();
    if (tag === "rp") return "";
    if (["rb", "rt", "rtc"].includes(tag)) {
      return `<${tag}>${[...node.childNodes].map(sanitizeRubyNode).join("")}</${tag}>`;
    }
    if (tag === "br") return "<br/>";
    if (tag === "ruby") {
      return `<ruby>${[...node.childNodes].map(sanitizeRubyNode).join("")}</ruby>`;
    }

    return [...node.childNodes].map(sanitizeRubyNode).join("");
  }

  function cleanInlineWhitespace(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function getWorkId(url) {
    return new URL(url).pathname.match(/\/works\/(\d+)/)?.[1] || "";
  }

  function getEpisodeId(url) {
    return new URL(url).pathname.match(/\/episodes\/(\d+)/)?.[1] || "";
  }
})();
