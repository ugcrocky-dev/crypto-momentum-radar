/**
 * Derivatives crowding + leader→follower rotation context.
 * Rising OI ≠ buying. Rising funding may mean crowded longs.
 * Rotation is a testable hypothesis — not an assumption.
 */

import { sanitizeError } from "./freshness.js";

/**
 * Fetch Binance USDT-M premium index (funding) + open interest if available.
 * @param {string} symbol e.g. BTC
 */
export async function fetchBinanceDerivatives(symbol) {
  const pair = `${String(symbol).toUpperCase().replace(/USDT$/, "")}USDT`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const [premiumRes, oiRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(pair)}`, {
        signal: ctrl.signal,
      }),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(pair)}`, {
        signal: ctrl.signal,
      }),
    ]);

    let fundingRate = null;
    let markPrice = null;
    if (premiumRes.ok) {
      const p = await premiumRes.json();
      fundingRate = p.lastFundingRate != null ? Number(p.lastFundingRate) : null;
      markPrice = p.markPrice != null ? Number(p.markPrice) : null;
    }

    let openInterest = null;
    if (oiRes.ok) {
      const o = await oiRes.json();
      openInterest = o.openInterest != null ? Number(o.openInterest) : null;
    }

    if (fundingRate == null && openInterest == null) {
      throw new Error("derivatives_unavailable");
    }

    return {
      exchange: "binance-usdm",
      pair,
      fundingRate,
      openInterest,
      markPrice,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Crowding flag from funding magnitude. Does not imply direction of spot flow.
 */
export function assessCrowding({ fundingRate, openInterest } = {}) {
  const missing = [];
  if (fundingRate == null || !Number.isFinite(fundingRate)) missing.push("fundingRate");
  if (openInterest == null || !Number.isFinite(openInterest)) missing.push("openInterest");

  let crowding = "unknown";
  let note =
    "Missing derivatives inputs — crowding unknown; reduce confidence. Rising OI alone does not establish buying direction.";

  if (fundingRate != null && Number.isFinite(fundingRate)) {
    const abs = Math.abs(fundingRate);
    if (abs >= 0.001) {
      crowding = fundingRate > 0 ? "crowded_longs" : "crowded_shorts";
      note =
        fundingRate > 0
          ? "Elevated positive funding can indicate crowded longs rather than healthy accumulation."
          : "Elevated negative funding can indicate crowded shorts — not automatic bullish spot flow.";
    } else {
      crowding = "balanced";
      note = "Funding near flat — no strong crowding signal from funding alone.";
    }
  }

  return {
    crowding,
    fundingRate: fundingRate ?? null,
    openInterest: openInterest ?? null,
    missing,
    confidencePenalty: missing.length ? "reduced" : crowding === "unknown" ? "reduced" : "none",
    note,
  };
}

/**
 * Leader→follower rotation hypothesis from snapshot breadth + BTC/ETH leadership.
 * Does NOT claim lagging alts must catch up.
 */
export function assessRotationHypothesis(regime = {}, rows = []) {
  const btc7 = regime.btcChange7d;
  const breadth = regime.breadth7d;
  const eth = (rows || []).find((r) => String(r.symbol).toUpperCase() === "ETH");
  const eth7 = eth?.market?.change7d ?? null;

  let leadership = "unknown";
  if (btc7 != null && eth7 != null) {
    if (btc7 > 0 && eth7 > btc7) leadership = "eth_leads";
    else if (btc7 > eth7 && btc7 > 0) leadership = "btc_leads";
    else if (btc7 < 0 && eth7 < 0) leadership = "risk_off";
    else leadership = "mixed";
  }

  const improvingAlts = (rows || []).filter((r) => {
    const br = r.btcRelative?.d7;
    return br?.available && br.beatingBtc === true;
  }).length;

  return {
    hypothesis:
      "Test whether BTC/ETH leadership is followed by improving strength in individual altcoins. Lagging coins are not assumed to catch up.",
    leadership,
    btcChange7d: btc7 ?? null,
    ethChange7d: eth7 ?? null,
    breadth7d: breadth ?? null,
    altsBeatingBtc7d: improvingAlts,
    eligibleSample: Array.isArray(rows) ? rows.length : 0,
    status: "hypothesis_unvalidated",
    note: "Observational context only — not a signal that underperformers will mean-revert.",
  };
}

/**
 * Attach derivatives crowding to a shortlist of rows (rate-limit friendly).
 */
export async function enrichRowsDerivatives(rows, { limit = 8 } = {}) {
  const out = [];
  const errors = [];
  for (const row of (rows || []).slice(0, limit)) {
    try {
      const der = await fetchBinanceDerivatives(row.symbol);
      const crowding = assessCrowding(der);
      out.push({
        symbol: row.symbol,
        derivatives: { ...der, ...crowding },
      });
    } catch (err) {
      errors.push({ symbol: row.symbol, error: sanitizeError(err) });
      out.push({
        symbol: row.symbol,
        derivatives: assessCrowding({}),
      });
    }
  }
  return { derivatives: out, errors };
}
