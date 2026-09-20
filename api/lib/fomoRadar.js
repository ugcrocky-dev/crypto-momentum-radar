/**
 * FOMO Robinhood Radar public feed (fomoradar.app).
 * Trusted-wallet cohort signals on Robinhood Chain. Attribution required.
 * This module does not place trades and does not invent wallet track records.
 */

import { sanitizeError } from "./freshness.js";

export const FOMO_RADAR_BASE = "https://fomoradar.app";
export const ROBINHOOD_CHAIN_ID = "4663";

async function fetchJson(url, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "crypto-momentum-radar/radar-product",
      },
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoFromUnix(ts) {
  const n = finite(ts);
  if (n == null) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toISOString();
}

/**
 * Normalize a FOMO /api/signals or /api/fresh row into a product alert.
 */
export function normalizeFomoSignal(row, { kind = "signal" } = {}) {
  if (!row || typeof row !== "object") return null;
  const mint = String(row.mint || "").toLowerCase();
  if (!mint.startsWith("0x")) return null;
  const symbol = String(row.sym || row.symbol || "").toUpperCase() || null;
  const who = Array.isArray(row.who) ? row.who.map(String).filter(Boolean) : [];
  const buyers = finite(row.buyers) ?? who.length;
  const usd = finite(row.usd);
  const liq = finite(row.liq);
  const avgScore = finite(row.avg_score);
  const conviction = finite(row.conviction);
  const heat = finite(row.heat);
  return {
    id: `fomo:${kind}:${mint}`,
    source: "fomo_robinhood_radar",
    kind,
    chain: "robinhood",
    chainId: ROBINHOOD_CHAIN_ID,
    chainLabel: "Robinhood Chain",
    symbol,
    tokenAddress: mint,
    buyers,
    who: who.slice(0, 12),
    whoTotal: who.length,
    avgScore,
    conviction,
    heat,
    usd,
    liquidityUsd: liq,
    firstAt: isoFromUnix(row.first_ts),
    ageHours: finite(row.age_h),
    burst: row.burst ? true : false,
    trackRecord: avgScore != null
      ? {
          type: "cohort_score",
          avgScore,
          buyers,
          note: "FOMO Radar judgement score for named traders — not a guarantee.",
        }
      : null,
    copyAllowed: false,
    attribution: {
      name: "FOMO Robinhood Radar",
      url: FOMO_RADAR_BASE,
      license: "MIT / public API",
    },
  };
}

export async function collectFomoSignals({
  fetchImpl = fetch,
  limit = 12,
  timeoutMs = 12000,
} = {}) {
  const errors = [];
  let signalsPayload = null;
  let freshPayload = null;
  try {
    signalsPayload = await fetchJson(`${FOMO_RADAR_BASE}/api/signals`, fetchImpl, timeoutMs);
  } catch (err) {
    errors.push({ stage: "signals", error: sanitizeError(err) });
  }
  try {
    freshPayload = await fetchJson(`${FOMO_RADAR_BASE}/api/fresh`, fetchImpl, timeoutMs);
  } catch (err) {
    errors.push({ stage: "fresh", error: sanitizeError(err) });
  }

  const freshMints = new Set(
    (freshPayload?.tokens || [])
      .map((t) => String(t?.mint || "").toLowerCase())
      .filter(Boolean)
  );

  const out = [];
  const seen = new Set();
  for (const row of freshPayload?.tokens || []) {
    const alert = normalizeFomoSignal(row, { kind: "fresh" });
    if (!alert || seen.has(alert.tokenAddress)) continue;
    seen.add(alert.tokenAddress);
    out.push(alert);
  }
  for (const row of signalsPayload?.signals || []) {
    const mint = String(row?.mint || "").toLowerCase();
    if (!mint || seen.has(mint)) continue;
    const kind = freshMints.has(mint) ? "fresh" : "signal";
    const alert = normalizeFomoSignal(row, { kind });
    if (!alert) continue;
    seen.add(mint);
    out.push(alert);
  }

  out.sort((a, b) => {
    const ah = a.kind === "fresh" ? 0 : 1;
    const bh = b.kind === "fresh" ? 0 : 1;
    if (ah !== bh) return ah - bh;
    return (b.conviction || 0) - (a.conviction || 0);
  });

  return {
    alerts: out.slice(0, limit),
    errors,
    provider: "fomoradar.app",
    hours: signalsPayload?.hours ?? null,
  };
}
