} catch (_) {}
  }

  function showBrowserFomoNotice(alert) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const clear = alert.risk && alert.risk.status === "clear" && !alert.risk.risky;
    try {
      new Notification((clear ? "FOMO CLEAR " : "FOMO ") + (alert.symbol || "alert"), {
        body: (alert.buyers || 0) + " trusted buyers · " +
          (clear ? "GoPlus clear · " : "") + "copying off",
        tag: alert.id || alert.tokenAddress,
      });
    } catch (_) {}
  }

  function paintFomoAlertBanner(alerts) {
    const el = ensureFomoAlertBanner();
    if (!alerts || !alerts.length) {
      el.dataset.show = "false";
      el.innerHTML = "";
      return;
    }
    const clearFirst = alerts.find(function (a) {
      return a.risk && a.risk.status === "clear" && !a.risk.risky;
    });
    const newest = clearFirst || alerts[0];
    const clear = newest.risk && newest.risk.status === "clear" && !newest.risk.risky;
    el.dataset.show = "true";
    el.innerHTML =
      (clear ? "FOMO CLEAR: " : "FOMO alert: ") +
      "<strong>" + esc(newest.symbol || "?") + "</strong> · " +
      (newest.buyers || 0) + " trusted" +
      "<small>Immediate cohort alert · copying off · not auto-trade · tap Research → Whales</small>";
  }

  async function pollFomoAlerts(opts) {
    const forcePass = opts && opts.forcePass;
    try {
      if (forcePass) {
        await origFetch("/api/fomo-alerts", { method: "POST" }).catch(function () {});
      }
      const res = await origFetch("/api/fomo-alerts");
      const json = await res.json();
      const alerts = (json.data && json.data.alerts) || [];
      const seen = loadSeenFomoIds();
      const fresh = [];
      alerts.forEach(function (a) {
        const id = a.id || a.tokenAddress;
        if (!id) return;
        if (!seen[id] && !lastFomoAlertIds[id]) fresh.push(a);
        lastFomoAlertIds[id] = true;
      });
      if (fresh.length) {
        fresh.forEach(function (a) {
          const id = a.id || a.tokenAddress;
          seen[id] = Date.now();
          showBrowserFomoNotice(a);
        });
        saveSeenFomoIds(seen);
        paintFomoAlertBanner(fresh);
        if (researchOpen && activeTab === "whales") {
          panelsLoaded = false;
          loadWhales();
        }
      } else if (alerts.length) {
        paintFomoAlertBanner(alerts.slice(0, 1));
      }
    } catch (_) {}
  }

  function startFomoAlertPoll() {
    if (fomoAlertTimer) return;
    pollFomoAlerts({ forcePass: true });
    fomoAlertTimer = setInterval(function () {
      if (document.hidden) return;
      pollFomoAlerts({ forcePass: true });
    }, FOMO_ALERT_POLL_MS);
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
      startResearchRefresh();
    } else {
      stopResearchRefresh();
    }
  }

  function stopResearchRefresh() {
    if (researchRefreshTimer) {
      clearInterval(researchRefreshTimer);
      researchRefreshTimer = null;
    }
  }

  function startResearchRefresh() {
    stopResearchRefresh();
    researchRefreshTimer = setInterval(function () {
      if (!researchOpen) return;
      if (document.hidden) return;
      panelsLoaded = false;
      loadActivePanel(true);
    }, RESEARCH_REFRESH_MS);
  }

  function loadActivePanel(force) {
    if (!researchOpen) return;
    if (!force && panelsLoaded) return;
    panelsLoaded = true;
    if (activeTab === "whales") loadWhales();
    else if (activeTab === "setups") loadSetups();
    else if (activeTab === "btc") loadBtc();
    else if (activeTab === "traction") loadTraction