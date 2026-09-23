();
    else if (activeTab === "holdings") renderWatch();
  }

  function watchlistQuery() {
    return loadWatch().map(function (s) { return encodeURIComponent(s); }).join(",");
  }

  function ensureResearch() {
    ensureStyles();
    let el = document.getElementById("cmr-research");
    if (el) return el;
    try { activeTab = localStorage.getItem(TAB_KEY) || "whales"; } catch (_) {}
    el = document.createElement("aside");
    el.id = "cmr-research";
    el.dataset.open = "false";
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("aria-label", "Research drawer");
    el.innerHTML = [
      "<div class='cmr-head'><h3>Research</h3>",
      "<button type='button' class='cmr-close' id='cmr-research-close' aria-label='Close research'>Close</button></div>",
      "<div class='tabs' role='tablist'>",
      "<button type='button' data-tab='whales'>Whales</button>",
      "<button type='button' data-tab='setups'>Early Setups</button>",
      "<button type='button' data-tab='btc'>BTC-relative</button>",
      "<button type='button' data-tab='traction'>Traction</button>",
      "<button type='button' data-tab='holdings'>Holdings</button>",
      "</div>",
      "<div id='cmr-panel-whales' class='panel'><div class='muted'>Product radar: trusted FOMO wallets + large DEX buys. Risky coins labeled. Copying is off.</div><div id='cmr-whales'></div></div>",
      "<div id='cmr-panel-setups' class='panel'><div class='muted'>Pre-breakout only — not the momentum leaderboard. Confirmed and Overextended coins are excluded. Compression ≠ bullish.</div><div id='cmr-setups'></div></div>",
      "<div id='cmr-panel-btc' class='panel'><div class='muted'>Filters use excess pp & coin/BTC % — 90d never extrapolated</div>",
      "<select id='cmr-btc-filter'><option value=''>Ranked universe</option>",
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
      const add = String(input.value || "").toUpperCase().trim();
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


  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtUsd(v)