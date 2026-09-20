/**
 * Large on-chain buys from GeckoTerminal pool trades.
 * Wallet profit history is not in this source — never invent a track record.
 * Hard gates block copying. They do not drop the alert. Live copying stays off.
 */

import { assessGoPlusSecurity, fetchGoPlusSecurity } from "./tokenRisk.js";
import { evaluateHardGates, hardGateWarning } from "./hardGates.js";
import { sanitizeError } from "./freshness.js";

export const MIN_BUY_USD = 10_000;
export const POOLS_PER_NETWORK = 2;

export const QUOTE_SYMBOLS = new Set([
  "WETH", "ETH", "WBNB", "BNB", "WSOL", "SOL", "USDT", "USDC", "DAI", "BUSD",
  "FDUSD", "TUSD", "USDE", "USD1", "WBTC", "BTC", "CBBTC", "BTCB",
]);

export const WHALE_NETWORKS = [
  { id: "eth", chainId: "1", label: "Ethereum", explorer: "https://etherscan.io/tx/" },
  { id: "bsc", chainId: "56", label: "BSC", explorer: "https://bscscan.com/tx/" },
  { id: "base", chainId: "8453", label: "Base", explorer: "https://basescan.org/tx/" },
];

const GT = "https://api.geckoterminal.com/api/v2";

export function isQuoteSymbol(symbol) {
  return QUOTE_SYMBOLS.has(String(symbol || "").toUpperCase());
}

