/**
 * Client-side freshness truth layer.
 * Recalculates age from sourceGeneratedAt as time passes.
 * Does not treat high-frequency responses as making main rankings current.
 */
(function () {
  const MAIN = { freshMs: 45 * 60 * 1000, staleMs: 3 * 60 * 60 * 1000 };
  const HF = { freshMs: 60 * 1000, staleMs: 5 * 60 * 1000 };
  const FUTURE_SKEW = 5 * 60 * 1000;

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
    return payload;
  }

  function patchHfPayload(payload) {
    if (!payload || !payload.data) return payload;
    const src = payload.data.generatedAt || payload.data.freshness?.sourceGeneratedAt;
    const freshness = compute(src, HF);
    payload.data.freshness = Object.assign({}, payload.data.freshness || {}, freshness);
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
      if (url.includes("/api/momentum")) {
        const data = await res.clone().json();
        return new Response(JSON.stringify(patchMomentumPayload(data)), {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        });
      }
    } catch (_) {
      /* fall through */
    }
    return res;
  };

  // Live-age the visible freshness label while the page stays open
  setInterval(function () {
    document.querySelectorAll(".freshness").forEach(function (el) {
      const strong = el.querySelector("strong");
      if (!strong) return;
      const stamp = el.getAttribute("data-source-ts");
      if (!stamp) return;
      const f = compute(stamp, MAIN);
      strong.textContent = f.status + " · " + (f.ageHours != null ? f.ageHours : "—") + "h";
      el.className = "freshness freshness--" + f.status;
    });
  }, 30000);

  // Observe regime bar mounts and attach source timestamp for ticking
  const obs = new MutationObserver(function () {
    document.querySelectorAll(".freshness").forEach(function (el) {
      if (el.getAttribute("data-source-ts")) return;
      // Try to read from nearby stale banner text or leave for API-driven remounts
    });
  });
  try {
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
})();
