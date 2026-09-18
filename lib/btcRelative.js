/**
 * Bitcoin-relative performance helpers.
 *
 * Returns are decimals (0.10 = +10%).
 * Excess return (percentage points) = 100 × (coinReturn − btcReturn)
 * Coin/BTC relative return (%) = 100 × ((1 + coinReturn) / (1 + btcReturn) − 1)
 *
 * Never extrapolate a longer window from a shorter one. Missing inputs → null / N/A.
 */

export const BTC_WINDOWS = Object.freeze([7, 30, 90]);

/**
 * @param {number|null|undefined} pct Change already expressed as percent (e.g. 12.5 for +12.5%)
 * @returns {number|null} decimal return
 */
export function percentToDecimal(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  return Number(pct) / 100;
}

/**
 * @param {number|null} coinReturn decimal
 * @param {number|null} btcReturn decimal
 */
export function excessReturnPp(coinReturn, btcReturn) {
  if (coinReturn == null || btcReturn == null) return null;
  if (!Number.isFinite(coinReturn) || !Number.isFinite(btcReturn)) return null;
  return Math.round(100 * (coinReturn - btcReturn) * 1000) / 1000;
}

/**
 * @param {number|null} coinReturn decimal
 * @param {number|null} btcReturn decimal
 */
export function coinBtcRelativePct(coinReturn, btcReturn) {
  if (coinReturn == null || btcReturn == null) return null;
  if (!Number.isFinite(coinReturn) || !Number.isFinite(btcReturn)) return null;
  if (btcReturn <= -1) return null;
  const rel = (1 + coinReturn) / (1 + btcReturn) - 1;
  return Math.round(100 * rel * 1000) / 1000;
}

/**
 * Build btcRelative block for one window.
 * @param {object} opts
 * @param {number|null} opts.coinChangePct percent units from provider
 * @param {number|null} opts.btcChangePct percent units
 * @param {boolean} opts.available
 */
export function windowRelative({ coinChangePct, btcChangePct, available = true } = {}) {
  if (!available) {
    return {
      available: false,
      coinUsdReturnPct: null,
      btcUsdReturnPct: null,
      excessReturnPp: null,
      coinBtcReturnPct: null,
      beatingBtc: null,
      reason: "insufficient_history",
    };
  }
  const coin = percentToDecimal(coinChangePct);
  const btc = percentToDecimal(btcChangePct);
  if (coin == null || btc == null) {
    return {
      available: false,
      coinUsdReturnPct: coinChangePct ?? null,
      btcUsdReturnPct: btcChangePct ?? null,
      excessReturnPp: null,
      coinBtcReturnPct: null,
      beatingBtc: null,
      reason: "missing_return",
    };
  }
  const excess = excessReturnPp(coin, btc);
  const rel = coinBtcRelativePct(coin, btc);
  return {
    available: true,
    coinUsdReturnPct: Math.round(coinChangePct * 1000) / 1000,
    btcUsdReturnPct: Math.round(btcChangePct * 1000) / 1000,
    excessReturnPp: excess,
    coinBtcReturnPct: rel,
    beatingBtc: excess != null ? excess > 0 : null,
  };
}

/**
 * Enrich a momentum row with 7/30/90d BTC-relative metrics.
 * Uses snapshot market.* change fields and regime.btcChange* when present.
 * Does NOT invent 90d from 7d/30d.
 *
 * @param {object} row
 * @param {object} regime
 */
export function enrichRowBtcRelative(row, regime = {}) {
  const market = row?.market || {};
  const d7 = windowRelative({
    coinChangePct: market.change7d,
    btcChangePct: regime.btcChange7d,
    available: market.change7d != null && regime.btcChange7d != null,
  });
  const d30 = windowRelative({
    coinChangePct: market.change30d,
    btcChangePct: regime.btcChange30d,
    available: market.change30d != null && regime.btcChange30d != null,
  });
  // 90d only when both sides exist — never extrapolated
  const d90 = windowRelative({
    coinChangePct: market.change90d,
    btcChangePct: regime.btcChange90d,
    available: market.change90d != null && regime.btcChange90d != null,
  });

  const beatingAll =
    d7.beatingBtc === true && d30.beatingBtc === true && d90.beatingBtc === true
      ? true
      : d7.beatingBtc === true && d30.beatingBtc === true && d90.available === false
        ? null // cannot claim all three without 90d
        : false;

  const improving =
    d7.available && d30.available && d7.excessReturnPp != null && d30.excessReturnPp != null
      ? d7.excessReturnPp > d30.excessReturnPp
      : null;

  return {
    ...row,
    btcRelative: {
      d7,
      d30,
      d90,
      beatingBtcAllAvailableWindows:
        [d7, d30, d90].filter((w) => w.available).every((w) => w.beatingBtc === true),
      beatingBtcAllThreePeriods: beatingAll,
      improvingVsBtc: improving,
      labels: {
        excessReturnPp: "Excess return vs BTC (percentage points)",
        coinBtcReturnPct: "Coin/BTC relative return (%)",
        coinUsdReturnPct: "Coin USD return (%)",
        btcUsdReturnPct: "BTC USD return (%)",
      },
    },
  };
}

/**
 * @param {object} data momentum snapshot data
 */
export function enrichSnapshotBtcRelative(data) {
  if (!data || !Array.isArray(data.rows)) return data;
  const regime = data.regime || {};
  return {
    ...data,
    rows: data.rows.map((row) => enrichRowBtcRelative(row, regime)),
    btcRelativeMeta: {
      windowsDays: BTC_WINDOWS,
      methodology:
        "Excess pp = 100×(coin−BTC); Coin/BTC % = 100×((1+coin)/(1+BTC)−1). 90d shown only when both coin and BTC 90d returns exist — never extrapolated.",
      btcChange7d: regime.btcChange7d ?? null,
      btcChange30d: regime.btcChange30d ?? null,
      btcChange90d: regime.btcChange90d ?? null,
    },
  };
}
