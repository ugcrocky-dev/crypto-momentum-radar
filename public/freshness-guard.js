/**
 * Client research chrome — preserves existing Momentum UI.
 * Adds freshness banner + tabbed research drawer (Setups / BTC filters / Traction / Holdings).
 */
(function () {
  const MAIN = { freshMs: 45 * 60 * 1000, staleMs: 3 * 60 * 60 * 1000 };
  const HF = { freshMs: 60 * 1000, staleMs: 5 * 60 * 1000 };
  const FUTURE_SKEW = 5 * 60 * 1000;
  const WATCH_KEY = "cmr:my-holdings:v1";
  const DEFAULT_WATCH = ["XRP", "AERO", "UNI", "DOGE", "HBAR", "ARB", "SOL", "ETH"];
  const TAB_KEY = "cmr:research-tab:v1";
  const OPEN_KEY = "cmr:research-open:v1";

  let lastMain = null;
  let lastHf = null;
  let activeTab = "setups";
  let researchOpen = false;
  let panelsLoaded = false;

  function parseTs(v) {
    if (v == null || v === "") return null;
    const ms = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }

  function compute(sourceGeneratedAt, cadence) {
    const now = Date.now();
    const ms = parseTs(sourceGeneratedAt);
    if (ms == null) {
      return { status: "unknown", ageHours: null, ageMinutes: null, ageSeconds: null, sourceGeneratedAt: null, actionable: false };
    }
    if (ms - now > FUTURE_SKEW) {
      return { status: "unknown", ageHours: null, ageMinutes: null, ageSeconds: null, sourceGeneratedAt: new Date(ms).toISOString(), actionable: false, reason: "materially_future_dated" };
    }
    const ageMs = Math.max(0, now - ms);
    let status = "expired";
    if (ageMs < cadence.freshMs) status = "fresh";
    else if (ageMs < cadence.staleMs) status = "stale";
    return {
      status,
      ageMs,
      ageHours: Math.round((ageMs / 3600000) * 10) / 10,
      ageMinutes: Math.round((ageMs / 60000) * 10) / 10,
      ageSeconds: Math.round(ageMs / 1000),
      sourceGeneratedAt: new Date(ms).toISOString(),
      evaluatedAt: new Date(now).toISOString(),
      actionable: status === "fresh",
    };
  }

  function loadWatch() {
    try {
      const raw = localStorage.getItem(WATCH_KEY);
      if (!raw) return DEFAULT_WATCH.slice();
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed.map(function (s) { return String(s).toUpperCase(); });
    } catch (_) {}
    return DEFAULT_WATCH.slice();
  }

  function saveWatch(list) {
    localStorage.setItem(WATCH_KEY, JSON.stringify(list));
  }

  function ensureStyles() {
    if (document.getElementById("cmr-freshness-styles")) return;
    const style = document.createElement("style");
    style.id = "cmr-freshness-styles";
    style.textContent = [
      "#cmr-freshness-banner{position:sticky;top:0;z-index:9999;padding:10px 16px;font:600 13px/1.4 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.02em;border-bottom:1px solid rgba(255,255,255,.08)}",
      "#cmr-freshness-banner[data-status=fresh]{background:#0d2818;color:#9dffb9}",
      "#cmr-freshness-banner[data-status=stale]{background:#3a2a0a;color:#ffd27a}",
      "#cmr-freshness-banner[data-status=expired],#cmr-freshness-banner[data-status=unknown]{background:#3a1010;color:#ffb4b4}",
      "#cmr-freshness-banner small{opacity:.8;font-weight:400;display:block;margin-top:2px}",
      "#cmr-research-toggle{position:fixed;right:12px;bottom:12px;z-index:9998;font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.04em;background:#0f1624;color:#e8eef8;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:10px 14px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.4)}",
      "#cmr-research-toggle:hover{border-color:rgba(255,255,255,.35);background:#152036}",
      "#cmr-research-toggle[hidden]{display:none!important}",
      "#cmr-research{position:fixed;right:12px;bottom:12px;z-index:9998;width:min(440px,calc(100vw - 24px));max-height:min(78vh,640px);overflow:auto;background:rgba(6,9,15,.96);color:#d7dde8;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:12px 14px;font:12px/1.45 'IBM Plex Mono',ui-monospace,monospace;box-shadow:0 12px 40px rgba(0,0,0,.45)}",
      "#cmr-research[data-open=false]{display:none}",
      "#cmr-research[data-open=true]{display:block}",
      "#cmr-research .cmr-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px}",
      "#cmr-research h3{margin:0;font-size:13px;font-weight:600;color:#fff}",
      "#cmr-research .cmr-close{font:inherit;background:transparent;color:#c9d2e0;border:1px solid rgba(255,255,255,.14);border-radius:4px;padding:4px 8px;cursor:pointer}",
      "#cmr-research .tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}",
      "#cmr-research .tabs button{font:inherit;background:#121826;color:#c9d2e0;border:1px solid rgba(255,255,255,.12);border-radius:4px;padding:6px 8px;cursor:pointer}",
      "#cmr-research .tabs button[aria-selected=true]{background:#1c2a44;color:#fff;border-color:rgba(255,255,255,.28)}",
      "#cmr-research .cmr-row{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid rgba(255,255,255,.06)}",
      "#cmr-research button,#cmr-research input, #cmr-research select{font:inherit;background:#121826;color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:4px;padding:6px 8px}",
      "#cmr-research .muted{opacity:.7}",
      "#cmr-research .warn{color:#ffd27a}",
      "#cmr-research .ok{color:#9dffb9}",
      "#cmr-research .panel{display:none}",
      "#cmr-research .panel.active{display:block}",
      "@media (max-width:640px){#cmr-research,#cmr-research-toggle{right:8px;left:8px;width:auto;bottom:8px}#cmr-research-toggle{left:auto}}",
    ].join("");
    document.head.appendChild(style);
  }

  function ensureBanner() {
    ensureStyles();
    let el = document.getElementById("cmr-freshness-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "cmr-freshness-banner";
      el.setAttribute("role", "status");
      document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }

  function renderBanner() {
    const el = ensureBanner();
    const main = lastMain && lastMain.data && lastMain.data.freshness;
    const hf = lastHf && lastHf.data && lastHf.data.freshness;
    if (!main) {
      el.dataset.status = "unknown";
      el.innerHTML = "Momentum freshness unknown<small>Waiting for /api/momentum</small>";
      return;
    }
    const f = compute(main.sourceGeneratedAt || (lastMain.data && lastMain.data.sourceGeneratedAt), MAIN);
    el.dataset.status = f.status;
    const actionable = f.actionable ? "research context only — not trade advice" : "NOT current actionable signals — historical reference";
    const refresh = lastMain.refresh;
    const refreshLine = refresh
      ? "attempt " + (refresh.lastAttemptAt || "—") + " · success " + (refresh.lastSuccessAt || "—") + (refresh.lastError ? " · err " + refresh.lastError : "")
      : "refresh status unavailable";
    const hfLine = hf ? "HF: " + hf.status + " · " + (hf.ageSeconds != null ? hf.ageSeconds + "s" : "—") : "HF: —";
    el.innerHTML =
      "Momentum: <strong>" + f.status.toUpperCase() + "</strong> · age " +
      (f.ageHours != null ? f.ageHours + "h" : "—") +
      " · src " + (f.sourceGeneratedAt || "—") +
      "<small>" + actionable + " · " + refreshLine + " · " + hfLine + "</small>";
  }

  function ensureToggle() {
    ensureStyles();
    let btn = document.getElementById("cmr-research-toggle");
    if (btn) return btn;
    btn = document.createElement("button");
    btn.id = "cmr-research-toggle";
    btn.type = "button";
    btn.textContent = "Research";
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", "cmr-research");
    btn.addEventListener("click", function () {
      setResearchOpen(true);
    });
    document.body.appendChild(btn);
    return btn;
  }

  function setResearchOpen(open) {
    researchOpen = Boolean(open);
    try { localStorage.setItem(OPEN_KEY, researchOpen ? "1" : "0"); } catch (_) {}
    const el = ensureResearch();
    const toggle = ensureToggle();
    el.dataset.open = researchOpen ? "true" : "false";
    el.setAttribute("aria-hidden", researchOpen ? "false" : "true");
    toggle.hidden = researchOpen;
    toggle.setAttribute("aria-expanded", researchOpen ? "true" : "false");
    if (researchOpen) {
      syncTabs();
      loadActivePanel(true);
    }
  }

  function loadActivePanel(force) {
    if (!researchOpen) return;
    if (!force && panelsLoaded) return;
    panelsLoaded = true;
    if (activeTab === "setups") loadSetups();
    else if (activeTab === "btc") loadBtc();
    else if (activeTab === "traction") loadTraction();
    else if (activeTab === "holdings") renderWatch();
  }

  function watchlistQuery() {
    return loadWatch().map(function (s) { return encodeURIComponent(s); }).join(",");
  }

  function ensureResearch() {
    ensureStyles();
    let el = document.getElementById("cmr-research");
    if (el) return el;
    try { activeTab = localStorage.getItem(TAB_KEY) || "setups"; } catch (_) {}
    el = document.createElement("aside");
    el.id = "cmr-research";
    el.dataset.open = "false";
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("aria-label", "Research drawer");
    el.innerHTML = [
      "<div class='cmr-head'><h3>Research</h3>",
      "<button type='button' class='cmr-close' id='cmr-research-close' aria-label='Close research'>Close</button></div>",
      "<div class='tabs' role='tablist'>",
      "<button type='button' data-tab='setups'>Early Setups</button>",
      "<button type='button' data-tab='btc'>BTC-relative</button>",
      "<button type='button' data-tab='traction'>Traction</button>",
      "<button type='button' data-tab='holdings'>Holdings</button>",
      "</div>",
      "<div id='cmr-panel-setups' class='panel'><div class='muted'>Hypothesis detector — compression ≠ bullish. Holdings-first OHLCV.</div><div id='cmr-setups'></div></div>",
      "<div id='cmr-panel-btc' class='panel'><div class='muted'>Filters use excess pp & coin/BTC % — 90d never extrapolated</div>",
      "<select id='cmr-btc-filter'><option value=''>All holdings-first</option>",
      "<option value='beating-btc-7d'>Beating BTC (7d)</option>",
      "<option value='beating-btc-30d'>Beating BTC (30d)</option>",
      "<option value='beating-btc-all-available'>Beating BTC (all available)</option>",
      "<option value='improving-btc'>Improving vs BTC</option></select>",
      "<div id='cmr-btc-list' style='margin-top:8px'></div></div>",
      "<div id='cmr-panel-traction' class='panel'><div class='muted'>For Coiling/Igniting candidates — missing social = unknown</div>",
      "<div id='cmr-traction'></div></div>",
      "<div id='cmr-panel-holdings' class='panel'><div class='muted'>No size/PnL inferred</div>",
      "<div style='display:flex;gap:6px;margin:8px 0'><input id='cmr-watch-input' style='flex:1' placeholder='Add symbol' />",
      "<button type='button' id='cmr-watch-save'>Save</button></div>",
      "<div id='cmr-watch-list' class='muted'></div></div>",
      "<div style='margin-top:10px' class='muted'>High score ≠ favorable entry. Paper tracking only.</div>",
    ].join("");
    document.body.appendChild(el);

    el.querySelector("#cmr-research-close").addEventListener("click", function () {
      setResearchOpen(false);
    });
    el.querySelectorAll(".tabs button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        activeTab = btn.getAttribute("data-tab");
        try { localStorage.setItem(TAB_KEY, activeTab); } catch (_) {}
        syncTabs();
        panelsLoaded = false;
        loadActivePanel(true);
      });
    });
    el.querySelector("#cmr-watch-save").addEventListener("click", function () {
      const input = el.querySelector("#cmr-watch-input");
      const cur = loadWatch();
      const add = Strinh(input.value || "").toUpperCase().trim();
      if (add && cur.indexOf(add) < 0) cur.push(add);
      saveWatch(cur);
      input.value = "";
      renderWatch();
      panelsLoaded = false;
    });
    el.querySelector("#cmr-btc-filter").addEventListener("change", loadBtc);
    syncTabs();
    return el;
  }

  function syncTabs() {
    const el = ensureResearch();
    el.querySelectorAll(".tabs button").forEach(function (btn) {
      btn.setAttribute("aria-selected", btn.getAttribute("data-tab") === activeTab ? "true" : "false");
    });
    el.querySelectorAll(".panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "cmr-panel-" + activeTab);
    });
  }

  function renderWatch() {
    ensureResearch().querySelector("#cmr-watch-list").textContent = loadWatch().join(" · ") || "(empty)";
  }

  async function loadSetups() {
    const box = ensureResearch().querySelector("#cmr-setups");
    box.innerHTML = "<div class='muted'>Loading…</div>";
    try {
      const res = await origFetch(
        "/api/early-setups?limit=10&candles=1&timeframe=1h&prioritizeHoldings=1&symbols=" +
          watchlistQuery()
      );
      const json = await res.json();
      const freshness = json.data && json.data.freshness;
      let html = "";
      if (freshness && freshness.status !== "fresh") {
        html += "<div class='warn'>Gated: momentum data is " + freshness.status + "</div>";
      }
      const setups = (json.data && json.data.setups) || [];
      if (!setups.length) html += "<div class='muted'>No setups</div>";
      html += setups.slice(0, 10).map(function (s) {
        const br = s.btcRelative && s.btcRelative.d7;
        const brLine = br && br.available ? " · +" + br.excessReturnPp + "pp vs BTC" : "";
        const ohlcvNote = s.ohlcv && s.ohlcv.approximate ? " · CG approx OHLC" : "";
        const errNote = s.ohlcvError ? " · " + s.ohlcvError : "";
        return (
          "<div class='cmr-row'><span><strong>" + (s.symbol || "?") + "</strong> " +
          (s.state || "n/a") +
          "<div class='muted'>ready " + (s.setupReadiness != null ? s.setupReadiness : "—") +
          " · " + (s.dataConfidence || "") + brLine + ohlcvNote +
          "</div><div class='muted'>" + ((s.evidence && s.evidence[0]) || "") + errNote + "</div></span></div>"
        );
      }).join("");
      box.innerHTML = html;
    } catch (_) {
      box.innerHTML = "<div class='warn'>Early setups unavailable</div>";
    }
  }

  async function loadBtc() {
    const box = ensureResearch().querySelector("#cmr-btc-list");
    const filter = ensureResearch().querySelector("#cmr-btc-filter").value;
    box.innerHTML = "<div class='muted'>Loading…</div>";
    try {
      const q = filter ? "&filter=" + encodeURIComponent(filter) : "";
      const res = await origFetch("/api/momentum?prioritizeHoldings=1" + q);
      const json = await res.json();
      const rows = (json.data && json.data.rows) || [];
      const watch = new Set(loadWatch());
      const show = rows.filter(function (r) { return watch.has(String(r.symbol).toUpperCase()) || !filter; }).slice(0, 12);
      if (!show.length) {
        box.innerHTML = "<div class='muted'>No rows for filter</div>";
        return;
      }
      box.innerHTML = show.map(function (r) {
        const br = r.btcRelative || {};
        const d7 = br.d7 && br.d7.available ? br.d7.excessReturnPp + "pp / " + br.d7.coinBtcReturnPct + "%" : "N/A";
        const d30 = br.d30 && br.d30.available ? br.d30.excessReturnPp + "pp" : "N/A";
        const d90 = br.d90 && br.d90.available ? br.d90.excessReturnPct || br.d90.excessReturnPp + "pp" : "N/A";
        return (
          "<div class='cmr-row'><span><strong>" + r.symbol + "</strong>" +
          (r.onWatchlist ? " ★" : "") +
          "<div class='muted'>7d excess " + d7 + " · 30d " + d30 + " · 90d " + d90 + "</div></span></div>"
        );
      }).join("");
      const rot = json.data && json.data.rotation;
      if (rot) {
        box.innerHTML += "<div class='muted' style='margin-top:8px'>Rotation hypothesis: " + (rot.leadership || "—") +
          " · alts beating BTC 7d: " + (rot.altsBeatingBtc7d || 0) + " / " + (rot.eligibleSample || 0) +
          " <span class='warn'>(unvalidated)</span></div>";
      }
    } catch (_) {
      box.innerHTML = "<div class='warn'>BTC-relative unavailable</div>";
    }
  }

  async function loadTraction() {
    const box = ensureResearch().querySelector("#cmr-traction");
    box.innerHTML = "<div class='muted'>Loading setups then traction…</div>";
    try {
      const res = await origFetch(
        "/api/early-setups?limit=8&candles=1&timeframe=1h&prioritizeHoldings=1&symbols=" +
          watchlistQuery()
      );
      const json = await res.json();
      const candidates = ((json.data && json.data.setups) || []).filter(function (s) {
        return s.state === "Coiling" || s.state === "Igniting";
      }).slice(0, 3);
      if (!candidates.length) {
        box.innerHTML = "<div class='muted'>No Coiling/Igniting candidates in sample — traction check waits for those states.</div>";
        return;
      }
      const cards = [];
      for (let i = 0; i < candidates.length; i++) {
        const s = candidates[i];
        const qs = "/api/social?symbol=" + encodeURIComponent(s.symbol) +
          (s.name ? "&name=" + encodeURIComponent(s.name) : "") +
          (s.state ? "&state=" + encodeURIComponent(s.state) : "") +
          (s.setupReadiness != null ? "&readiness=" + encodeURIComponent(s.setupReadiness) : "");
        try {
          const sr = await origFetch(qs);
          const sj = await sr.json();
          const c = sj.data || {};
          cards.push(
            "<div class='cmr-row'><span><strong>" + s.symbol + "</strong> " + s.state +
            "<div class='" + (c.traction === "insufficient evidence" ? "muted" : "ok") + "'>traction: " + (c.traction || "—") + "</div>" +
            "<div class='muted'>risk: " + (c.entryRisk || "—") + "</div>" +
            ((c.conflicting && c.conflicting[0]) ? "<div class='warn'>" + c.conflicting[0] + "</div>" : "") +
            "</span></div>"
          );
        } catch (_) {
          cards.push("<div class='cmr-row'><span>" + s.symbol + "<div class='warn'>social unavailable</div></span></div>");
        }
      }
      box.innerHTML = cards.join("");
    } catch (_) {
      box.innerHTML = "<div class='warn'>Traction panel unavailable</div>";
    }
  }

  function patchMomentumPayload(payload) {
    if (!payload || !payload.data) return payload;
    const src = payload.data.sourceGeneratedAt || payload.data.freshness?.sourceGeneratedAt || payload.data.generatedAt;
    const freshness = compute(src, MAIN);
    payload.data.freshness = Object.assign({}, payload.data.freshness || {}, freshness);
    payload.data.sourceGeneratedAt = freshness.sourceGeneratedAt || payload.data.sourceGeneratedAt;
    if (payload.metadata) {
      payload.metadata.ageMinutes = freshness.ageMinutes;
      payload.metadata.fetchedAt = freshness.evaluatedAt;
      if (freshness.status !== "fresh") payload.metadata.status = freshness.status;
    }
    lastMain = payload;
    renderBanner();
    return payload;
  }

  function patchHfPayload(payload) {
    if (!payload || !payload.data) return payload;
    const src = payload.data.generatedAt || payload.data.freshness?.sourceGeneratedAt;
    const freshness = compute(src, HF);
    payload.data.freshness = Object.assign({}, payload.data.freshness || {}, freshness);
    lastHf = payload;
    renderBanner();
    return payload;
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const res = await origFetch(input, init);
    try {
      const url = typeof input === "string" ? input : input && input.url;
      if (!url || !res.ok) return res;
      if (url.includes("/api/momentum/cron")) return res;
      // Side-effect only: never rewrite Response bodies (avoids Content-Length
      // truncation that crashed the React app with undefined.toLowerCase).
      if (url.includes("/api/high-frequency")) {
        res.clone().json().then(function (data) { patchHfPayload(data); }).catch(function () {});
        return res;
      }
      if (url.includes("/api/momentum") && !url.includes("/api/momentum/")) {
        res.clone().json().then(function (data) { patchMomentumPayload(data); }).catch(function () {});
        return res;
      }
    } catch (_) {}
    return res;
  };

  function boot() {
    ensureBanner();
    ensureToggle();
    ensureResearch();
    renderWatch();
    renderBanner();
    syncTabs();
    // Default closed so the homepage stays usable; only restore open if user left it open.
    let preferOpen = false;
    try { preferOpen = localStorage.getItem(OPEN_KEY) === "1"; } catch (_) {}
    setResearchOpen(preferOpen);
    setInterval(function () {
      if (lastMain) patchMomentumPayload(lastMain);
      if (lastHf) patchHfPayload(lastHf);
      renderBanner();
    }, 15000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
