/**
 * Unified radar product: FOMO trusted-wallet cohort + large DEX buys.
 * Hard gates block copying on both feeds. Live copying stays off.
 */

import { HARD_GATE_PUBLIC } from "./hardGates.js";
import { collectFomoSignals } from "./fomoRadar.js";
import {
  MIN_BUY_USD,
  attachHardGates,
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
  hardGates: HARD_GATE_PUBLIC,
  note: "Both feeds stay visible when gated. Copying is off. $109 trading money is not spent on data subscriptions. Not trade advice.",
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
  maxGateChecks = 10,
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

  const fomoScreen = await attachHardGates(
    fomo.alerts.map(asScreenable),
    { maxChecks: Math.min(maxGateChecks, fomo.alerts.length || 0) }
  );
  const fomoByAddr = new Map(
    fomoScreen.map((row) => [`${row.chainId}:${row.tokenAddress}`, row.risk])
  );
  const trusted = fomo.alerts.map((alert) => {
    const risk = fomoByAddr.get(`${alert.chainId}:${alert.tokenAddress}`) || null;
    return { ...alert, risk, copyAllowed: false };
  });

  const dexGated = await attachHardGates(dex.buys, {
    maxChecks: Math.min(maxGateChecks, dex.buys.length || 0),
  });
  const largeBuys = dexGated.map(normalizeDexAlert);

  const gateSummary = (rows) => {
    let pass = 0;
    let blocked = 0;
    let notCleared = 0;
    for (const row of rows) {
      const status = row.risk?.hardGate?.status;
      if (row.risk?.hardGate?.pass) pass += 1;
      else if (status === "blocked") blocked += 1;
      else notCleared += 1;
    }
    return { pass, blocked, notCleared, total: rows.length };
  };

  return {
    product: PRODUCT,
    trustedWallets: trusted,
    largeBuys,
    summary: {
      trusted: gateSummary(trusted),
      largeBuys: gateSummary(largeBuys),
      poolsScanned: dex.poolsScanned || 0,
      droppedUnreliable: dex.droppedUnreliable || 0,
    },
    errors,
    copyingEnabled: false,
  };
}
