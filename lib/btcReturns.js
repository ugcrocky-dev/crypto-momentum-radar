/**
 * Enrich regime with BTC USD returns for 7/30/90d from live candles.
 * Never invent; on failure leave null so row windows show N/A.
 */

import { fetchCandles } from "./ohlcv.js";
import { sanitizeError } from "./freshness.js";

function returnFromCandles(candles, days) {
  if (!Array.isArray(candles) || candles.length < 2) return null;
  const now = candles[candles.length - 1];
  const target = now.t - days * 24 * 60 * 60 * 1000;
  // find closest candle at or before target
  let start = null;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].t <= target) {
      start = candles[i];
      break;
    }
  }
  if (!start || !Number.isFinite(start.close) || !Number.isFinite(now.close) || start.close <= 0) {
    return null;
  }
  // percent units to match snapshot market.change*d
  return ((now.close - start.close) / start.close) * 100;
}

/**
 * @param {object} regime existing regime from snapshot
 * @returns {Promise<{regime: object, btcReturnsMeta: object}>}
 */
export async function enrichRegimeBtcReturns(regime = {}) {
  const next = { ...regime };
  const meta = {
    source: null,
    pair: null,
    error: null,
    windows: { d7: null, d30: null, d90: null },
  };

  try {
    const { candles, provider, pair } = await fetchCandles({
      symbol: "BTC",
      coinId: "bitcoin",
      timeframe: "1d",
      limit: 120,
    });
    meta.source = provider?.name || "ohlcv";
    meta.pair = pair;
    const d7 = returnFromCandles(candles, 7);
    const d30 = returnFromCandles(candles, 30);
    const d90 = returnFromCandles(candles, 90);
    if (d7 != null) next.btcChange7d = d7;
    if (d30 != null) next.btcChange30d = d30;
    if (d90 != null) next.btcChange90d = d90;
    meta.windows = { d7, d30, d90 };
  } catch (err) {
    meta.error = sanitizeError(err);
  }

  return { regime: next, btcReturnsMeta: meta };
}
