(function () {
  const state = {
    tabId: null,
    work: null,
    episodes: [],
    cache: null,
    completedCount: 0,
    cacheSaveTimer: null,
    cacheSavePromise: null,
    cacheDirty: false,
    dirtyChapterIds: new Set(),
    currentEpisodeId: "",
    previewIndex: 0,
    previewChapter: null,
    exportMode: "all",
    busy: false,
    cancelled: false
  };

  const MAX_FETCH_RETRIES = 2;
  const RESUME_FILE_VERSION = 1;
  const CACHE_SAVE_DELAY = 800;
  const DESCRIPTION_PREVIEW_LIMIT = 260;
  const PREVIEW_SUMMARY_LINES = 24;
  const CACHE_META_PREFIX = "kakuyomu-export:meta:";
  const CACHE_CHAPTER_PREFIX = "kakuyomu-export:chapter:";
  const HISTORY_KEY = "kakuyomu-export:history";
  const HISTORY_LIMIT = 5;
  const EXPORT_STEPS = [
    { key: "prepare", label: "准备" },
    { key: "fetch", label: "抓取" },
    { key: "build", label: "生成" },
    { key: "download", label: "下载" },
    { key: "complete", label: "完成" }
  ];

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
    compatibleMode: document.getElementById("compatibleMode"),
    fileNameTemplate: document.getElementById("fileNameTemplate"),
    resumeFile: document.getElementById("resumeFile"),
    compressProgress: document.getElementById("compressProgress"),
    importButton: document.getElementById("importButton"),
    saveProgressButton: document.getElementById("saveProgressButton"),
    previewButton: document.getElementById("previewButton"),
    clearCacheButton: document.getElementById("clearCacheButton"),
    exportCurrentButton: document.getElementById("exportCurrentButton"),
    exportFromCurrentButton: document.getElementById("exportFromCurrentButton"),
    exportButton: document.getElementById("exportButton"),
    cancelButton: document.getElementById("cancelButton"),
    progressPanel: document.getElementById("progressPanel"),
    progressLabel: document.getElementById("progressLabel"),
    progressCount: document.getElementById("progressCount"),
    progressBar: document.getElementById("progressBar"),
    progressSteps: document.getElementById("progressSteps"),
    previewPanel: document.getElementById("previewPanel"),
    previewSelect: document.getElementById("previewSelect"),
    prevPreviewButton: document.getElementById("prevPreviewButton"),
    nextPreviewButton: document.getElementById("nextPreviewButton"),
    previewFull: document.getElementById("previewFull"),
    previewTitle: document.getElementById("previewTitle"),
    previewBody: document.getElementById("previewBody"),
    closePreviewButton: document.getElementById("closePreviewButton"),
    historyPanel: document.getElementById("historyPanel"),
    historyList: document.getElementById("historyList"),
    message: document.getElementById("message")
  };

  init();

  async function init() {
    els.exportButton.addEventListener("click", () => exportEpub("all"));
    els.cancelButton.addEventListener("click", cancelExport);
    els.importButton.addEventListener("click", () => els.resumeFile.click());
    els.resumeFile.addEventListener("change", importResumeFile);
    els.saveProgressButton.addEventListener("click", saveProgressFile);
    els.previewButton.addEventListener("click", previewChapter);
    els.previewSelect.addEventListener("change", () => previewChapter(Number(els.previewSelect.value)));
    els.prevPreviewButton.addEventListener("click", () => previewChapter(state.previewIndex - 1));
    els.nextPreviewButton.addEventListener("click", () => previewChapter(state.previewIndex + 1));
    els.previewFull.addEventListener("change", () => {
      if (state.previewChapter) renderPreview(state.previewChapter);
    });
    els.clearCacheButton.addEventListener("click", clearSavedProgress);
    els.exportCurrentButton.addEventListener("click", () => exportEpub("current"));
    els.exportFromCurrentButton.addEventListener("click", () => exportEpub("from-current"));
    els.closePreviewButton.addEventListener("click", () => {
      els.previewPanel.hidden = true;
    });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id;
    state.currentEpisodeId = getEpisodeId(tab?.url || "");

    if (!state.tabId || !/^https:\/\/kakuyomu\.jp\/works\/\d+/.test(tab.url || "")) {
      setStatus("请先打开一个カクヨム作品首页。");
      return;
    }

    try {
      const result = await sendToTab({ type: "KAKUYOMU_GET_WORK" });
      state.work = result.work;
      state.episodes = result.episodes;
      state.cache = await loadChapterCache();
      refreshCompletedCount();
      state.previewIndex = defaultPreviewIndex();
      renderWork();
      await renderHistory();
    } catch (error) {
      setError(formatError(error, "init"));
    }
  }

  async function exportEpub(mode = "all") {
    if (state.busy || !state.work || !state.episodes.length) return;

    state.busy = true;
    state.cancelled = false;
    state.exportMode = mode;
    els.exportButton.disabled = true;
    els.exportCurrentButton.disabled = true;
    els.exportFromCurrentButton.disabled = true;
    els.importButton.disabled = true;
    els.saveProgressButton.disabled = true;
    els.previewButton.disabled = true;
    els.clearCacheButton.disabled = true;
    els.cancelButton.hidden = false;
    els.cancelButton.disabled = false;
    els.exportButton.closest(".buttonRow")?.classList.add("isBusy");
    els.progressPanel.hidden = false;
    renderProgressSteps();
    setError("");

    const selectedEpisodes = selectedEpisodesForMode(mode);
    setExportProgress("prepare", 0, "准备导出", 0, selectedEpisodes.length, "");
    const chapters = [];
    const cache = state.cache || await loadChapterCache();
    applyCurrentOptionsToCache(cache);
    setExportProgress("prepare", 8, "保存导出设置", 0, selectedEpisodes.length, "");
    await saveChapterCache(cache);

    try {
      for (let i = 0; i < selectedEpisodes.length; i++) {
        assertNotCancelled();
        const episode = selectedEpisodes[i];
        const cached = cache.chapters[episode.id];
        setChapterProgress(cached ? "读取缓存" : "抓取章节", i, selectedEpisodes.length, episode.title);

        const chapter = cached || await fetchEpisodeWithRetry(episode, state.episodes.indexOf(episode), cache);
        chapters.push({
          ...episode,
          ...chapter,
          title: episode.title || chapter.title
        });

        if (els.respectDelay.checked) {
          await sleep(350);
        }
        setChapterProgress("已完成章节", i + 1, selectedEpisodes.length, episode.title);
      }

      assertNotCancelled();
      setExportProgress("build", 70, "生成 EPUB", selectedEpisodes.length, selectedEpisodes.length, "");
      const blob = await buildEpubBlob({
        work: state.work,
        chapters,
        includeDescription: els.includeDescription.checked,
        writingMode: getWritingMode(),
        compatibleMode: els.compatibleMode.checked
      });

      setExportProgress("download", 95, "准备下载", selectedEpisodes.length, selectedEpisodes.length, "");
      const url = URL.createObjectURL(blob);
      const exportFileName = `${buildExportFileName(mode, selectedEpisodes)}.epub`;
      await chrome.downloads.download({
        url,
        filename: exportFileName,
        saveAs: true
      });

      setStatus("导出完成。EPUB 可直接发送到 Kindle，或用 Calibre 转换。");
      setExportProgress("complete", 100, "完成", selectedEpisodes.length, selectedEpisodes.length, "");
      await recordExportHistory({
        mode,
        selectedEpisodes,
        fileName: exportFileName,
        chapterCount: selectedEpisodes.length
      });
      if (mode === "all") {
        await clearChapterCache();
        state.cache = emptyCache();
        state.completedCount = 0;
        updateResumeUi();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      if (error?.name === "ExportCancelledError") {
        await flushChapterCache();
        const saved = await trySaveProgressFile();
        if (saved) {
          setStatus("导出已取消。已保存中间文件，可下次导入后继续。");
        }
        setError("");
      } else {
        await flushChapterCache();
        await trySaveProgressFile();
        setError(formatError(error, "export"));
      }
    } finally {
      state.busy = false;
      state.cancelled = false;
      state.exportMode = "all";
      els.exportButton.disabled = !state.episodes.length;
      els.exportCurrentButton.disabled = !canUseCurrentEpisode();
      els.exportFromCurrentButton.disabled = !canUseCurrentEpisode();
      els.importButton.disabled = false;
      els.cancelButton.hidden = true;
      els.cancelButton.disabled = true;
      els.exportButton.closest(".buttonRow")?.classList.remove("isBusy");
      updateResumeUi();
    }
  }

  async function buildEpubBlob(options) {
    if (typeof window.KakuyomuEpub.buildEpubAsync !== "function") {
      return window.KakuyomuEpub.buildEpub(options);
    }

    return window.KakuyomuEpub.buildEpubAsync(options, {
      onProgress({ phase, done, total, title }) {
        if (phase === "chapters") {
          const percent = 70 + (total ? Math.round((done / total) * 20) : 0);
          setExportProgress("build", percent, "生成 EPUB 内容", done, total, title);
        } else {
          setExportProgress("build", 92, "打包 EPUB", total, total, "");
        }
      }
    });
  }

  async function fetchEpisodeWithRetry(episode, index, cache) {
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
      assertNotCancelled();
      try {
        if (attempt > 0) {
          setError(`第 ${index + 1} 章抓取失败，正在重试 ${attempt}/${MAX_FETCH_RETRIES}：${episode.title}`);
          await sleep(700 * attempt);
        }

        const chapter = await sendToTab({
          type: "KAKUYOMU_FETCH_EPISODE",
          url: episode.url
        });
        const normalizedChapter = {
          ...episode,
          ...chapter,
          title: episode.title || chapter.title
        };
        const wasCached = Boolean(cache.chapters[episode.id]);
        cache.chapters[episode.id] = normalizedChapter;
        if (!wasCached) {
          state.completedCount += 1;
        }
        state.cache = cache;
        state.dirtyChapterIds.add(episode.id);
        scheduleChapterCacheSave();
        updateResumeUi();
        setError("");
        return chapter;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`第 ${index + 1} 章抓取失败：${lastError?.message || String(lastError)}`);
  }

  function cancelExport() {
    state.cancelled = true;
    els.cancelButton.disabled = true;
    setStatus("正在停止导出...");
  }

  function renderWork() {
    els.workPanel.hidden = false;
    els.workTitle.textContent = state.work.title;
    els.workAuthor.textContent = state.work.author ? `作者：${state.work.author}` : "作者：未知";
    els.workDescription.textContent = previewText(state.work.description || "没有读取到简介。", DESCRIPTION_PREVIEW_LIMIT);
    els.episodeCount.textContent = episodeCountText();
    els.exportButton.disabled = false;
    renderCurrentEpisodeActions();
    renderPreviewOptions();
    updateResumeUi();
    setStatus("已识别作品，可以导出。");
  }

  async function previewChapter(index = state.previewIndex) {
    if (state.busy || !state.work || !state.episodes.length) return;

    const cache = state.cache || await loadChapterCache();
    const safeIndex = clampIndex(index);
    const episode = state.episodes[safeIndex];
    if (!episode) return;

    try {
      state.previewIndex = safeIndex;
      els.previewSelect.value = String(safeIndex);
      els.previewButton.disabled = true;
      setStatus(cache.chapters[episode.id] ? "正在打开预览..." : "正在抓取预览章节...");
      const chapter = cache.chapters[episode.id] || await fetchEpisodeWithRetry(episode, state.episodes.indexOf(episode), cache);
      renderPreview({
        ...episode,
        ...chapter,
        title: episode.title || chapter.title
      });
      setStatus("预览已生成。");
    } catch (error) {
      setError(formatError(error, "preview"));
    } finally {
      updateResumeUi();
    }
  }

  async function clearSavedProgress() {
    if (!state.work || state.busy) return;
    await clearChapterCache();
    state.cache = emptyCache();
    state.completedCount = 0;
    els.previewPanel.hidden = true;
    updateResumeUi();
    setStatus("已清除本作品的会话缓存。");
  }

  function renderPreview(chapter) {
    state.previewChapter = chapter;
    els.previewTitle.textContent = chapter.title;
    const lines = els.previewFull.checked ? chapter.body : chapter.body.slice(0, PREVIEW_SUMMARY_LINES);
    els.previewBody.innerHTML = lines.map(previewLine).join("");
    els.previewPanel.hidden = false;
    updatePreviewNav();
  }

  async function renderHistory() {
    const history = await loadExportHistory();
    const related = history.filter((item) => item.workId === state.work?.id).slice(0, HISTORY_LIMIT);
    els.historyPanel.hidden = !related.length;
    els.historyList.replaceChildren(...related.map(historyItem));
  }

  function historyItem(item) {
    const row = document.createElement("div");
    row.className = "historyItem";

    const title = document.createElement("strong");
    title.textContent = item.fileName || item.title || "EPUB";

    const meta = document.createElement("span");
    meta.textContent = `${formatLocalTime(item.exportedAt)} · ${item.chapterCount || 0} 章 · ${historyModeLabel(item.mode)}`;

    row.append(title, meta);
    return row;
  }

  function previewLine(line) {
    const text = String(line || "");
    if (!text) return "<p><br></p>";
    if (text === "<hr/>") return "<hr>";
    if (/^<h[23]>[\s\S]*<\/h[23]>$/i.test(text)) return text;
    return `<p>${text}</p>`;
  }

  async function importResumeFile() {
    const [file] = els.resumeFile.files || [];
    els.resumeFile.value = "";
    if (!file) return;

    try {
      if (!state.work?.id) {
        throw new Error("请先打开对应的カクヨム作品页。");
      }
      const imported = parseResumeFile(await readResumeFile(file));
      if (state.work?.id && imported.workId !== state.work.id) {
        throw new Error("中间文件不属于当前作品，请打开对应作品页后再导入。");
      }

      state.work = imported.work;
      state.episodes = imported.episodes;
      state.cache = imported;
      refreshCompletedCount();
      state.previewIndex = defaultPreviewIndex();
      applyOptionsFromCache(imported);
      await saveChapterCache(imported);
      renderWork();
      setStatus(`已导入中间文件，已完成 ${completedCount(imported)}/${imported.episodes.length} 章。`);
      setError("");
    } catch (error) {
      setError(formatError(error, "import"));
    }
  }

  async function saveProgressFile() {
    const cache = state.cache || await loadChapterCache();
    applyCurrentOptionsToCache(cache);
    state.cache = normalizeCache(cache);
    markAllChaptersDirty();
    await flushChapterCache();

    const { blob, extension } = await buildProgressBlob(toResumeFile(state.cache));
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: `${safeFileName(state.work?.title || "kakuyomu")}.kakuyomu-export.${extension}`,
      saveAs: true
    });
    setStatus("已保存中间文件。");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function trySaveProgressFile() {
    try {
      await saveProgressFile();
      return true;
    } catch (_error) {
      setStatus("导出已停止。进度仍保存在本次浏览器会话中，可手动保存中间文件。");
      return false;
    }
  }

  function setStatus(text) {
    els.pageStatus.textContent = text;
  }

  function setError(text) {
    els.message.textContent = text;
  }

  function setProgress(label, done, total, title) {
    const percent = total ? Math.round((done / total) * 100) : 0;
    setExportProgress("", percent, label, done, total, title);
  }

  function setChapterProgress(label, done, total, title) {
    const fetchPercent = total ? Math.round((done / total) * 60) : 0;
    setExportProgress("fetch", 10 + fetchPercent, label, done, total, title);
  }

  function setExportProgress(stepKey, percent, label, done, total, title) {
    els.progressLabel.textContent = title ? `${label}：${title}` : label;
    els.progressCount.textContent = `${done}/${total}`;
    els.progressBar.value = Math.max(0, Math.min(100, percent));
    if (stepKey) updateProgressSteps(stepKey);
  }

  function renderProgressSteps() {
    if (!els.progressSteps) return;
    els.progressSteps.replaceChildren(...EXPORT_STEPS.map((step) => {
      const item = document.createElement("li");
      item.dataset.step = step.key;
      item.textContent = step.label;
      return item;
    }));
  }

  function updateProgressSteps(activeKey) {
    if (!els.progressSteps) return;
    const activeIndex = EXPORT_STEPS.findIndex((step) => step.key === activeKey);
    for (const item of els.progressSteps.children) {
      const stepIndex = EXPORT_STEPS.findIndex((step) => step.key === item.dataset.step);
      item.classList.toggle("isDone", activeIndex >= 0 && stepIndex < activeIndex);
      item.classList.toggle("isActive", stepIndex === activeIndex);
    }
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

  async function loadChapterCache() {
    if (!state.work?.id) return emptyCache();

    const keys = [cacheMetaKey(), legacyCacheKey(), ...state.episodes.map((episode) => cacheChapterKey(episode.id))];
    const stored = await chrome.storage.session.get(keys);
    const meta = stored[cacheMetaKey()];
    const legacy = stored[legacyCacheKey()];
    const cache = normalizeCache(meta?.workId === state.work.id ? meta : legacy);

    for (const episode of state.episodes) {
      const chapter = stored[cacheChapterKey(episode.id)];
      if (chapter) cache.chapters[episode.id] = chapter;
    }

    return cache;
  }

  async function saveChapterCache(cache) {
    if (!state.work?.id) return;
    state.cache = normalizeCache({
      ...cache,
      updatedAt: new Date().toISOString()
    });
    refreshCompletedCount();
    markAllChaptersDirty();
    await writeChapterCache();
    state.cacheDirty = false;
  }

  function scheduleChapterCacheSave() {
    state.cacheDirty = true;
    if (state.cacheSaveTimer) return;

    state.cacheSaveTimer = setTimeout(() => {
      state.cacheSaveTimer = null;
      state.cacheSavePromise = writeChapterCache();
    }, CACHE_SAVE_DELAY);
  }

  async function flushChapterCache() {
    if (state.cacheSaveTimer) {
      clearTimeout(state.cacheSaveTimer);
      state.cacheSaveTimer = null;
    }
    if (state.cacheSavePromise) {
      await state.cacheSavePromise;
    }
    if (state.cacheDirty) {
      await writeChapterCache();
    }
  }

  async function writeChapterCache() {
    if (!state.work?.id || !state.cache) return;

    state.cache.updatedAt = new Date().toISOString();
    const payload = {
      [cacheMetaKey()]: cacheMeta(state.cache)
    };
    for (const episodeId of state.dirtyChapterIds) {
      const chapter = state.cache.chapters[episodeId];
      if (!chapter) continue;
      payload[cacheChapterKey(episodeId)] = chapter;
    }
    await chrome.storage.session.set(payload);
    state.cacheDirty = false;
    state.dirtyChapterIds.clear();
    state.cacheSavePromise = null;
  }

  async function clearChapterCache() {
    if (!state.work?.id) return;
    if (state.cacheSaveTimer) {
      clearTimeout(state.cacheSaveTimer);
      state.cacheSaveTimer = null;
    }
    if (state.cacheSavePromise) {
      await state.cacheSavePromise;
    }
    state.cacheDirty = false;
    state.dirtyChapterIds.clear();
    await chrome.storage.session.remove([
      cacheMetaKey(),
      legacyCacheKey(),
      ...state.episodes.map((episode) => cacheChapterKey(episode.id))
    ]);
  }

  function emptyCache() {
    return {
      version: RESUME_FILE_VERSION,
      workId: state.work?.id || "",
      work: state.work || null,
      episodes: state.episodes || [],
      options: currentOptions(),
      updatedAt: new Date().toISOString(),
      chapters: {}
    };
  }

  function parseResumeFile(value) {
    const cache = normalizeCache(value);
    if (cache.version !== RESUME_FILE_VERSION) {
      throw new Error("中间文件版本不支持。");
    }
    if (!cache.workId || !cache.work?.title || !Array.isArray(cache.episodes)) {
      throw new Error("中间文件缺少作品信息。");
    }
    if (!cache.episodes.length) {
      throw new Error("中间文件没有章节目录。");
    }
    return cache;
  }

  function normalizeCache(cache) {
    const normalized = cache && typeof cache === "object" ? cache : {};
    return {
      version: Number(normalized.version || RESUME_FILE_VERSION),
      workId: String(normalized.workId || normalized.work?.id || state.work?.id || ""),
      work: normalized.work || state.work || null,
      episodes: Array.isArray(normalized.episodes) && normalized.episodes.length
        ? normalized.episodes
        : state.episodes || [],
      options: {
        includeDescription: Boolean(normalized.options?.includeDescription ?? els.includeDescription.checked),
        writingMode: normalized.options?.writingMode === "vertical" ? "vertical" : "horizontal",
        compatibleMode: Boolean(normalized.options?.compatibleMode),
        fileNameTemplate: normalized.options?.fileNameTemplate || els.fileNameTemplate.value,
        compressProgress: Boolean(normalized.options?.compressProgress ?? els.compressProgress.checked)
      },
      updatedAt: normalized.updatedAt || new Date().toISOString(),
      chapters: normalized.chapters && typeof normalized.chapters === "object" ? normalized.chapters : {}
    };
  }

  function toResumeFile(cache) {
    const normalized = normalizeCache(cache);
    return {
      version: RESUME_FILE_VERSION,
      workId: normalized.workId,
      work: normalized.work,
      episodes: normalized.episodes,
      options: normalized.options,
      updatedAt: new Date().toISOString(),
      chapters: normalized.chapters
    };
  }

  function applyCurrentOptionsToCache(cache) {
    cache.version = RESUME_FILE_VERSION;
    cache.workId = state.work?.id || cache.workId;
    cache.work = state.work || cache.work;
    cache.episodes = state.episodes?.length ? state.episodes : cache.episodes;
    cache.options = currentOptions();
    cache.updatedAt = new Date().toISOString();
  }

  function applyOptionsFromCache(cache) {
    els.includeDescription.checked = Boolean(cache.options?.includeDescription);
    els.compatibleMode.checked = Boolean(cache.options?.compatibleMode);
    els.fileNameTemplate.value = cache.options?.fileNameTemplate || "title";
    els.compressProgress.checked = Boolean(cache.options?.compressProgress ?? true);
    const mode = cache.options?.writingMode === "vertical" ? "vertical" : "horizontal";
    for (const input of els.writingModes) {
      input.checked = input.value === mode;
    }
  }

  function currentOptions() {
    return {
      includeDescription: els.includeDescription.checked,
      writingMode: getWritingMode(),
      compatibleMode: els.compatibleMode.checked,
      fileNameTemplate: els.fileNameTemplate.value,
      compressProgress: els.compressProgress.checked
    };
  }

  function updateResumeUi() {
    const done = state.completedCount;
    els.saveProgressButton.disabled = !state.work || !done || state.busy;
    els.clearCacheButton.disabled = !state.work || !done || state.busy;
    els.previewButton.disabled = !state.work || !state.episodes.length || state.busy;
    els.exportCurrentButton.disabled = !canUseCurrentEpisode() || state.busy;
    els.exportFromCurrentButton.disabled = !canUseCurrentEpisode() || state.busy;
    if (state.work) {
      els.episodeCount.textContent = episodeCountText();
    }
    updatePreviewNav();
  }

  function renderPreviewOptions() {
    const fragment = document.createDocumentFragment();
    state.episodes.forEach((episode, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = previewOptionLabel(episode, index);
      fragment.appendChild(option);
    });

    els.previewSelect.replaceChildren(fragment);
    state.previewIndex = clampIndex(state.previewIndex);
    els.previewSelect.value = String(state.previewIndex);
    updatePreviewNav();
  }

  function previewOptionLabel(episode, index) {
    const markers = [];
    if (episode.id === state.currentEpisodeId) markers.push("当前页");
    if (state.cache?.chapters?.[episode.id]) markers.push("已缓存");
    const suffix = markers.length ? ` (${markers.join(" / ")})` : "";
    return `${index + 1}. ${episode.rawTitle || episode.title}${suffix}`;
  }

  function updatePreviewNav() {
    const hasEpisodes = Boolean(state.work && state.episodes.length);
    els.previewSelect.disabled = !hasEpisodes || state.busy;
    els.prevPreviewButton.disabled = !hasEpisodes || state.busy || state.previewIndex <= 0;
    els.nextPreviewButton.disabled = !hasEpisodes || state.busy || state.previewIndex >= state.episodes.length - 1;
    if (hasEpisodes && els.previewSelect.options.length === state.episodes.length) {
      const episode = state.episodes[state.previewIndex];
      const option = els.previewSelect.options[state.previewIndex];
      if (episode && option) option.textContent = previewOptionLabel(episode, state.previewIndex);
    }
  }

  function defaultPreviewIndex() {
    if (state.currentEpisodeId) {
      const currentIndex = state.episodes.findIndex((episode) => episode.id === state.currentEpisodeId);
      if (currentIndex >= 0) return currentIndex;
    }

    const cachedIndex = state.episodes.findIndex((episode) => state.cache?.chapters?.[episode.id]);
    return cachedIndex >= 0 ? cachedIndex : 0;
  }

  function clampIndex(index) {
    if (!state.episodes.length) return 0;
    return Math.min(Math.max(Number.isFinite(index) ? index : 0, 0), state.episodes.length - 1);
  }

  function episodeCountText() {
    const done = state.completedCount;
    return done ? `${done}/${state.episodes.length} 章已缓存` : `${state.episodes.length} 章`;
  }

  function completedCount(cache) {
    if (!cache?.chapters) return 0;
    let count = 0;
    for (const episode of state.episodes) {
      if (cache.chapters[episode.id]) count += 1;
    }
    return count;
  }

  function refreshCompletedCount() {
    state.completedCount = completedCount(state.cache);
  }

  function markAllChaptersDirty() {
    state.dirtyChapterIds = new Set(Object.keys(state.cache?.chapters || {}));
    state.cacheDirty = true;
  }

  function formatError(error, context) {
    const message = error?.message || String(error);
    if (/Receiving end does not exist|Could not establish connection|插件通信失败/.test(message)) {
      return "无法连接到页面脚本。请刷新 Kakuyomu 页面后重试。";
    }
    if (/HTTP\s+\d+|Failed to fetch|NetworkError|章节请求失败|作品目录请求失败/.test(message)) {
      return `${contextLabel(context)}网络请求失败。进度已保留，可稍后重试。详情：${message}`;
    }
    if (/未能解析章节正文|没有找到章节目录|不是カクヨム作品页/.test(message)) {
      return `${contextLabel(context)}页面解析失败。Kakuyomu 页面结构可能有变化，或当前页面不是作品目录。详情：${message}`;
    }
    if (/QUOTA|storage|中间文件|JSON|gzip|解压|版本不支持|缺少作品信息|没有章节目录/i.test(message)) {
      return `${contextLabel(context)}进度文件或缓存处理失败。请确认导入的是本扩展保存的中间文件。详情：${message}`;
    }
    if (/download|下载|USER_CANCELED/i.test(message)) {
      return `${contextLabel(context)}下载被取消或失败。进度仍保留，可重新保存或导出。详情：${message}`;
    }
    return `${contextLabel(context)}${message}`;
  }

  function contextLabel(context) {
    return {
      init: "初始化：",
      export: "导出：",
      preview: "预览：",
      import: "导入："
    }[context] || "";
  }

  async function recordExportHistory({ mode, selectedEpisodes, fileName, chapterCount }) {
    const history = await loadExportHistory();
    const item = {
      workId: state.work?.id || "",
      title: state.work?.title || "",
      author: state.work?.author || "",
      fileName,
      mode,
      chapterCount,
      firstEpisodeId: selectedEpisodes[0]?.id || "",
      lastEpisodeId: selectedEpisodes[selectedEpisodes.length - 1]?.id || "",
      exportedAt: new Date().toISOString()
    };

    await chrome.storage.local.set({
      [HISTORY_KEY]: [item, ...history].slice(0, 30)
    });
    await renderHistory();
  }

  async function loadExportHistory() {
    try {
      const stored = await chrome.storage.local.get(HISTORY_KEY);
      return Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    } catch (_error) {
      return [];
    }
  }

  function historyModeLabel(mode) {
    return {
      all: "整本",
      current: "当前章",
      "from-current": "从当前章"
    }[mode] || "导出";
  }

  function formatLocalTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function selectedEpisodesForMode(mode) {
    const currentIndex = currentEpisodeIndex();
    if (mode === "current" && currentIndex >= 0) {
      return [state.episodes[currentIndex]];
    }
    if (mode === "from-current" && currentIndex >= 0) {
      return state.episodes.slice(currentIndex);
    }
    return state.episodes;
  }

  async function readResumeFile(file) {
    if (file.name.endsWith(".gz")) {
      if (typeof DecompressionStream !== "function") {
        throw new Error("当前浏览器不支持解压中间文件，请使用 JSON 进度文件。");
      }
      const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(await file.text());
  }

  async function buildProgressBlob(data) {
    const text = JSON.stringify(data);
    if (!els.compressProgress.checked || typeof CompressionStream !== "function") {
      return {
        blob: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
        extension: "json"
      };
    }

    const stream = new Blob([text], { type: "application/json" })
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    return {
      blob: await new Response(stream).blob(),
      extension: "json.gz"
    };
  }

  function buildExportFileName(mode, selectedEpisodes) {
    const parts = [];
    const template = els.fileNameTemplate.value;
    parts.push(state.work?.title || "kakuyomu");
    if (template.includes("author") && state.work?.author) {
      parts.push(state.work.author);
    }
    if (template.includes("range") || mode !== "all") {
      const range = exportRangeLabel(mode, selectedEpisodes);
      if (range) parts.push(range);
    }
    return safeFileName(parts.join(" - "));
  }

  function exportRangeLabel(mode, selectedEpisodes) {
    if (!selectedEpisodes.length) return "";
    const firstIndex = state.episodes.indexOf(selectedEpisodes[0]) + 1;
    const lastIndex = state.episodes.indexOf(selectedEpisodes[selectedEpisodes.length - 1]) + 1;
    if (mode === "current" || firstIndex === lastIndex) return `第${padNumber(firstIndex)}話`;
    return `第${padNumber(firstIndex)}-${padNumber(lastIndex)}話`;
  }

  function padNumber(value) {
    return String(value).padStart(3, "0");
  }

  function renderCurrentEpisodeActions() {
    const enabled = canUseCurrentEpisode();
    els.exportCurrentButton.hidden = !enabled;
    els.exportFromCurrentButton.hidden = !enabled;
    els.exportCurrentButton.disabled = !enabled;
    els.exportFromCurrentButton.disabled = !enabled;
  }

  function canUseCurrentEpisode() {
    return currentEpisodeIndex() >= 0;
  }

  function currentEpisodeIndex() {
    if (!state.currentEpisodeId) return -1;
    return state.episodes.findIndex((episode) => episode.id === state.currentEpisodeId);
  }

  function cacheMeta(cache) {
    return {
      version: cache.version,
      workId: cache.workId,
      work: cache.work,
      episodes: cache.episodes,
      options: cache.options,
      updatedAt: cache.updatedAt
    };
  }

  function cacheMetaKey() {
    return `${CACHE_META_PREFIX}${state.work.id}`;
  }

  function cacheChapterKey(episodeId) {
    return `${CACHE_CHAPTER_PREFIX}${state.work.id}:${episodeId}`;
  }

  function legacyCacheKey() {
    return `kakuyomu-export:${state.work.id}`;
  }

  function assertNotCancelled() {
    if (!state.cancelled) return;
    const error = new Error("导出已取消。");
    error.name = "ExportCancelledError";
    throw error;
  }

  function safeFileName(value) {
    return String(value || "kakuyomu")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  function previewText(value, limit) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, limit - 3)}...`;
  }

  function getWritingMode() {
    return [...els.writingModes].find((input) => input.checked)?.value || "horizontal";
  }

  function getEpisodeId(url) {
    try {
      return new URL(url).pathname.match(/\/episodes\/(\d+)/)?.[1] || "";
    } catch (_error) {
      return "";
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