export function shortAddress(address) {
  const v = String(address || "");
  if (v.length < 12) return v || null;
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

function tokenIndex(included) {
  const map = new Map();
  for (const item of included || []) {
    if (item?.type !== "token") continue;
    const address = String(item.attributes?.address || "").toLowerCase();
    if (!address) continue;
    map.set(item.id, {
      address,
      symbol: item.attributes?.symbol || null,
      name: item.attributes?.name || null,
    });
    map.set(address, map.get(item.id));
  }
  return map;
}

function tokenFromRel(pool, relName, index) {
  const id = pool?.relationships?.[relName]?.data?.id;
  if (!id || !index.has(id)) return null;
  return index.get(id);
}

/**
 * High-volume pools where one side is not a stable/wrapped gas token.
 */
export function selectCandidatePools(payload, { limit = POOLS_PER_NETWORK } = {}) {
  const index = tokenIndex(payload?.included);
  const out = [];
  for (const pool of payload?.data || []) {
    const base = tokenFromRel(pool, "base_token", index);
    const quote = tokenFromRel(pool, "quote_token", index);
    if (!base?.address || !quote?.address) continue;
    if (isQuoteSymbol(base.symbol) && isQuoteSymbol(quote.symbol)) continue;
    const reserve = Number(pool.attributes?.reserve_in_usd);
    out.push({
      address: String(pool.attributes?.address || "").toLowerCase(),
      name: pool.attributes?.name || null,
      reserveUsd: Number.isFinite(reserve) ? reserve : null,
      base,
      quote,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function lookupToken(address, pool) {
  const addr = String(address || "").toLowerCase();
  if (pool.base?.address === addr) return pool.base;
  if (pool.quote?.address === addr) return pool.quote;
  return { address: addr, symbol: null, name: null };
}

/**
 * Buys at or above minUsd. The bought asset is the trade's to-token.
 * Dollar size is unreliable when it dwarfs pool reserves.
 */
export function tradesToBuys(trades, pool, network, { minUsd = MIN_BUY_USD } = {}) {
  const buys = [];
  for (const trade of trades || []) {
    const a = trade?.attributes || trade;
    if (!a || a.kind !== "buy") continue;
    const usd = Number(a.volume_in_usd);
    if (!Number.isFinite(usd) || usd < minUsd) continue;
    const txHash = String(a.tx_hash || "");
    const wallet = String(a.tx_from_address || "").toLowerCase();
    if (!txHash || !wallet) continue;
    const token = lookupToken(a.to_token_address, pool);
    if (!token.address || isQuoteSymbol(token.symbol)) continue;
    const reserve = pool.reserveUsd;
    const usdReliable = reserve != null && reserve >= usd * 0.5;
    buys.push({
      id: `${network.id}:${txHash}:${token.address}`,
      chain: network.id,
      chainId: network.chainId,
      chainLabel: network.label,
      symbol: token.symbol,
      tokenName: token.name,
      tokenAddress: token.address,
      wallet,
      walletShort: shortAddress(wallet),
      side: "buy",
      usd,
      usdReliable,
      reserveUsd: reserve,
      priceUsd: Number(a.price_to_in_usd) || null,
      txHash,
      txUrl: `${network.explorer}${txHash}`,
      pool: pool.name,
      at: a.block_timestamp || null,
      trackRecord: null,
      copyAllowed: false,
    });
  }
  return buys;
}

export function publishableBuys(buys) {
  const kept = [];
  let droppedUnreliable = 0;
  for (const buy of buys) {
    if (!buy.usdReliable) {
      droppedUnreliable += 1;
      continue;
    }
    kept.push(buy);
  }
  return { buys: kept, droppedUnreliable };
}

export function collapseRepeats(buys) {
  const map = new Map();
  for (const buy of buys) {
    const key = `${buy.chain}:${buy.wallet}:${buy.tokenAddress}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...buy, repeatCount: 1 });
      continue;
    }
    const repeatCount = prev.repeatCount + 1;
    if (buy.usd > prev.usd) map.set(key, { ...buy, repeatCount });
    else prev.repeatCount = repeatCount;
  }
  return [...map.values()].map((buy) => ({
    ...buy,
    repeatInWindow: buy.repeatCount > 1,
  }));
}

export function markRepeatWallets(buys) {
  const counts = new Map();
  for (const buy of buys) {
    const key = `${buy.chain}:${buy.wallet}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return buys.map((buy) => ({
    ...buy,
    repeatInWindow: (counts.get(`${buy.chain}:${buy.wallet}`) || 0) > 1,
  }));
}

function labelFromAssessment(assessment) {
  if (!assessment?.risky) return null;
  return `Risky coin — ${assessment.reasons.join("; ").replaceAll("_", " ")}`;
}

export async function screenBoughtToken(buy) {
  try {
    const item = await fetchGoPlusSecurity(buy.chainId, buy.tokenAddress);
    if (!item) {
      const hardGate = evaluateHardGates({
        symbol: buy.symbol,
        status: "unresolved",
        scanned: false,
      });
      return {
        risky: false,
        status: "unresolved",
        reasons: [],
        label: null,
        provider: "goplus",
        hardGate,
        warning: hardGateWarning(hardGate),
      };
    }
    const assessed = assessGoPlusSecurity(item);
    const hardGate = evaluateHardGates({
      symbol: buy.symbol,
      status: assessed.risky ? "risky" : "clear",
      scanned: true,
      item,
    });
    return {
      risky: assessed.risky,
      status: assessed.risky ? "risky" : hardGate.status === "clear" ? "clear" : hardGate.status,
      reasons: assessed.reasons,
      label: labelFromAssessment(assessed),
      provider: "goplus",
      chainId: buy.chainId,
      address: buy.tokenAddress,
      hardGate,
      warning: hardGateWarning(hardGate),
    };
  } catch (err) {
    const hardGate = evaluateHardGates({
      symbol: buy.symbol,
      status: "error",
      scanned: false,
    });
    return {
      risky: false,
      status: "error",
      reasons: [],
      error: sanitizeError(err),
      provider: "goplus",
      hardGate,
      warning: hardGateWarning(hardGate),
    };
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function fetchJson(url, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "crypto-momentum-radar/whale" },
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Live large buys. Partial network failures stay in `errors` — no fabricated trades.
 */
export async function collectWhaleBuys({
  fetchImpl = fetch,
  networks = WHALE_NETWORKS,
  minUsd = MIN_BUY_USD,
  poolsPerNetwork = POOLS_PER_NETWORK,
  maxAlerts = 15,
  timeoutMs = 12000,
} = {}) {
  const errors = [];
  const poolJobs = networks.map(async (network) => {
    const url = `${GT}/networks/${network.id}/pools?page=1&include=base_token,quote_token&sort=h24_volume_usd_desc`;
    try {
      const payload = await fetchJson(url, fetchImpl, timeoutMs);
      return { network, pools: selectCandidatePools(payload, { limit: poolsPerNetwork }) };
    } catch (err) {
      errors.push({ network: network.id, stage: "pools", error: sanitizeError(err) });
      return { network, pools: [] };
    }
  });
  const listed = await Promise.all(poolJobs);

  const tradeJobs = [];
  for (const { network, pools } of listed) {
    for (const pool of pools) {
      tradeJobs.push({ network, pool });
    }
  }
  const tradeResults = await mapPool(tradeJobs, 4, async ({ network, pool }) => {
    const url = `${GT}/networks/${network.id}/pools/${pool.address}/trades?trade_volume_in_usd_greater_than=${minUsd}`;
    try {
      const payload = await fetchJson(url, fetchImpl, timeoutMs);
      return tradesToBuys(payload?.data, pool, network, { minUsd });
    } catch (err) {
      errors.push({ network: network.id, pool: pool.address, stage: "trades", error: sanitizeError(err) });
      return [];
    }
  });

  const seen = new Set();
  const buys = [];
  for (const batch of tradeResults) {
    for (const buy of batch || []) {
      if (seen.has(buy.id)) continue;
      seen.add(buy.id);
      buys.push(buy);
    }
  }
  buys.sort((a, b) => b.usd - a.usd);
  const published = publishableBuys(buys);
  const collapsed = collapseRepeats(published.buys).sort((a, b) => b.usd - a.usd);
  return {
    buys: collapsed.slice(0, maxAlerts),
    droppedUnreliable: published.droppedUnreliable,
    poolsScanned: tradeJobs.length,
    errors,
  };
}

export async function attachHardGates(buys, { maxChecks = 8 } = {}) {
  const order = [];
  const seen = new Set();
  for (const buy of buys) {
    const key = `${buy.chainId}:${buy.tokenAddress}`;
    if (seen.has(key)) continue;
    seen.add(key);
    order.push(buy);
    if (order.length >= maxChecks) break;
  }
  const screened = new Map();
  const results = await mapPool(order, 3, async (buy) => {
    const risk = await screenBoughtToken(buy);
    return [`${buy.chainId}:${buy.tokenAddress}`, risk];
  });
  for (const pair of results) {
    if (pair) screened.set(pair[0], pair[1]);
  }
  return buys.map((buy) => {
    const key = `${buy.chainId}:${buy.tokenAddress}`;
    const risk = screened.get(key) || {
      risky: false,
      status: "unscanned",
      reasons: [],
      label: null,
      hardGate: evaluateHardGates({ symbol: buy.symbol, status: "skipped", scanned: false }),
    };
    if (!risk.warning) risk.warning = hardGateWarning(risk.hardGate);
    return { ...buy, risk, copyAllowed: false };
  });
}
