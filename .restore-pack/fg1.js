cmr-close{font:inherit;background:transparent;color:#c9d2e0;border:1px solid rgba(255,255,255,.14);border-radius:4px;padding:4px 8px;cursor:pointer}",
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
      "#cmr-fomo-alert-banner{position:sticky;top:44px;z-index:9998;padding:10px 16px;font:600 12px/1.4 'IBM Plex Mono',ui-monospace,monospace;background:#1a1408;color:#ffd27a;border-bottom:1px solid rgba(255,210,122,.25);display:none}",
      "#cmr-fomo-alert-banner[data-show=true]{display:block}",
      "#cmr-enable-alerts{position:fixed;right:16px;bottom:64px;z-index:10001;font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;background:#1c2a44;color:#fff;border:1px solid rgba(255,255,255,.28);border-radius:4px;padding:10px 12px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35)}",
      "#cmr-enable-alerts[data-on=true]{background:#143322;border-color:rgba(157,255,185,.35);color:#9dffb9}",
      "@media (max-width:640px){#cmr-research,#cmr-research-toggle{right:8px;left:8px;width:auto;bottom:8px}#cmr-research-toggle{left:auto}#cmr-enable-alerts{right:8px;bottom:56px}}",
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

  function ensureFomoAlertBanner() {
    ensureStyles();
    let el = document.getElementById("cmr-fomo-alert-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "cmr-fomo-alert-banner";
      el.setAttribute("role", "status");
      el.dataset.show = "false";
      const main = document.getElementById("cmr-freshness-banner");
      if (main && main.parentNode) main.parentNode.insertBefore(el, main.nextSibling);
      else document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }

  function loadSeenFomoIds() {
    try {
      const raw = localStorage.getItem(FOMO_SEEN_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveSeenFomoIds(map) {
    try { localStorage.setItem(FOMO_SEEN_KEY, 