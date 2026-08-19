(function () {
  const state = {
    tabId: null,
    work: null,
    episodes: [],
    busy: false
  };

  const els = {
    pageStatus: document.getElementById("pageStatus"),
    workPanel: document.getElementById("workPanel"),
    workTitle: document.getElementById("workTitle"),
    workAuthor: document.getElementById("workAuthor"),
    workDescription: document.getElementById("workDescription"),
    episodeCount: document.getElementById("episodeCount"),
    writingModes: document.querySelectorAll('input[name="writingMode"]'),
    includeDescription: document.getElementById("includeDescription"),
    respectDelay: document.getElementById("respectDelay"),
    exportButton: document.getElementById("exportButton"),
    progressPanel: document.getElementById("progressPanel"),
    progressLabel: document.getElementById("progressLabel"),
    progressCount: document.getElementById("progressCount"),
    progressBar: document.getElementById("progressBar"),
    message: document.getElementById("message")
  };

  init();

  async function init() {
    els.exportButton.addEventListener("click", exportEpub);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id;

    if (!state.tabId || !/^https:\/\/kakuyomu\.jp\/works\/\d+/.test(tab.url || "")) {
      setStatus("请先打开一个カクヨム作品首页。");
      return;
    }

    try {
      const result = await sendToTab({ type: "KAKUYOMU_GET_WORK" });
      state.work = result.work;
      state.episodes = result.episodes;
      renderWork();
    } catch (error) {
      setError(error.message || String(error));
    }
  }

  async function exportEpub() {
    if (state.busy || !state.work || !state.episodes.length) return;

    state.busy = true;
    els.exportButton.disabled = true;
    els.progressPanel.hidden = false;
    setError("");

    const chapters = [];

    try {
      for (let i = 0; i < state.episodes.length; i++) {
        const episode = state.episodes[i];
        setProgress("抓取章节", i, state.episodes.length, episode.title);
        const chapter = await sendToTab({
          type: "KAKUYOMU_FETCH_EPISODE",
          url: episode.url
        });
        chapters.push({
          ...episode,
          ...chapter,
          title: episode.title || chapter.title
        });

        if (els.respectDelay.checked) {
          await sleep(350);
        }
      }

      setProgress("生成 EPUB", state.episodes.length, state.episodes.length, "");
      const blob = window.KakuyomuEpub.buildEpub({
        work: state.work,
        chapters,
        includeDescription: els.includeDescription.checked,
        writingMode: getWritingMode()
      });

      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({
        url,
        filename: `${safeFileName(state.work.title)}.epub`,
        saveAs: true
      });

      setStatus("导出完成。EPUB 可直接发送到 Kindle，或用 Calibre 转换。");
      setProgress("完成", state.episodes.length, state.episodes.length, "");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setError(error.message || String(error));
    } finally {
      state.busy = false;
      els.exportButton.disabled = !state.episodes.length;
    }
  }

  function renderWork() {
    els.workPanel.hidden = false;
    els.workTitle.textContent = state.work.title;
    els.workAuthor.textContent = state.work.author ? `作者：${state.work.author}` : "作者：未知";
    els.workDescription.textContent = state.work.description || "没有读取到简介。";
    els.episodeCount.textContent = `${state.episodes.length} 章`;
    els.exportButton.disabled = false;
    setStatus("已识别作品，可以导出。");
  }

  function setStatus(text) {
    els.pageStatus.textContent = text;
  }

  function setError(text) {
    els.message.textContent = text;
  }

  function setProgress(label, done, total, title) {
    const percent = total ? Math.round((done / total) * 100) : 0;
    els.progressLabel.textContent = title ? `${label}：${title}` : label;
    els.progressCount.textContent = `${done}/${total}`;
    els.progressBar.value = percent;
  }

  function sendToTab(message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(state.tabId, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.error || "插件通信失败。"));
          return;
        }

        resolve(response.data);
      });
    });
  }

  function safeFileName(value) {
    return String(value || "kakuyomu")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  function getWritingMode() {
    return [...els.writingModes].find((input) => input.checked)?.value || "horizontal";
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
