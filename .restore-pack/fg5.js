<strong>Immediate FOMO alerts</strong></div>";
      html += "<div class='muted'>Clear GoPlus coins alert now. Phone: open <a href='https://ntfy.sh/cmr-fomo-veen113' target='_blank' rel='noopener'>ntfy.sh/cmr-fomo-veen113</a> (or ntfy app) · or tap Enable alerts. Auto-trade is off." +
        (notify.any || notify.ntfy ? " Push armed." : "") +
        "</div>";
      if (!immediate.length) html += "<div class='muted'>No FOMO alerts yet — open this tab and wait for the 30s poller, or wait for cron.</div>";
      else html += immediate.slice(0, 8).map(trustedRowHtml).join("");

      html += "<div style='margin-top:12px'><strong>Trusted wallets</strong></div>";
      html += "<div class='muted'>FOMO Robinhood Radar — named traders, cohort score. Not a profit guarantee.</div>";
      if (!trusted.length) html += "<div class='muted'>No trusted-wallet signals right now.</div>";
      else html += trusted.map(trustedRowHtml).join("");

      html += "<div style='margin-top:12px'><strong>Large DEX buys</strong></div>";
      html += "<div class='muted'>GeckoTerminal — buys ≥ $10k on ETH / BSC / Base. No wallet PnL.</div>";
      if (!large.length) html += "<div class='muted'>No large buys in the scanned pools right now.</div>";
      else html += large.map(whaleRowHtml).join("");

      box.innerHTML = html;
    } catch (_) {
      box.innerHTML = "<div class='warn'>Radar product unavailable</div>";
    }
  }

  async function loadSetups() {
    const box = ensureResearch().querySelector("#cmr-setups");
    box.innerHTML = "<div class='muted'>Scanning pre-breakout coins…</div>";
    try {
      const res = await origFetch(
        "/api/early-setups?limit=8&offset=0&candles=1&timeframe=1h&excludeHoldings=1&early=1&prioritizeHoldings=0&universe=1&symbols=" +
          watchlistQuery()
      );
      const json = await res.json();
      const freshness = json.data && json.data.freshness;
      const meta = json.metadata || {};
      const setups = ((json.data && json.data.setups) || []).filter(function (s) {
        return s.state === "Coiling" || s.state === "Igniting";
      });
      const universe = (json.data && json.data.universe) || [];
      const scanned = new Set(setups.map(function (s) { return String(s.symbol || "").toUpperCase(); }));
      let html = "";
      if (freshness && freshness.status !== "fresh") {
        html += "<div class='warn'>Gated: momentum data is " + freshness.status + "</div>";
      }
      html += "<div class='muted'>Pre-breakout pool " + (meta.universeTotal != null ? meta.universeTotal : universe.length) +
        " (Building/Watch, not already extended). Candle setups " + setups.length + ".</div>";
      if (!setups.length) {
        html += "<div class='muted'>No Coiling/Igniting in the candle slice yet.</div>";
      }
      html += setups.map(setupRowHtml).join("");
      const rest = universe.filter(function (u) { return !scanned.has(String(u.symbol || "").toUpperCase()); });
      if (rest.length) {
        html += "<div class='muted' style='margin-top:8px'>Still coiling on the snapshot — not the leaderboard</div>";
        html += rest.map(function (u) {
          return "<div class='cmr-row'><span><strong>" + (u.symbol || "?") + "</strong> " +
            (u.momentumState || "") +
            "<div class='muted'>24h " + fmtPct(u.change24h) + " · 7d " + fmtPct(u.change7d) +
            " · vol " + fmtPct(u.volumeChange24h) + "</div></span></div>";
        }).join("");
      }
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
      const res = await origFetch("/api/momentum" + (filter ? "?filter=" + encodeURIComponent(filter) : ""));
      const json = await res.json();
      const rows = (json.data && json.data.rows) || [];
      const watch = new Set(loadWatch());
      const show = rows.slice(0, 40);
      if (!show.length) {
        box.innerHTML = "<div class='muted'>No rows for filter</div>";
        return;
      }
      box.innerHTML = show.map(function (r) {
        const br = r.btcRelative || {};
        const d7 = br.d7 && br.d7.available ? br.d7.excessReturnPp + "pp / " + br.d7.coinBtcReturnPct + "%" : "N/A";
        const d30 = br.d30 && br.d30.available ? br.d30.excessReturnPp + "pp" : "N/A";
        const d90 = br.d90 && br.d90.available ? br.d90.excessReturnPct || br.d90.excessReturnPp + "pp" : "N/A";
