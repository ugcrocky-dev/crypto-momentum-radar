/**
 * Early setup detector (hypothesis weights — not proven optimal).
 *
 * States: Coiling | Igniting | Confirmed | Failed | Expired
 * Compression alone is direction-neutral.
 *
 * Uses closed-bar style inputs when OHLCV is provided. When only momentum
 * snapshot fields exist, marks dataConfidence accordingly and avoids
 * fabricating ATR/BB from aggregate volume alone.
 */

import { computeFreshness, MAIN_CADENCE } from "./freshness.js";

export const EARLY_SETUP_THRESHOLDS = Object.freeze({
  /** BB width percentile ≤ this → compressed */
  compressionPercentileMax: 20,
  /** ATR/price below this reinforces coil */
  atrNormMax: 0.035,
  /** Volume vs 20-bar avg for dry-up */
  volumeDryUpMax: 0.7,
  /** Volume vs 20-bar avg for expansion */
  volumeExpansionMin: 1.5,
  /** Breakout: close above resistance by this fraction */
  breakoutBuffer: 0.002,
  /** Setup expires after this many ms without progress */
  expireMs: 14 * 24 * 60 * 60 * 1000,
  lookbackBars: 20,
});

/** Hypothesis weights for setupReadiness (0–100). Not proven optimal. */
export const SETUP_WEIGHTS = Object.freeze({
  compression: 0.25,
  volumeStructure: 0.2,
  higherLows: 0.15,
  distanceToResistance: 0.15,
  btcRelativeShort: 0.15,
  notOverextended: 0.1,
});

/**
 * @param {number[]} values
 * @param {number} p 0-100
 */
export function percentileRank(values, value) {
  const xs = (values || []).filter((v) => Number.isFinite(v));
  if (!xs.length || !Number.isFinite(value)) return null;
  const below = xs.filter((v) => v <= value).length;
  return Math.round((100 * below) / xs.length * 10) / 10;
}

export function sma(values, n) {
  const xs = (values || []).filter((v) => Number.isFinite(v));
  if (xs.length < n) return null;
  const slice = xs.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

export function stdev(values, n) {
  const xs = (values || []).filter((v) => Number.isFinite(v));
  if (xs.length < n) return null;
  const slice = xs.slice(-n);
  const mean = slice.reduce((a, b) => a + b, 0) / n;
  const v = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return Math.sqrt(v);
}

export function atrNormalized(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const high = Number(c.high);
    const low = Number(c.low);
    const prevClose = Number(p.close);
    if (![high, low, prevClose].every(Number.isFinite)) continue;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trs.length < period) return null;
  const atr = sma(trs, period);
  const lastClose = Number(candles[candles.length - 1].close);
  if (!atr || !lastClose) return null;
  return atr / lastClose;
}

export function bollingerWidth(candles, period = 20) {
  if (!Array.isArray(candles) || candles.length < period) return null;
  const closes = candles.map((c) => Number(c.close)).filter(Number.isFinite);
  const mid = sma(closes, period);
  const sd = stdev(closes, period);
  if (mid == null || sd == null || mid === 0) return null;
  return (2 * sd) / mid;
}

export function compressionPercentile(candles, period = 20, history = 60) {
  if (!Array.isArray(candles) || candles.length < period + 5) return null;
  const widths = [];
  for (let i = period; i <= candles.length; i++) {
    const w = bollingerWidth(candles.slice(0, i), period);
    if (w != null) widths.push(w);
  }
  if (widths.length < 5) return null;
  const recent = widths.slice(-history);
  const current = recent[recent.length - 1];
  return percentileRank(recent, current);
}

export function higherLows(candles, swings = 3) {
  if (!Array.isArray(candles) || candles.length < 10) return { ok: false, reason: "insufficient_bars" };
  const lows = candles.map((c) => Number(c.low)).filter(Number.isFinite);
  // Simple pivot lows
  const pivots = [];
  for (let i = 2; i < lows.length - 2; i++) {
    if (lows[i] <= lows[i - 1] && lows[i] <= lows[i - 2] && lows[i] <= lows[i + 1] && lows[i] <= lows[i + 2]) {
      pivots.push(lows[i]);
    }
  }
  if (pivots.length < swings) return { ok: false, reason: "insufficient_pivots", pivots };
  const last = pivots.slice(-swings);
  let rising = true;
  for (let i = 1; i < last.length; i++) {
    if (last[i] <= last[i - 1]) rising = false;
  }
  return { ok: rising, pivots: last };
}

