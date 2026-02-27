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

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }
  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  function now() { return Date.now(); }

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
  function findValueNearLabel(root, labelText) {
    const all = root.querySelectorAll("body *");
    const label = [...all].find(n => normalizeSpaces(n.textContent) === labelText);
    if (!label) return null;

    // Try nextElementSibling
    if (label.nextElementSibling) {
      const t = textOf(label.nextElementSibling);
      if (t) return t;
    }

    // Try parent row: <tr><td>Label</td><td>Value</td></tr>
    const tr = label.closest("tr");
    if (tr) {
      const tds = tr.querySelectorAll("td, th");
      if (tds.length >= 2) {
        const t = textOf(tds[1]);
        if (t) return t;
      }
    }

    // Try next nodes (limited)
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
    // Typically: "Vél" then a line like "222 hestöfl" :contentReference[oaicite:4]{index=4}
    const v = findValueNearLabel(doc, "Vél");
    if (!v) return null;

    // If value contains "hestöfl" already, keep it.
    const m = v.match(/(\d+)\s*hestöfl/i);
    if (m) return `${m[1]} horsepower`;

    // Else just return cleaned
    return v;
  }

  function parseCityConsumption(doc) {
    // City consumption on bilasolur often appears as "Innanbæjareyðsla 5,6 l/100km" :contentReference[oaicite:5]{index=5}
    const bodyText = normalizeSpaces(doc.body?.textContent || "");

    const m =
      bodyText.match(/Innanbæjareyðsla\s*([0-9]+(?:[.,][0-9]+)?)\s*l\s*\/\s*100\s*km/i) ||
      bodyText.match(/Innanbæjareyðsla\s*([0-9]+(?:[.,][0-9]+)?)\s*l\/100km/i);

    if (!m) return null;

    // Use dot as decimal separator in output
    const val = m[1].replace(",", ".");
    return `${val} l/100km`;
  }

  function parseLastUpdated(doc) {
    // "Síðast uppfært 26.2.2026" :contentReference[oaicite:6]{index=6}
    const bodyText = normalizeSpaces(doc.body?.textContent || "");
    const m = bodyText.match(/Síðast uppfært\s*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{4})/i);
    return m ? m[1] : null;
  }

  function parseTireSet(doc) {
    // Examples found: "4 sumardekk", "4 nagladekk" :contentReference[oaicite:7]{index=7}
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
    // memory cache
    const inMem = memCache.get(detailsUrl);
    if (inMem && (now() - inMem.ts) <= CACHE_TTL_MS) return inMem.data;

    // session cache
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
      lastUpdated: parseLastUpdated(doc)
    };

    const cached = { ts: now(), data };
    memCache.set(detailsUrl, cached);
    setSessionCache(detailsUrl, data);

    return data;
  }

  function makeExtraBox(data) {
    const box = document.createElement("div");
    box.className = "ks-extraBox";

    const line = document.createElement("div");
    line.className = "ks-extraLine";

    // Required output style (example):
    // Vél: 101 horsepower
    // Eldsneyti (inni): 6.6 l/100km
    const hp = document.createElement("span");
    hp.className = "ks-badge";
    hp.innerHTML = `<span class="ks-extraKey">Vél:</span> ${data.horsepower || '<span class="ks-extraMuted">—</span>'}`;
    line.appendChild(hp);

    const cc = document.createElement("span");
    cc.className = "ks-badge";
    cc.innerHTML = `<span class="ks-extraKey">Eldsneyti (inni):</span> ${data.cityConsumption || '<span class="ks-extraMuted">—</span>'}`;
    line.appendChild(cc);

    // You said Hjólabúnaður does NOT have to be shown — keep parsed value only for future use.
    // If you later want it visible, uncomment:
    // const ts = document.createElement("span");
    // ts.className = "ks-badge";
    // ts.innerHTML = `<span class="ks-extraKey">Hjólabúnaður:</span> ${data.tireSet || '<span class="ks-extraMuted">—</span>'}`;
    // line.appendChild(ts);

    const upd = document.createElement("div");
    upd.style.marginTop = "6px";
    upd.innerHTML = `<span class="ks-extraKey">Síðast uppfært:</span> ${data.lastUpdated || '<span class="ks-extraMuted">—</span>'}`;

    box.appendChild(line);
    box.appendChild(upd);
    return box;
  }

  function findCardContainer(anchor) {
    // Heuristic: try common containers, fallback to a reasonable parent.
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

      // Avoid duplicate work per card
      if (seenCards.has(job.cardEl)) continue;
      seenCards.add(job.cardEl);

      active++;
      (async () => {
        try {
          await sleep(REQUEST_DELAY_MS);

          log("Fetching details:", job.detailsUrl);
          const data = await fetchAndParse(job.detailsUrl);

          const existing = job.cardEl.querySelector(".ks-extraBox");
          if (existing) existing.remove();

          const box = makeExtraBox(data);

          // Insert near the link/card content (append at end is safest)
          job.cardEl.appendChild(box);

          log("Injected:", job.detailsUrl, data);
        } catch (e) {
          warn("Failed:", job.detailsUrl, e);
        } finally {
          active--;
          pump();
        }
      })();
    }
  }

  function scanAndQueue() {
    // Collect unique CarDetails links visible on the page
    const anchors = [...document.querySelectorAll('a[href*="CarDetails.aspx"]')];
    const uniq = new Map(); // url -> anchor

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

      // Load gradually when browser is idle
      const schedule = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));
      schedule(() => enqueue(url, card));
    }
  }

  // Initial scan
  log("Initialized on", location.href);
  scanAndQueue();

  // Handle dynamically added results
  const mo = new MutationObserver(() => scanAndQueue());
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();