(() => {
  "use strict";

  const LOG_PREFIX = "[BILASOLUR-EXTRA]";
  const MAX_CONCURRENCY = 2;     // rate-friendly
  const REQUEST_DELAY_MS = 350;  // small spacing between requests
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes in sessionStorage

  const memCache = new Map(); // url -> {ts, data}
  let active = 0;
  const queue = [];
  const seenCards = new WeakSet();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }
  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  function now() {
    return Date.now();
  }

  function getSessionCache(url) {
    try {
      const raw = sessionStorage.getItem("ks_cache_" + url);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.ts || !obj.data) return null;
      if (now() - obj.ts > CACHE_TTL_MS) return null;
      return obj;
    } catch {
      return null;
    }
  }

  function setSessionCache(url, data) {
    try {
      sessionStorage.setItem("ks_cache_" + url, JSON.stringify({ ts: now(), data }));
    } catch {}
  }

  function normalizeSpaces(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function textOf(el) {
    return normalizeSpaces(el?.textContent || "");
  }

  // Finds "Label" then returns the next meaningful text near it (sibling / next cell / next node)
  function findValueNearLabel(doc, labelText) {
    const all = doc.querySelectorAll("body *");
    const label = [...all].find((n) => normalizeSpaces(n.textContent) === labelText);
    if (!label) return null;

    if (label.nextElementSibling) {
      const t = textOf(label.nextElementSibling);
      if (t) return t;
    }

    const tr = label.closest("tr");
    if (tr) {
      const tds = tr.querySelectorAll("td, th");
      if (tds.length >= 2) {
        const t = textOf(tds[1]);
        if (t) return t;
      }
    }

    let node = label;
    for (let i = 0; i < 8; i++) {
      node = node.nextSibling;
      if (!node) break;
      const t = normalizeSpaces(node.textContent || "");
      if (t) return t;
    }

    return null;
  }

  function parseHorsepower(doc) {
    const v = findValueNearLabel(doc, "Vél");
    if (!v) return null;

    const m = v.match(/(\d+)\s*hestöfl/i);
    if (m) return `${m[1]} horsepower`;

    const n = v.match(/(\d+)/);
    if (n) return `${n[1]} horsepower`;

    return v;
  }

  function parseCityConsumption(doc) {
    const bodyText = normalizeSpaces(doc.body?.textContent || "");

    const m =
      bodyText.match(/Innanbæjareyðsla\s*([0-9]+(?:[.,][0-9]+)?)\s*l\s*\/\s*100\s*km/i) ||
      bodyText.match(/Innanbæjareyðsla\s*([0-9]+(?:[.,][0-9]+)?)\s*l\/100km/i);

    if (!m) return null;

    const val = m[1].replace(",", ".");
    return `${val} l/100km`;
  }

  function parseLastUpdated(doc) {
    const bodyText = normalizeSpaces(doc.body?.textContent || "");
    const m = bodyText.match(/Síðast uppfært\s*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{4})/i);
    return m ? m[1] : null;
  }

  function parseTireSet(doc) {
    const bodyText = normalizeSpaces(doc.body?.textContent || "");

    const m =
      bodyText.match(/\b4\s+(sumardekk|nagladekk|heilsársdekk|vetrardekk)\b/i) ||
      bodyText.match(/\b4\s+(all-?season\s+tires|winter\s+tires|summer\s+tires)\b/i);

    if (!m) return null;

    const raw = m[1].toLowerCase();
    if (raw.includes("nagla")) return "4 winter tires (studded)";
    if (raw.includes("vetr")) return "4 winter tires";
    if (raw.includes("sumar")) return "4 summer tires";
    if (raw.includes("heils")) return "4 all-season tires";
    return `4 ${m[1]}`;
  }

  async function fetchAndParse(detailsUrl) {
    const inMem = memCache.get(detailsUrl);
    if (inMem && now() - inMem.ts <= CACHE_TTL_MS) return inMem.data;

    const inSess = getSessionCache(detailsUrl);
    if (inSess) {
      memCache.set(detailsUrl, inSess);
      return inSess.data;
    }

    const resp = await fetch(detailsUrl, { credentials: "include" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    const data = {
      horsepower: parseHorsepower(doc),
      cityConsumption: parseCityConsumption(doc),
      tireSet: parseTireSet(doc),
      lastUpdated: parseLastUpdated(doc),
    };

    memCache.set(detailsUrl, { ts: now(), data });
    setSessionCache(detailsUrl, data);

    return data;
  }

  function makeExtraBox(data) {
    const box = document.createElement("div");
    box.className = "ks-extraBox";

    const row1 = document.createElement("div");
    row1.className = "ks-extraRow";
    row1.innerHTML = `<span class="ks-extraKey">Vél:</span> ${
      data.horsepower || '<span class="ks-extraMuted">—</span>'
    }`;

    const row2 = document.createElement("div");
    row2.className = "ks-extraRow";
    row2.innerHTML = `<span class="ks-extraKey">Eldsneyti (inni):</span> ${
      data.cityConsumption || '<span class="ks-extraMuted">—</span>'
    }`;

    const row3 = document.createElement("div");
    row3.className = "ks-extraRow";
    row3.innerHTML = `<span class="ks-extraKey">Síðast uppfært:</span> ${
      data.lastUpdated || '<span class="ks-extraMuted">—</span>'
    }`;

    box.appendChild(row1);
    box.appendChild(row2);
    box.appendChild(row3);

    return box;
  }

  function ensureLoadingIndicator(cardEl) {
    let el = cardEl.querySelector(".ks-loading");
    if (el) return el;

    el = document.createElement("div");
    el.className = "ks-loading";
    el.innerHTML = `<span class="ks-spinner"></span>Loading…`;
    cardEl.appendChild(el);
    return el;
  }

  function findCardContainer(anchor) {
    return (
      anchor.closest("article") ||
      anchor.closest("li") ||
      anchor.closest(".result") ||
      anchor.closest(".results") ||
      anchor.closest(".car") ||
      anchor.closest(".item") ||
      anchor.closest("tr") ||
      anchor.parentElement
    );
  }

  function enqueue(detailsUrl, cardEl) {
    queue.push({ detailsUrl, cardEl });
    pump();
  }

  async function pump() {
    while (active < MAX_CONCURRENCY && queue.length) {
      const job = queue.shift();
      if (!job || !job.cardEl?.isConnected) continue;

      if (seenCards.has(job.cardEl)) continue;
      seenCards.add(job.cardEl);

      active++;
      (async () => {
        try {
          await sleep(REQUEST_DELAY_MS);

          const loadingEl = ensureLoadingIndicator(job.cardEl);

          log("Fetching details:", job.detailsUrl);
          const data = await fetchAndParse(job.detailsUrl);

          if (loadingEl && loadingEl.isConnected) loadingEl.remove();

          const existing = job.cardEl.querySelector(".ks-extraBox");
          if (existing) existing.remove();

          const box = makeExtraBox(data);
          job.cardEl.appendChild(box);

          log("Injected:", job.detailsUrl, data);
        } catch (e) {
          const loadingEl = job.cardEl?.querySelector(".ks-loading");
          if (loadingEl) loadingEl.remove();
          warn("Failed:", job.detailsUrl, e);
        } finally {
          active--;
          pump();
        }
      })();
    }
  }

  function scanAndQueue() {
    const anchors = [...document.querySelectorAll('a[href*="CarDetails.aspx"]')];
    const uniq = new Map();

    for (const a of anchors) {
      const href = a.getAttribute("href");
      if (!href) continue;
      const url = new URL(href, location.href).toString();
      if (!uniq.has(url)) uniq.set(url, a);
    }

    for (const [url, a] of uniq.entries()) {
      const card = findCardContainer(a);
      if (!card) continue;
      if (card.querySelector(".ks-extraBox")) continue;

      const schedule = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));
      schedule(() => enqueue(url, card));
    }
  }

  log("Initialized on", location.href);
  scanAndQueue();

  const mo = new MutationObserver(() => scanAndQueue());
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();