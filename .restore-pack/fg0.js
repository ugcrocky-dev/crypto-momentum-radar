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
  const TAB_KEY = "cmr:research-tab:v2";
  const OPEN_KEY = "cmr:research-open:v2";

  let lastMain = null;
  let lastHf = null;
  let activeTab = "whales";
  let researchOpen = false;
  let panelsLoaded = false;
  let researchRefreshTimer = null;
  let fomoAlertTimer = null;
  let lastFomoAlertIds = {};
  const RESEARCH_REFRESH_MS = 2 * 60 * 1000;
  const FOMO_ALERT_POLL_MS = 30 * 1000;
  const FOMO_SEEN_KEY = "cmr:fomo-alert-seen-ids:v1";

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
      "#cmr-research .cmr-close{f