vailable ? br.d90.excessReturnPct || br.d90.excessReturnPp + "pp" : "N/A";
        return (
          "<div class='cmr-row'><span><strong>" + r.symbol + "</strong>" +
          (watch.has(String(r.symbol).toUpperCase()) ? " ★" : "") +
          (r.risk && r.risk.risky ? " <span class='warn'>Risky coin</span>" : "") +
          "<div class='muted'>7d excess " + d7 + " · 30d " + d30 + " · 90d " + d90 + "</div>" +
          (r.risk && r.risk.risky && r.risk.label
            ? "<div class='warn'>" + r.risk.label + "</div>"
            : "") +
          "</span></div>"
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
        "/api/early-setups?limit=8&offset=0&candles=1&timeframe=1h&excludeHoldings=1&early=1&prioritizeHoldings=0&universe=0&symbols=" +
          watchlistQuery()
      );
      const json = await res.json();
      const candidates = ((json.data && json.data.setups) || []).filter(function (s) {
        return s.state === "Coiling" || s.state === "Igniting";
      }).slice(0, 3);
      if (!candidates.length) {
        box.innerHTML = "<div class='muted'>No Coiling/Igniting in the top universe slice — traction waits for those states.</div>";
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
    