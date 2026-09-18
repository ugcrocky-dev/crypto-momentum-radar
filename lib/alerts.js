/**
 * Setup alert persistence + paper tracking (research only).
 * External notifications stay disabled until explicitly enabled.
 */

import { getJson, setJson, redisConfigured } from "./upstashRedis.js";
import { sanitizeError } from "./freshness.js";

export const ALERTS_KEY = process.env.MOMENTUM_ALERTS_KEY || "momentum:setup-alerts:v1";
export const PAPER_KEY = process.env.MOMENTUM_PAPER_KEY || "momentum:paper-trades:v1";

export const DEFAULT_FEES = Object.freeze({
  feeBps: 10, // 0.10%
  slippageBps: 5, // 0.05%
  note: "Documented defaults for paper simulation — not live execution.",
});

export function stableSetupId({ symbol, timeframe, state, resistance }) {
  const r = resistance != null ? Number(resistance).toFixed(8) : "na";
  return `${String(symbol).toUpperCase()}:${timeframe}:${state || "none"}:${r}`;
}

/**
 * Merge incoming setups into persisted alerts without resetting entry prices.
 */
export function mergeAlerts(existing = [], incoming = [], { nowMs = Date.now(), cooldownMs = 6 * 60 * 60 * 1000 } = {}) {
  const byId = new Map((existing || []).map((a) => [a.setupId, a]));
  const out = [];

  for (const setup of incoming || []) {
    if (!setup?.setupId || !setup.state) continue;
    if (!["Coiling", "Igniting", "Confirmed", "Failed", "Expired"].includes(setup.state)) continue;

    const prev = byId.get(setup.setupId);
    if (!prev) {
      out.push({
        setupId: setup.setupId,
        symbol: setup.symbol,
        timeframe: setup.timeframe,
        state: setup.state,
        firstDetectedAt: setup.firstDetectedAt || new Date(nowMs).toISOString(),
        detectionPrice: setup.features?.resistance ?? null,
        triggerPrice: setup.state === "Igniting" || setup.state === "Confirmed" ? setup.features?.resistance ?? null : null,
        invalidation: setup.invalidation || null,
        transitions: [
          {
            at: new Date(nowMs).toISOString(),
            from: null,
            to: setup.state,
          },
        ],
        lastAlertAt: new Date(nowMs).toISOString(),
        provisional: Boolean(setup.provisional),
      });
      continue;
    }

    const next = { ...prev };
    if (prev.state !== setup.state) {
      const lastAt = prev.lastAlertAt ? Date.parse(prev.lastAlertAt) : 0;
      const cooled = !Number.isFinite(lastAt) || nowMs - lastAt >= cooldownMs || setup.state === "Failed";
      next.transitions = [
        ...(prev.transitions || []),
        { at: new Date(nowMs).toISOString(), from: prev.state, to: setup.state },
      ];
      next.state = setup.state;
      // Never reset original detection/trigger prices
      if ((setup.state === "Igniting" || setup.state === "Confirmed") && next.triggerPrice == null) {
        next.triggerPrice = setup.features?.resistance ?? null;
      }
      if (cooled) next.lastAlertAt = new Date(nowMs).toISOString();
    }
    next.provisional = Boolean(setup.provisional);
    out.push(next);
    byId.delete(setup.setupId);
  }

  // Keep prior alerts that did not appear this scan (do not erase failed history)
  for (const leftover of byId.values()) out.push(leftover);
  return out;
}

export function simulatePaperEntry({
  signalPrice,
  side = "long",
  fees = DEFAULT_FEES,
  nowMs = Date.now(),
} = {}) {
  if (signalPrice == null || !Number.isFinite(Number(signalPrice)) || Number(signalPrice) <= 0) {
    return { ok: false, reason: "invalid_signal_price" };
  }
  const px = Number(signalPrice);
  const fee = fees.feeBps / 10000;
  const slip = fees.slippageBps / 10000;
  const entry =
    side === "long" ? px * (1 + slip) * (1 + fee) : px * (1 - slip) * (1 - fee);
  return {
    ok: true,
    side,
    signalPrice: px,
    entryPrice: Math.round(entry * 1e8) / 1e8,
    fees,
    enteredAt: new Date(nowMs).toISOString(),
    note: "Paper entry after signal at executable price with documented fees/slippage. Not live trading.",
  };
}

/**
 * If stop and target both hit in one candle, report ambiguity (conservative: assume stop first).
 */
export function resolveStopTargetHit(candle, { stop, target, side = "long" } = {}) {
  if (!candle) return { hit: null, ambiguous: false };
  const high = Number(candle.high);
  const low = Number(candle.low);
  if (![high, low, stop, target].every(Number.isFinite)) {
    return { hit: null, ambiguous: false, reason: "insufficient_ohlc" };
  }
  let stopHit = false;
  let targetHit = false;
  if (side === "long") {
    stopHit = low <= stop;
    targetHit = high >= target;
  } else {
    stopHit = high >= stop;
    targetHit = low <= target;
  }
  if (stopHit && targetHit) {
    return {
      hit: "stop",
      ambiguous: true,
      assumption: "conservative_stop_first",
      note: "Both stop and target within same candle; finer data unavailable — counted as stop.",
    };
  }
  if (stopHit) return { hit: "stop", ambiguous: false };
  if (targetHit) return { hit: "target", ambiguous: false };
  return { hit: null, ambiguous: false };
}

export async function loadAlerts() {
  if (!redisConfigured()) return [];
  try {
    const raw = await getJson(ALERTS_KEY);
    return Array.isArray(raw) ? raw : Array.isArray(raw?.alerts) ? raw.alerts : [];
  } catch (err) {
    return { error: sanitizeError(err), alerts: [] };
  }
}

export async function saveAlerts(alerts) {
  if (!redisConfigured()) return { ok: false, reason: "redis_not_configured" };
  await setJson(ALERTS_KEY, { updatedAt: new Date().toISOString(), alerts });
  return { ok: true };
}
