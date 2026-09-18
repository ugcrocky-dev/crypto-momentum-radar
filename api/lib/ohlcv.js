/**
 * OHLCV candle helpers (CoinGecko market_chart + binance klines fallback).
 * Never invent trade counts or order flow from aggregate volume.
 */

import { sanitizeError } from "./freshness.js";

const PROVIDER = {
  coingecko: {
    name: "coingecko",
    cost: "Free tier / Demo API key optional (COINGECKO_API_KEY)",
    latency: "seconds–minutes; rate limits apply",
  },
  binance: {
    name: "binance-public",
    cost: "Free public REST",
    latency: "sub-second typical; rate limits apply",
  },
};

/**
 * Normalize heterogeneous candles to { t, open, high, low, close, volume, closed }
 */
export function normalizeCandles(rows, { provider, exchange, pair, timeframe } = {}) {
  const out = [];
  const seen = new Set();
  for (const r of rows || []) {
    let t, open, high, low, close, volume, closed;
    if (Array.isArray(r)) {
      // Binance kline
      t = Number(r[0]);
      open = Number(r[1]);
      high = Number(r[2]);
      low = Number(r[3]);
      close = Number(r[4]);
      volume = Number(r[5]);
      closed = true;
    } else if (r && typeof r === "object") {
      t = Number(r.t ?? r.time ?? r.timestamp ?? r[0]);
      open = Number(r.open ?? r.o);
      high = Number(r.high ?? r.h);
      low = Number(r.low ?? r.l);
      close = Number(r.close ?? r.c);
      volume = r.volume != null ? Number(r.volume) : r.v != null ? Number(r.v) : null;
      closed = r.closed !== false;
    } else continue;

    if (!Number.isFinite(t) || !Number.isFinite(close)) continue;
    if (t < 1e12) t *= 1000;
    const key = String(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      t,
      open: Number.isFinite(open) ? open : null,
      high: Number.isFinite(high) ? high : null,
      low: Number.isFinite(low) ? low : null,
      close,
      volume: Number.isFinite(volume) ? volume : null,
      closed: Boolean(closed),
      provider: provider || null,
      exchange: exchange || null,
      pair: pair || null,
      timeframe: timeframe || null,
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function timeframeToBinance(tf) {
  const map = { "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", daily: "1d" };
  return map[tf] || null;
}

function timeframeToCgDays(tf, limit) {
  // CoinGecko market_chart returns sparse points; days param controls range
  if (tf === "15m" || tf === "1h") return Math.min(30, Math.ceil((limit || 100) / 24) + 2);
  if (tf === "4h") return Math.min(90, Math.ceil(((limit || 100) * 4) / 24) + 2);
  return Math.min(365, (limit || 100) + 5);
}

/** Once Binance returns geo/auth blocks (common on Vercel egress), skip it for the rest of the process. */
let binanceBlockedReason = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch Binance USDT klines for a symbol like BTC → BTCUSDT
 */
export async function fetchBinanceKlines(symbol, timeframe = "1h", limit = 100) {
  if (binanceBlockedReason) {
    throw new Error(binanceBlockedReason);
  }
  const interval = timeframeToBinance(timeframe);
  if (!interval) throw new Error(`unsupported_timeframe_${timeframe}`);
  const pair = `${String(symbol).toUpperCase().replace(/USDT$/, "")}USDT`;
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${interval}&limit=${Math.min(1000, limit)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 429) {
      const err = new Error("provider_rate_limited");
      err.code = 429;
      throw err;
    }
    if (res.status === 451 || res.status === 403) {
      binanceBlockedReason = `binance_http_${res.status}`;
      throw new Error(binanceBlockedReason);
    }
    if (!res.ok) throw new Error(`binance_http_${res.status}`);
    const raw = await res.json();
    if (!Array.isArray(raw) || !raw.length) throw new Error("binance_empty");
    return {
      candles: normalizeCandles(raw, {
        provider: "binance",
        exchange: "binance",
        pair: `${pair}`,
        timeframe,
      }),
      provider: PROVIDER.binance,
      pair,
      timeframe,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Approximate OHLC from CoinGecko market_chart prices (no true OHLC).
 * Marks methodology so UI does not treat as exchange OHLC.
 */
export async function fetchCoinGeckoApprox(coinId, timeframe = "1h", limit = 100) {
  const days = timeframeToCgDays(timeframe, limit);
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=${days}`;
  const headers = { Accept: "application/json" };
  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (res.status === 429) {
      const err = new Error("provider_rate_limited");
      err.code = 429;
      throw err;
    }
    if (!res.ok) throw new Error(`coingecko_http_${res.status}`);
    const json = await res.json();
    const prices = json.prices || [];
    const volumes = json.total_volumes || [];
    const volMap = new Map(volumes.map(([ts, v]) => [ts, v]));
    // Build synthetic candles by bucket — disclosed as approximate
    const bucketMs =
      timeframe === "15m" ? 15 * 60 * 1000 :
      timeframe === "4h" ? 4 * 60 * 60 * 1000 :
      timeframe === "1d" || timeframe === "daily" ? 24 * 60 * 60 * 1000 :
      60 * 60 * 1000;
    const buckets = new Map();
    for (const [ts, price] of prices) {
      const b = Math.floor(ts / bucketMs) * bucketMs;
      const cur = buckets.get(b) || { t: b, open: price, high: price, low: price, close: price, volume: volMap.get(ts) ?? null };
      cur.high = Math.max(cur.high, price);
      cur.low = Math.min(cur.low, price);
      cur.close = price;
      if (volMap.has(ts)) cur.volume = volMap.get(ts);
      buckets.set(b, cur);
    }
    const candles = normalizeCandles([...buckets.values()].sort((a, b) => a.t - b.t).slice(-limit), {
      provider: "coingecko-approx",
      exchange: null,
      pair: `${coinId}/usd`,
      timeframe,
    });
    return {
      candles,
      provider: {
        ...PROVIDER.coingecko,
        note: "Synthetic OHLC from market_chart price buckets — not exchange OHLC. Volume is total_volume snapshot, not trade count.",
      },
      pair: `${coinId}/usd`,
      timeframe,
      approximate: true,
    };
  } finally {
    clearTimeout(t);
  }
}

const SYMBOL_COINGECKO_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  // Default holdings / research watchlist
  AERO: "aerodrome-finance",
  UNI: "uniswap",
  HBAR: "hedera-hashgraph",
  ARB: "arbitrum",
  // Frequently ranked momentum alts (Binance often 451 from Vercel)
  PIEVERSE: "pieverse",
  ZAMA: "zama",
  INJ: "injective-protocol",
  APT: "aptos",
  OP: "optimism",
  GEOD: "geodnet",
  S: "sonic-3",
  SUI: "sui",
  NEAR: "near",
  PEPE: "pepe",
  SHIB: "shiba-inu",
  WIF: "dogwifcoin",
  MATIC: "matic-network",
  POL: "polygon-ecosystem-token",
  ATOM: "cosmos",
  LTC: "litecoin",
  TRX: "tron",
  TON: "the-open-network",
  AAVE: "aave",
  MKR: "maker",
  CRV: "curve-dao-token",
  LDO: "lido-dao",
  RENDER: "render-token",
  FET: "fetch-ai",
  FIL: "filecoin",
  ICP: "internet-computer",
  SEI: "sei-network",
  TIA: "celestia",
  JUP: "jupiter-exchange-solana",
  PYTH: "pyth-network",
  WLD: "worldcoin-wld",
  ONDO: "ondo-finance",
  ENA: "ethena",
};

/** In-memory CoinGecko id lookups from /search (symbol → id|null). */
const cgIdCache = new Map();

export function lookupCoinGeckoId(symbol, coinId) {
  if (coinId) return String(coinId);
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return null;
  if (SYMBOL_COINGECKO_IDS[sym]) return SYMBOL_COINGECKO_IDS[sym];
  if (cgIdCache.has(sym)) return cgIdCache.get(sym);
  return null;
}

/**
 * Resolve CoinGecko coin id: explicit id → static map → /search exact symbol match.
 * Caches misses as null so we do not hammer the search API.
 */
export async function resolveCoinGeckoId(symbol, coinId) {
  const known = lookupCoinGeckoId(symbol, coinId);
  if (known) return known;
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return null;
  if (cgIdCache.has(sym)) return cgIdCache.get(sym);

  const headers = { Accept: "application/json" };
  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(sym)}`;
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) {
      cgIdCache.set(sym, null);
      return null;
    }
    const json = await res.json();
    const coins = Array.isArray(json.coins) ? json.coins : [];
    const exact = coins.filter(
      (c) => String(c?.symbol || "").toUpperCase() === sym && c?.id
    );
    exact.sort((a, b) => {
      const ar = Number.isFinite(a.market_cap_rank) ? a.market_cap_rank : 1e9;
      const br = Number.isFinite(b.market_cap_rank) ? b.market_cap_rank : 1e9;
      return ar - br;
    });
    const id = exact[0]?.id || null;
    cgIdCache.set(sym, id);
    return id;
  } catch {
    cgIdCache.set(sym, null);
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchCandles({ symbol, coinId, timeframe = "1h", limit = 100 } = {}) {
  const errors = [];
  if (symbol) {
    try {
      return await fetchBinanceKlines(symbol, timeframe, limit);
    } catch (err) {
      errors.push(sanitizeError(err));
    }
  }
  const resolvedCoinId = await resolveCoinGeckoId(symbol, coinId);
  if (resolvedCoinId) {
    try {
      return await fetchCoinGeckoApprox(resolvedCoinId, timeframe, limit);
    } catch (err) {
      errors.push(sanitizeError(err));
    }
  } else if (symbol) {
    errors.push("coingecko_id_unresolved");
  }
  const err = new Error(`ohlcv_unavailable:${errors.join("|") || "no_provider"}`);
  err.details = errors;
  throw err;
}

export { PROVIDER as OHLCV_PROVIDERS, SYMBOL_COINGECKO_IDS };