/**
 * Resistance from prior bars excluding the signal (last) bar.
 */
export function priorResistance(candles, lookback = 20) {
  if (!Array.isArray(candles) || candles.length < 3) return null;
  const prior = candles.slice(Math.max(0, candles.length - 1 - lookback), -1);
  const highs = prior.map((c) => Number(c.high)).filter(Number.isFinite);
  if (!highs.length) return null;
  return Math.max(...highs);
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Score setup readiness 0–100 (hypothesis). Separate from directional confidence.
 */
export function scoreSetupReadiness(features) {
  const w = SETUP_WEIGHTS;
  let score = 0;
  let weightSum = 0;

  const add = (key, unit) => {
    weightSum += w[key];
    score += w[key] * clamp01(unit);
  };

  if (features.compressionPercentile != null) {
    add("compression", 1 - features.compressionPercentile / 100);
  }
  if (features.volumeDryUp === true && features.volumeExpansion === true) {
    add("volumeStructure", 1);
  } else if (features.volumeDryUp === true || features.volumeExpansion === true) {
    add("volumeStructure", 0.5);
  } else if (features.volumeDryUp != null) {
    add("volumeStructure", 0.2);
  }
  if (features.higherLows === true) add("higherLows", 1);
  else if (features.higherLows === false) add("higherLows", 0.1);

  if (features.distanceToResistancePct != null) {
    // closer to resistance (within 8%) scores higher for ignition proximity; not bullish alone
    const d = Math.abs(features.distanceToResistancePct);
    add("distanceToResistance", d < 8 ? 1 - d / 8 : 0.2);
  }
  if (features.btcRelativeShortExcessPp != null) {
    add("btcRelativeShort", features.btcRelativeShortExcessPp > 0 ? 0.8 : 0.3);
  }
  if (features.overextended === false) add("notOverextended", 1);
  else if (features.overextended === true) add("notOverextended", 0.1);

  if (weightSum === 0) return null;
  return Math.round((100 * score) / weightSum);
}

/**
 * Derive state from features. Compression ≠ bullish.
 */
export function deriveSetupState(features, { nowMs = Date.now(), firstDetectedAt = null } = {}) {
  if (features.dataStale) return "Expired";
  if (firstDetectedAt) {
    const age = nowMs - Date.parse(firstDetectedAt);
    if (Number.isFinite(age) && age > EARLY_SETUP_THRESHOLDS.expireMs) return "Expired";
  }
  if (features.invalidated) return "Failed";

  const compressed =
    (features.compressionPercentile != null &&
      features.compressionPercentile <= EARLY_SETUP_THRESHOLDS.compressionPercentileMax) ||
    (features.atrNorm != null && features.atrNorm <= EARLY_SETUP_THRESHOLDS.atrNormMax);

  const brokeOut =
    features.closeAboveResistance === true && features.volumeExpansion === true;

  if (brokeOut && features.breakoutPersists === true) return "Confirmed";
  if (brokeOut) return "Igniting";
  if (compressed) return "Coiling";
  return null;
}

/**
 * Build an early-setup candidate from candles + optional momentum row context.
 * @param {object} opts
 */
export function buildEarlySetup({
  symbol,
  name = null,
  id = null,
  timeframe = "1h",
  candles = [],
  momentumRow = null,
  btcShortExcessPp = null,
  nowMs = Date.now(),
  firstDetectedAt = null,
  provisional = false,
} = {}) {
  const closed = Array.isArray(candles) ? candles.filter((c) => c && c.close != null) : [];
  const dataConfidence =
    closed.length >= 40 ? "High" : closed.length >= 20 ? "Medium" : closed.length >= 10 ? "Low" : "Insufficient";

  if (closed.length < 10) {
    return {
      setupId: `${(id || symbol || "unknown").toString().toLowerCase()}:${timeframe}`,
      symbol,
      name,
      timeframe,
      state: null,
      setupReadiness: null,
      directionalConfidence: "n/a",
      dataConfidence,
      evidence: ["Insufficient closed candles for early-setup analysis."],
      trigger: null,
      invalidation: null,
      firstDetectedAt: firstDetectedAt || null,
      provisional,
      features: { insufficientHistory: true },
      disclaimer: "Hypothesis detector — not a trade signal.",
    };
  }

  const atrNorm = atrNormalized(closed);
  const bbWidth = bollingerWidth(closed);
  const compPct = compressionPercentile(closed);
  const volumes = closed.map((c) => Number(c.volume)).filter(Number.isFinite);
  const volSma = sma(volumes, 20);
  const lastVol = volumes[volumes.length - 1];
  const volumeDryUp = volSma != null && lastVol != null ? lastVol / volSma <= EARLY_SETUP_THRESHOLDS.volumeDryUpMax : null;
  const volumeExpansion =
    volSma != null && lastVol != null ? lastVol / volSma >= EARLY_SETUP_THRESHOLDS.volumeExpansionMin : null;
  const hl = higherLows(closed);
  const resistance = priorResistance(closed, EARLY_SETUP_THRESHOLDS.lookbackBars);
  const last = closed[closed.length - 1];
  const close = Number(last.close);
  const closeAboveResistance =
    resistance != null && Number.isFinite(close)
      ? close > resistance * (1 + EARLY_SETUP_THRESHOLDS.breakoutBuffer)
      : null;
  const distanceToResistancePct =
    resistance != null && Number.isFinite(close) && resistance !== 0
      ? Math.round(((close - resistance) / resistance) * 10000) / 100
      : null;

  const closes = closed.map((c) => Number(c.close)).filter(Number.isFinite);
  const ma20 = sma(closes, 20);
  const overextended =
    ma20 != null && Number.isFinite(close) ? Math.abs(close - ma20) / ma20 > 0.12 : null;

  // Persistence: require prior bar also above resistance for Confirmed (closed candles only)
  let breakoutPersists = false;
  if (closed.length >= 2 && resistance != null) {
    const prev = Number(closed[closed.length - 2].close);
    breakoutPersists =
      closeAboveResistance === true &&
      Number.isFinite(prev) &&
      prev > resistance * (1 + EARLY_SETUP_THRESHOLDS.breakoutBuffer);
  }

  const features = {
    atrNorm,
    bbWidth,
    compressionPercentile: compPct,
    volumeDryUp,
    volumeExpansion,
    higherLows: hl.ok,
    resistance,
    closeAboveResistance,
    distanceToResistancePct,
    btcRelativeShortExcessPp: btcShortExcessPp,
    overextended,
    breakoutPersists,
    invalidated: false,
    dataStale: false,
  };

  const state = deriveSetupState(features, { nowMs, firstDetectedAt });
  const setupReadiness = scoreSetupReadiness(features);

  const evidence = [];
  if (compPct != null) {
    evidence.push(
      `BB-width compression percentile ${compPct} (≤${EARLY_SETUP_THRESHOLDS.compressionPercentileMax} = compressed; direction-neutral).`
    );
  }
  if (atrNorm != null) evidence.push(`ATR/price ${Math.round(atrNorm * 10000) / 10000}.`);
  if (volumeDryUp) evidence.push("Volume dry-up vs 20-bar average.");
  if (volumeExpansion) evidence.push("Volume expansion vs 20-bar average.");
  if (hl.ok) evidence.push("Higher lows detected on closed pivots.");
  if (resistance != null) evidence.push(`Prior resistance (excl. signal bar): ${resistance}.`);
  if (closeAboveResistance) evidence.push("Close above prior resistance with buffer.");
  if (btcShortExcessPp != null) {
    evidence.push(`Short-term excess vs BTC: ${btcShortExcessPp} pp.`);
  }
  if (momentumRow?.score != null) {
    evidence.push(
      `Momentum score ${momentumRow.score} is context only — high momentum ≠ favorable entry.`
    );
  }

  return {
    setupId: `${(id || symbol || "unknown").toString().toLowerCase()}:${timeframe}`,
    symbol,
    name,
    timeframe,
    state,
    setupReadiness,
    directionalConfidence: "n/a — compression is direction-neutral until Igniting/Confirmed",
    dataConfidence,
    evidence,
    trigger:
      resistance != null
        ? `Closed break above ${resistance} with volume expansion (≥${EARLY_SETUP_THRESHOLDS.volumeExpansionMin}× SMA20).`
        : "Insufficient resistance reference.",
    invalidation:
      "Close back below prior coil midpoint / failed higher-low; or data goes stale/expired.",
    firstDetectedAt: firstDetectedAt || new Date(nowMs).toISOString(),
    provisional: Boolean(provisional),
    features,
    thresholds: EARLY_SETUP_THRESHOLDS,
    weights: SETUP_WEIGHTS,
    disclaimer:
      "Early-setup weights are hypotheses for research/paper tracking — not proven optimal and not trade advice.",
  };
}

/**
 * Snapshot-only heuristic when candles are unavailable.
 * Uses momentum fields without inventing order-flow.
 */
export function buildEarlySetupFromMomentumRow(row, { regime = {}, nowMs = Date.now(), freshness = null } = {}) {
  const market = row?.market || {};
  const volExp = market.volumeChange24h;
  const change7d = market.change7d;
  const btc7 = regime.btcChange7d;
  const excess =
    change7d != null && btc7 != null ? Math.round((change7d - btc7) * 1000) / 1000 : null;

  const stale =
    freshness &&
    (freshness.status === "expired" || freshness.status === "unknown" || freshness.actionable === false);

  // Without candles we cannot honestly claim Coiling/Igniting from ATR/BB.
  return {
    setupId: `${String(row.symbol || row.id || "unknown").toLowerCase()}:snapshot`,
    symbol: row.symbol,
    name: row.name,
    timeframe: "snapshot-proxy",
    state: stale ? "Expired" : null,
    setupReadiness: null,
    directionalConfidence: "n/a",
    dataConfidence: "Insufficient",
    evidence: [
      "OHLCV candles unavailable for this asset/timeframe — ATR/BB/compression not computed.",
      "Snapshot volumeChange24h and returns are shown as context only (not order flow).",
      volExp != null ? `Reported 24h volume change: ${volExp}%.` : "Volume change unavailable.",
      excess != null ? `7d excess vs BTC (pp): ${excess}.` : "7d BTC-relative unavailable.",
      "High momentum score does not imply a favorable early entry.",
    ],
    trigger: "Requires closed-candle resistance break with volume confirmation.",
    invalidation: "N/A until a candle-based setup is detected.",
    firstDetectedAt: null,
    provisional: true,
    features: {
      insufficientHistory: true,
      volumeChange24h: volExp ?? null,
      excessReturn7dPp: excess,
      dataStale: Boolean(stale),
    },
    momentumScore: row.score ?? null,
    momentumState: row.state ?? null,
    disclaimer:
      "Proxy only — not an early setup. Fetch OHLCV to evaluate Coiling/Igniting/Confirmed.",
  };
}

/**
 * Snapshot screen for "about to move" vs the momentum leaderboard.
 * Confirmed / Overextended / large 24h-7d moves / violent volume are already extended.
 * Building and Watch with modest moves are the pre-breakout pool. Not a trade signal.
 */
export function alreadyExtendedSnapshot(row) {
  const state = String(row?.state || "");
  if (state === "Confirmed momentum" || state === "Overextended") return true;
  const market = row?.market || {};
  const change7d = Number(market.change7d);
  const change24h = Number(market.change24h);
  const volumeChange24h = Number(market.volumeChange24h);
  if (Number.isFinite(change7d) && change7d >= 25) return true;
  if (Number.isFinite(change24h) && change24h >= 18) return true;
  if (Number.isFinite(volumeChange24h) && volumeChange24h >= 250) return true;
  return false;
}

export function selectPreBreakoutRows(rows) {
  const pool = (rows || []).filter((row) => {
    const state = String(row?.state || "");
    if (state !== "Building" && state !== "Watch") return false;
    return !alreadyExtendedSnapshot(row);
  });
  pool.sort((a, b) => {
    const rank = (row) => (String(row?.state) === "Building" ? 0 : 1);
    const vol = (row) => Math.abs(Number(row?.market?.volumeChange24h) || 0);
    const day = (row) => Math.abs(Number(row?.market?.change24h) || 0);
    const ar = rank(a);
    const br = rank(b);
    if (ar !== br) return ar - br;
    if (vol(a) !== vol(b)) return vol(a) - vol(b);
    return day(a) - day(b);
  });
  return pool;
}

export function attachFreshnessGate(setup, sourceGeneratedAt, nowMs = Date.now()) {
  const freshness = computeFreshness({
    sourceGeneratedAt,
    nowMs,
    cadence: MAIN_CADENCE,
  });
  if (freshness.status !== "fresh") {
    return {
      ...setup,
      state: setup.state && setup.state !== "Failed" ? "Expired" : setup.state,
      dataConfidence: "Low",
      actionable: false,
      freshness,
      evidence: [
        ...(setup.evidence || []),
        `Underlying data freshness is ${freshness.status} — not an actionable signal.`,
      ],
    };
  }
  return { ...setup, freshness, actionable: setup.state === "Igniting" || setup.state === "Confirmed" };
}
