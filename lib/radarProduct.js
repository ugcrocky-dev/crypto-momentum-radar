/**
 * Unified radar product: FOMO trusted-wallet cohort + large DEX buys.
 * Risky-coin labels only. No hard gates. Live copying stays off.
 */

import { collectFomoSignals } from "./fomoRadar.js";
import {
  MIN_BUY_USD,
  attachRiskLabels,
  collectWhaleBuys,
} from "./whaleAlerts.js";
import { sanitizeError } from "./freshness.js";

export const PRODUCT = {
  name: "Crypto Momentum Radar",
  mode: "research",
  copyingEnabled: false,
  feeds: [
    {
      id: "fomo_trusted",
      label: "Trusted wallets",
      provider: "FOMO Robinhood Radar",
      url: "https://fomoradar.app",
      note: "Named fomo.family traders on Robinhood Chain. Cohort scores, not a profit guarantee.",
    },
    {
      id: "dex_large_buys",
      label: "Large DEX buys",
      provider: "GeckoTerminal",
      note: "Buys of at least $10k on Ethereum, BSC, and Base. No wallet profit track record.",
    },
  ],
  note: "Both feeds stay visible. Risky coins are labeled only. Copying is off. Not trade advice.",
};

function asScreenable(alert) {
  return {
    symbol: alert.symbol,
    chainId: alert.chainId,
    tokenAddress: alert.tokenAddress,
  };
}

/**
 * Shape whale buys into the same product card language.
 */
export function normalizeDexAlert(buy) {
  return {
    id: buy.id,
    source: "dex_large_buy",
    kind: "large_buy",
    chain: buy.chain,
    chainId: buy.chainId,
    chainLabel: buy.chainLabel,
    symbol: buy.symbol,
    tokenAddress: buy.tokenAddress,
    wallet: buy.wallet,
    walletShort: buy.walletShort,
    usd: buy.usd,
    usdReliable: buy.usdReliable,
    pool: buy.pool,
    at: buy.at,
    txHash: buy.txHash,
    txUrl: buy.txUrl,
    repeatInWindow: buy.repeatInWindow,
    repeatCount: buy.repeatCount || 1,
    trackRecord: null,
    risk: buy.risk || null,
    copyAllowed: false,
  };
}

export async function buildRadarProduct({
  fomoLimit = 10,
  dexLimit = 8,
  maxRiskChecks = 10,
} = {}) {
  const errors = [];
  let fomo = { alerts: [], errors: [], provider: "fomoradar.app" };
  let dex = { buys: [], errors: [], poolsScanned: 0, droppedUnreliable: 0 };

  const [fomoSettled, dexSettled] = await Promise.allSettled([
    collectFomoSignals({ limit: fomoLimit }),
    collectWhaleBuys({ maxAlerts: dexLimit }),
  ]);

  if (fomoSettled.status === "fulfilled") fomo = fomoSettled.value;
  else errors.push({ feed: "fomo", error: sanitizeError(fomoSettled.reason) });
  if (dexSettled.status === "fulfilled") dex = dexSettled.value;
  else errors.push({ feed: "dex", error: sanitizeError(dexSettled.reason) });

  errors.push(...(fomo.errors || []).map((e) => ({ feed: "fomo", ...e })));
  errors.push(...(dex.errors || []).map((e) => ({ feed: "dex", ...e })));

  const fomoScreen = await attachRiskLabels(
    fomo.alerts.map(asScreenable),
    { maxChecks: Math.min(maxRiskChecks, fomo.alerts.length || 0) }
  );
  const fomoByAddr = new Map(
    fomoScreen.map((row) => [`${row.chainId}:${row.tokenAddress}`, row.risk])
  );
  const trusted = fomo.alerts.map((alert) => {
    const risk = fomoByAddr.get(`${alert.chainId}:${alert.tokenAddress}`) || null;
    return { ...alert, risk, copyAllowed: false };
  });

  const dexLabeled = await attachRiskLabels(dex.buys, {
    maxChecks: Math.min(maxRiskChecks, dex.buys.length || 0),
  });
  const largeBuys = dexLabeled.map(normalizeDexAlert);

  const riskSummary = (rows) => {
    let risky = 0;
    for (const row of rows) {
      if (row.risk?.risky) risky += 1;
    }
    return { risky, total: rows.length };
  };

  return {
    product: PRODUCT,
    trustedWallets: trusted,
    largeBuys,
    summary: {
      trusted: riskSummary(trusted),
      largeBuys: riskSummary(largeBuys),
      poolsScanned: dex.poolsScanned || 0,
      droppedUnreliable: dex.droppedUnreliable || 0,
    },
    errors,
    copyingEnabled: false,
  };
}
