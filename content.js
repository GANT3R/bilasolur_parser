(() => {
  "use strict";

  const CONFIG = {
    logPrefix: "[BILASOLUR-EXTRA]",
    maxConcurrentRequests: 2,
    requestSpacingMs: 350,
    cacheTtlMs: 10 * 60 * 1000,
    storageDefaults: { enabled: true },
    debounceScanMs: 150
  };

  const runtimeState = {
    enabled: true,
    inFlight: 0,
    jobQueue: [],
    processedCards: new WeakSet(),
    memoryCache: new Map(),
    mutationObserver: null,
    scanDebounceTimer: null
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => Date.now();
  const normalizeText = (s) => (s || "").replace(/\s+/g, " ").trim();

  const log = (...args) => console.log(CONFIG.logPrefix, ...args);
  const warn = (...args) => console.warn(CONFIG.logPrefix, ...args);

  function readSessionCache(url) {
    try {
      const raw = sessionStorage.getItem("ks_cache_" + url);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed?.ts || !parsed?.data) return null;
      if (now() - parsed.ts > CONFIG.cacheTtlMs) return null;

      return parsed.data;
    } catch {
      return null;
    }
  }

  function writeSessionCache(url, data) {
    try {
      sessionStorage.setItem("ks_cache_" + url, JSON.stringify({ ts: now(), data }));
    } catch {}
  }

  function cacheGet(url) {
    const mem = runtimeState.memoryCache.get(url);
    if (mem && now() - mem.ts <= CONFIG.cacheTtlMs) return mem.data;

    const sessionData = readSessionCache(url);
    if (sessionData) {
      runtimeState.memoryCache.set(url, { ts: now(), data: sessionData });
      return sessionData;
    }

    return null;
  }

  function cacheSet(url, data) {
    runtimeState.memoryCache.set(url, { ts: now(), data });
    writeSessionCache(url, data);
  }

  function extractHorsepower(detailsDoc) {
    const bodyText = detailsDoc.body ? (detailsDoc.body.innerText || detailsDoc.body.textContent || "") : "";
    if (!bodyText) return null;

    const headerIndex = bodyText.search(/\bVél\b/i);
    if (headerIndex >= 0) {
      const windowText = bodyText.slice(headerIndex, headerIndex + 1200);
      const match = windowText.match(/(\d{2,4})\s*hest(?:ö|a)fl/i);
      if (match) return `${match[1]} horsepower`;
    }

    const fallback = bodyText.match(/(\d{2,4})\s*hest(?:ö|a)fl/i);
    return fallback ? `${fallback[1]} horsepower` : null;
  }

  function extractCityConsumption(detailsDoc) {
    const text = normalizeText(detailsDoc.body?.textContent || "");
    const match =
      text.match(/Innanbæjareyðsla\s*([0-9]+(?:[.,][0-9]+)?)\s*l\s*\/\s*100\s*km/i) ||
      text.match(/Innanbæjareyðsla\s*([0-9]+(?:[.,][0-9]+)?)\s*l\/100km/i);

    if (!match) return null;
    return `${match[1].replace(",", ".")} l/100km`;
  }

  function extractLastUpdated(detailsDoc) {
    const text = normalizeText(detailsDoc.body?.textContent || "");
    const match = text.match(/Síðast uppfært\s*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{4})/i);
    return match ? match[1] : null;
  }

  function extractTireSet(detailsDoc) {
    const text = normalizeText(detailsDoc.body?.textContent || "");
    const match =
      text.match(/\b4\s+(sumardekk|nagladekk|heilsársdekk|vetrardekk)\b/i) ||
      text.match(/\b4\s+(all-?season\s+tires|winter\s+tires|summer\s+tires)\b/i);

    if (!match) return null;

    const raw = match[1].toLowerCase();
    if (raw.includes("nagla")) return "4 winter tires (studded)";
    if (raw.includes("vetr")) return "4 winter tires";
    if (raw.includes("sumar")) return "4 summer tires";
    if (raw.includes("heils")) return "4 all-season tires";
    return `4 ${match[1]}`;
  }

  async function fetchCarDetailsData(detailsUrl) {
    const cached = cacheGet(detailsUrl);
    if (cached) return cached;

    const response = await fetch(detailsUrl, { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    const data = {
      horsepower: extractHorsepower(doc),
      cityConsumption: extractCityConsumption(doc),
      lastUpdated: extractLastUpdated(doc),
      tireSet: extractTireSet(doc)
    };

    cacheSet(detailsUrl, data);
    return data;
  }

  function createInfoBox(data) {
    const box = document.createElement("div");
    box.className = "ks-extraBox";

    const makeRow = (label, value) => {
      const row = document.createElement("div");
      row.className = "ks-extraRow";
      row.innerHTML = `<span class="ks-extraKey">${label}</span> ${
        value || '<span class="ks-extraMuted">—</span>'
      }`;
      return row;
    };

    box.appendChild(makeRow("Vél:", data.horsepower));
    box.appendChild(makeRow("Eldsneyti (inni):", data.cityConsumption));
    box.appendChild(makeRow("Síðast uppfært:", data.lastUpdated));

    return box;
  }

  function ensureLoadingIndicator(container) {
    const existing = container.querySelector(".ks-loading");
    if (existing) return existing;

    const el = document.createElement("div");
    el.className = "ks-loading";
    el.innerHTML = `<span class="ks-spinner"></span>Loading…`;
    container.appendChild(el);
    return el;
  }

  function removeInjectedUi(container) {
    container.querySelector(".ks-loading")?.remove();
    container.querySelector(".ks-extraBox")?.remove();
  }

  function removeAllInjectedUi() {
    document.querySelectorAll(".ks-loading, .ks-extraBox").forEach((n) => n.remove());
  }

  function findListingContainer(detailsLink) {
    return (
      detailsLink.closest("article") ||
      detailsLink.closest("li") ||
      detailsLink.closest(".result") ||
      detailsLink.closest(".results") ||
      detailsLink.closest(".car") ||
      detailsLink.closest(".item") ||
      detailsLink.closest("tr") ||
      detailsLink.parentElement
    );
  }

  function getUniqueDetailsLinksOnPage() {
    const anchors = [...document.querySelectorAll('a[href*="CarDetails.aspx"]')];
    const unique = new Map();

    for (const a of anchors) {
      const href = a.getAttribute("href");
      if (!href) continue;

      const url = new URL(href, location.href).toString();
      if (!unique.has(url)) unique.set(url, a);
    }

    return unique;
  }

  function enqueueJob(detailsUrl, container) {
    if (!runtimeState.enabled) return;
    runtimeState.jobQueue.push({ detailsUrl, container });
    processQueue();
  }

  async function processQueue() {
    if (!runtimeState.enabled) return;

    while (
      runtimeState.enabled &&
      runtimeState.inFlight < CONFIG.maxConcurrentRequests &&
      runtimeState.jobQueue.length
    ) {
      const job = runtimeState.jobQueue.shift();
      if (!job?.container?.isConnected) continue;
      if (runtimeState.processedCards.has(job.container)) continue;

      runtimeState.processedCards.add(job.container);
      runtimeState.inFlight += 1;

      (async () => {
        try {
          await sleep(CONFIG.requestSpacingMs);
          if (!runtimeState.enabled) return;

          const loadingEl = ensureLoadingIndicator(job.container);

          log("Fetching details:", job.detailsUrl);
          const data = await fetchCarDetailsData(job.detailsUrl);

          if (!runtimeState.enabled) return;

          if (loadingEl.isConnected) loadingEl.remove();

          job.container.querySelector(".ks-extraBox")?.remove();
          job.container.appendChild(createInfoBox(data));

          log("Injected:", job.detailsUrl, data);
        } catch (e) {
          removeInjectedUi(job.container);
          warn("Failed:", job?.detailsUrl, e);
        } finally {
          runtimeState.inFlight -= 1;
          if (runtimeState.enabled) processQueue();
        }
      })();
    }
  }

  function scheduleScan() {
    if (!runtimeState.enabled) return;

    if (runtimeState.scanDebounceTimer) clearTimeout(runtimeState.scanDebounceTimer);
    runtimeState.scanDebounceTimer = setTimeout(scanAndEnqueue, CONFIG.debounceScanMs);
  }

  function scanAndEnqueue() {
    if (!runtimeState.enabled) return;

    const uniqueLinks = getUniqueDetailsLinksOnPage();

    for (const [detailsUrl, anchor] of uniqueLinks.entries()) {
      const container = findListingContainer(anchor);
      if (!container) continue;
      if (container.querySelector(".ks-extraBox")) continue;

      const runWhenIdle = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));
      runWhenIdle(() => enqueueJob(detailsUrl, container));
    }
  }

  function startDomObserver() {
    if (runtimeState.mutationObserver) return;

    scanAndEnqueue();

    runtimeState.mutationObserver = new MutationObserver(scheduleScan);
    runtimeState.mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function stopDomObserver() {
    runtimeState.mutationObserver?.disconnect();
    runtimeState.mutationObserver = null;

    if (runtimeState.scanDebounceTimer) clearTimeout(runtimeState.scanDebounceTimer);
    runtimeState.scanDebounceTimer = null;
  }

  function setEnabled(isEnabled) {
    runtimeState.enabled = Boolean(isEnabled);

    if (!runtimeState.enabled) {
      stopDomObserver();
      runtimeState.jobQueue.length = 0;
      removeAllInjectedUi();
      log("Disabled on page");
      return;
    }

    log("Enabled on page");
    startDomObserver();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "BILASOLUR_SET_ENABLED") {
      setEnabled(message.enabled);
      sendResponse?.({ ok: true });
      return true;
    }
  });

  (async () => {
    try {
      const { enabled } = await chrome.storage.local.get(CONFIG.storageDefaults);
      setEnabled(enabled);
      log("Initialized:", location.href, "enabled =", runtimeState.enabled);
    } catch (e) {
      setEnabled(CONFIG.storageDefaults.enabled);
      warn("Storage read failed; defaulting enabled =", CONFIG.storageDefaults.enabled, e);
    }
  })();
})();