/**
 * Client-side freshness truth layer + research chrome.
 * Recalculates age from sourceGeneratedAt as time passes.
 * Does not treat high-frequency responses as making main rankings current.
 * Preserves existing design; injects a slim banner + research drawer only.
 */
(function () {
  const MAIN = { freshMs: 45 * 60 * 1000, staleMs: 3 * 60 * 60 * 1000 };
  const HF = { freshMs: 60 * 1000, staleMs: 5 * 60 * 1000 };
  const FUTURE_SKEW = 5 * 60 * 1000;
  const WATCH_KEY = "cmr:my-holdings:v1";
  const DEFAULT_WATCH = ["XRP", "AERO", "UNI", "DOGE", "HBAR", "ARB", "SOL", "ETH"];

  let lastMain = null;
  let lastHf = null;

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
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map(function (s) { return String(s).toUpperCase(); });
      }
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
      "#cmr-research{position:fixed;right:12px;bottom:12px;z-index:9998;width:min(420px,calc(100vw - 24px));max-height:min(70vh,560px);overflow:auto;background:rgba(6,9,15,.94);color:#d7dde8;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:12px 14px;font:12px/1.45 'IBM Plex Mono',ui-monospace,monospace;box-shadow:0 12px 40px rgba(0,0,0,.45)}",
      "#cmr-research h3{margin:0 0 8px;font-size:13px;font-weight:600;color:#fff}",
      "#cmr-research .cmr-row{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid rgba(255,255,255,.06)}",
      "#cmr-research button,#cmr-research input{font:inherit;background:#121826;color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:4px;padding:6px 8px}",
      "#cmr-research .muted{opacity:.7}",
      "#cmr-research .warn{color:#ffd27a}",
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
    const actionable = f.actionable ? "actionable research context" : "NOT current actionable signals — historical reference only";
    const refresh = lastMain.refresh;
    const refreshLine = refresh
      ? "Last attempt " + (refresh.lastAttemptAt || "—") + " · last success " + (refresh.lastSuccessAt || "—") + (refresh.lastError ? " · error: " + refresh.lastError : "")
      : "Refresh status unavailable";
    const hfLine = hf
      ? "HF scan: " + hf.status + " · " + (hf.ageSeconds != null ? hf.ageSeconds + "s" : "—") + " (separate)"
      : "HF scan: —";
    el.innerHTML =
      "Momentum: <strong>" + f.status.toUpperCase() + "</strong> · age " +
      (f.ageHours != null ? f.ageHours + "h" : "—") +
      " · source " + (f.sourceGeneratedAt || "—") +
      "<small>" + actionable + " · " + refreshLine + " · " + hfLine + "</small>";
  }

  function ensureResearch() {
    ensureStyles();
    let el = document.getElementById("cmr-research");
    if (el) return el;
    el = document.createElement("aside");
    el.id = "cmr-research";
    el.innerHTML = [
      "<h3>Research drawer</h3>",
      "<div class='muted'>My holdings (no size/PnL inferred)</div>",
      "<div style='display:flex;gap:6px;margin:8px 0'>",
      "<input id='cmr-watch-input' style='flex:1' placeholder='Add symbol' />",
      "<button type='button' id='cmr-watch-save'>Save</button>",
      "</div>",
      "<div id='cmr-watch-list' class='muted'></div>",
      "<div style='margin-top:12px' class='muted'>Early setups (hypothesis)</div>",
      "<div id='cmr-setups'></div>",
      "<div style='margin-top:10px' class='muted'>High score ≠ favorable entry. Paper tracking only.</div>",
    ].join("");
    document.body.appendChild(el);
    el.querySelector("#cmr-watch-save").addEventListener("click", function () {
      const input = el.querySelector("#cmr-watch-input");
      const cur = loadWatch();
      const add = String(input.value || "").toUpperCase().trim();
      if (add && cur.indexOf(add) < 0) cur.push(add);
      saveWatch(cur);
      input.value = "";
      renderWatch();
    });
    return el;
  }

  function renderWatch() {
    const el = ensureResearch();
    const list = loadWatch();
    el.querySelector("#cmr-watch-list").textContent = list.join(" · ") || "(empty)";
  }

  async function loadSetups() {
    const box = ensureResearch().querySelector("#cmr-setups");
    box.innerHTML = "<div class='muted'>Loading…</div>";
    try {
      const res = await origFetch("/api/early-setups?limit=8&candles=1&timeframe=1h");
      const json = await res.json();
      const freshness = json.data && json.data.freshness;
      if (freshness && freshness.status !== "fresh") {
        box.innerHTML = "<div class='warn'>Setups gated: momentum data is " + freshness.status + "</div>";
      }
      const setups = (json.data && json.data.setups) || [];
      if (!setups.length) {
        box.innerHTML += "<div class='muted'>No setups returned</div>";
        return;
      }
      box.innerHTML = setups.slice(0, 8).map(function (s) {
        const br = s.btcRelative && s.btcRelative.d7;
        const brLine = br && br.available
          ? " · excess " + br.excessReturnPp + "pp / coin÷BTC " + br.coinBtcReturnPct + "%"
          : "";
        return (
          "<div class='cmr-row'><span><strong>" + (s.symbol || "?") + "</strong> " +
          (s.state || "n/a") +
          "<div class='muted'>" + (s.dataConfidence || "") + brLine + "</div></span>" +
          "<span>" + (s.setupReadiness != null ? s.setupReadiness : "—") + "</span></div>"
        );
      }).join("");
    } catch (err) {
      box.innerHTML = "<div class='warn'>Early setups unavailable</div>";
    }
  }

  function patchMomentumPayload(payload) {
    if (!payload || !payload.data) return payload;
    const src =
      payload.data.sourceGeneratedAt ||
      payload.data.freshness?.sourceGeneratedAt ||
      payload.data.generatedAt;
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
      if (url.includes("/api/high-frequency")) {
        const data = await res.clone().json();
        return new Response(JSON.stringify(patchHfPayload(data)), {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        });
      }
      if (url.includes("/api/momentum") && !url.includes("/api/momentum/")) {
        const data = await res.clone().json();
        return new Response(JSON.stringify(patchMomentumPayload(data)), {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        });
      }
    } catch (_) {}
    return res;
  };

  function boot() {
    ensureBanner();
    ensureResearch();
    renderWatch();
    renderBanner();
    loadSetups();
    setInterval(function () {
      if (lastMain) patchMomentumPayload(lastMain);
      if (lastHf) patchHfPayload(lastHf);
      renderBanner();
    }, 15000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
