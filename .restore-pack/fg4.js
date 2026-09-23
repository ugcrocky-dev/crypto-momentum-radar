 {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    if (n >= 1e6) return "$" + (Math.round(n / 1e5) / 10) + "M";
    if (n >= 1e3) return "$" + Math.round(n / 1e3) + "k";
    return "$" + Math.round(n);
  }

  function fmtPct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return (Math.round(n * 10) / 10) + "%";
  }

  function setupRowHtml(s) {
    const snap = s.snapshot || {};
    const br = s.btcRelative && s.btcRelative.d7;
    const brLine = br && br.available ? " · " + br.excessReturnPp + "pp vs BTC" : "";
    const ohlcvNote = s.ohlcv && s.ohlcv.approximate ? " · CG approx OHLC" : "";
    const move = "24h " + fmtPct(snap.change24h) + " · 7d " + fmtPct(snap.change7d) +
      " · vol " + fmtPct(snap.volumeChange24h);
    const evidence = (s.evidence || []).filter(function (line) {
      return line && line.indexOf("Momentum score") !== 0;
    }).slice(0, 2);
    return (
      "<div class='cmr-row'><span><strong>" + (s.symbol || "?") + "</strong> " +
      (s.state || "n/a") +
      (snap.risk && snap.risk.risky ? " <span class='warn'>Risky coin</span>" : "") +
      "<div class='muted'>ready " + (s.setupReadiness != null ? s.setupReadiness : "—") +
      " · " + (s.dataConfidence || "") + " · " + move + brLine + ohlcvNote +
      "</div>" +
      (snap.risk && snap.risk.risky && snap.risk.label
        ? "<div class='warn'>" + snap.risk.label + "</div>"
        : "") +
      evidence.map(function (line) { return "<div class='muted'>" + line + "</div>"; }).join("") +
      (s.trigger ? "<div class='muted'>trigger: " + s.trigger + "</div>" : "") +
      "</span></div>"
    );
  }

  function whaleRowHtml(a) {
    const risk = a.risk || {};
    const risky = risk.risky ? " <span class='warn'>Risky coin</span>" : "";
    const sizeNote = a.usdReliable ? "" : " · USD print exceeds pool reserves";
    const repeat = a.repeatInWindow
      ? "<div class='muted'>" + (a.repeatCount || 2) + " buys from this wallet in the scan. Not a profit track record.</div>"
      : "";
    return (
      "<div class='cmr-row'><span><strong>" + esc(a.symbol || a.walletShort || "?") + "</strong> " +
      esc(a.chainLabel || a.chain || "") + risky +
      "<div class='muted'>" + esc(a.walletShort || "") + " bought " + fmtUsd(a.usd) + sizeNote +
      (a.pool ? " · " + esc(a.pool) : "") +
      (a.at ? " · " + esc(String(a.at).replace("T", " ").replace("Z", "Z")) : "") +
      "</div>" +
      (risk.label ? "<div class='warn'>" + esc(risk.label) + "</div>" : "") +
      repeat +
      (a.txUrl ? "<div class='muted'><a href='" + esc(a.txUrl) + "' target='_blank' rel='noopener'>tx</a> · copying off</div>" : "") +
      "</span></div>"
    );
  }

  function trustedRowHtml(a) {
    const risk = a.risk || {};
    const risky = risk.risky ? " <span class='warn'>Risky coin</span>" : "";
    const who = (a.who || []).slice(0, 4).join(", ");
    const more = a.whoTotal > 4 ? " +" + (a.whoTotal - 4) : "";
    return (
      "<div class='cmr-row'><span><strong>" + esc(a.symbol || "?") + "</strong> " +
      esc(a.chainLabel || "Robinhood") +
      (a.kind === "fresh" ? " <span class='ok'>Fresh</span>" : "") +
      risky +
      "<div class='muted'>" + (a.buyers || 0) + " trusted buyers · score " +
      (a.avgScore != null ? Math.round(a.avgScore) : "—") +
      " · " + fmtUsd(a.usd) +
      (a.liquidityUsd != null ? " · liq " + fmtUsd(a.liquidityUsd) : "") +
      "</div>" +
      (who ? "<div class='muted'>" + esc(who) + esc(more) + "</div>" : "") +
      (risk.label ? "<div class='warn'>" + esc(risk.label) + "</div>" : "") +
      "<div class='muted'>copying off · via FOMO Radar</div>" +
      "</span></div>"
    );
  }

  async function loadWhales() {
    const box = ensureResearch().querySelector("#cmr-whales");
    box.innerHTML = "<div class='muted'>Loading both radar feeds…</div>";
    try {
      const alertRes = await origFetch("/api/fomo-alerts");
      const alertJson = await alertRes.json();
      const immediate = (alertJson.data && alertJson.data.alerts) || [];
      const notify = (alertJson.data && alertJson.data.notify) || {};

      const res = await origFetch("/api/radar-product");
      const json = await res.json();
      const trusted = (json.data && json.data.trustedWallets) || [];
      const large = (json.data && json.data.largeBuys) || [];
      const product = (json.data && json.data.product) || {};
      let html = "<div class='muted'>" + esc(product.note || "Both feeds. Copying off.") + "</div>";

      html += "<div style='margin-top:10px'>