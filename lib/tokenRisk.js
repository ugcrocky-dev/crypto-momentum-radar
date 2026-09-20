/**
 * Token contract risk labels (GoPlus) — mark risky coins, do not hide them.
 *
 * Flags aligned with common FOMO-style warnings:
 *   mintable, transfer_pausable, unlocked_liquidity, honeypot
 *
 * Native L1s without EVM contracts are treated as not-applicable (not risky).
 * Missing scan data stays unlabeled — never invent risk.
 */

import { resolveCoinGeckoId } from "./ohlcv.js";
import {
  getJson,
  redisConfigured,
  setJson,
  command,
} from "./upstashRedis.js";
import { sanitizeError } from "./freshness.js";
import { evaluateHardGates, hardGateWarning } from "./hardGates.js";

const CACHE_PREFIX = "cmr:token-risk:v3:";
const CACHE_TTL_SEC = 12 * 60 * 60;
const MEM_TTL_MS = 30 * 60 * 1000;
const MAX_CHECKS_PER_PASS = 24;
const CONCURRENCY = 4;

/** Majors / L1s — no FOMO-style ERC20 contract screen. */
export const NATIVE_SAFE_SYMBOLS = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK",
  "LTC", "TRX", "TON", "ATOM", "NEAR", "SUI", "APT", "BCH", "XLM", "ETC",
  "HBAR", "ICP", "FIL", "INJ", "SEI", "TIA", "OP", "ARB", "MATIC", "POL",
  "MKR", "AAVE", "UNI", "CRV", "LDO", "FET", "RENDER", "STX", "IMX", "ALGO",
  "VET", "XTZ", "EOS", "FLOW", "KAVA", "RUNE", "THETA", "AXS", "SAND", "MANA",
]);

const CG_PLATFORM_TO_GOPLUS = {
  ethereum: "1",
  "binance-smart-chain": "56",
  "polygon-pos": "137",
  "arbitrum-one": "42161",
  "optimistic-ethereum": "10",
  base: "8453",
  avalanche: "43114",
  fantom: "250",
  cronos: "25",
};

const memCache = new Map(); // symbol -> { at, value }

function memGet(symbol) {
  const hit = memCache.get(symbol);
  if (!hit) return null;
  if (Date.now() - hit.at > MEM_TTL_MS) {
    memCache.delete(symbol);
    return null;
  }
  return hit.value;
}

function memSet(symbol, value) {
  memCache.set(symbol, { at: Date.now(), value });
}

async function cacheGet(symbol) {
  const sym = String(symbol || "").toUpperCase();
  const local = memGet(sym);
  if (local) return local;
  if (!redisConfigured()) return null;
  try {
    const raw = await getJson(CACHE_PREFIX + sym);
    if (raw && typeof raw === "object") {
      memSet(sym, raw);
      return raw;
    }
  } catch {
    /* ignore cache miss/errors */
  }
  return null;
}

async function cacheSet(symbol, value) {
  const sym = String(symbol || "").toUpperCase();
  memSet(sym, value);
  if (!redisConfigured()) return;
  try {
    const payload = JSON.stringify(value);
    await command(["SET", CACHE_PREFIX + sym, payload, "EX", String(CACHE_TTL_SEC)]);
  } catch {
    try {
      await setJson(CACHE_PREFIX + sym, value);
    } catch {
      /* ignore */
    }
  }
}

function cgHeaders() {
  const headers = { Accept: "application/json" };
  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
  }
  return headers;
}

/**
 * Pick a GoPlus-supported chain + contract from CoinGecko platforms.
 */
export async function resolveTokenContract(symbol, coinId = null) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return null;
  if (NATIVE_SAFE_SYMBOLS.has(sym)) {
    return { symbol: sym, native: true, chainId: null, address: null };
  }
  const id = await resolveCoinGeckoId(sym, coinId);
  if (!id) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`;
    const res = await fetch(url, { headers: cgHeaders(), signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    const platforms = json.platforms || {};
    const detail = json.detail_platforms || {};
    // Prefer BSC then ETH then others (many FOMO-flagged memes are BSC)
    const prefer = [
      "binance-smart-chain",
      "ethereum",
      "base",
      "arbitrum-one",
      "polygon-pos",
      "optimistic-ethereum",
      "avalanche",
    ];
    const keys = [
      ...prefer.filter((k) => platforms[k]),
      ...Object.keys(platforms).filter((k) => !prefer.includes(k)),
    ];
    for (const platform of keys) {
      const chainId = CG_PLATFORM_TO_GOPLUS[platform];
      const address = platforms[platform] || detail[platform]?.contract_address;
      if (chainId && address && String(address).startsWith("0x")) {
        return {
          symbol: sym,
          coinId: id,
          platform,
          chainId,
          address: String(address).toLowerCase(),
          native: false,
        };
      }
    }
    return { symbol: sym, coinId: id, native: false, chainId: null, address: null };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Assess GoPlus token_security payload → risk label (never hide).
 */
export function assessGoPlusSecurity(item) {
  if (!item || typeof item !== "object") {
    return { risky: false, reasons: [], flags: {} };
  }
  const flag = (k) => item[k] === "1" || item[k] === 1 || item[k] === true;
  const reasons = [];
  const flags = {};

  if (flag("is_honeypot")) {
    reasons.push("honeypot");
    flags.honeypot = true;
  }
  if (flag("is_mintable")) {
    reasons.push("mintable");
    flags.mintable = true;
  }
  if (flag("transfer_pausable")) {
    reasons.push("transfer_pausable");
    flags.transferPausable = true;
  }
  if (flag("hidden_owner")) {
    reasons.push("hidden_owner");
    flags.hiddenOwner = true;
  }
  if (flag("owner_change_balance")) {
    reasons.push("owner_can_change_balance");
    flags.ownerChangeBalance = true;
  }

  const holders = Array.isArray(item.lp_holders) ? item.lp_holders : [];
  let lockedPct = 0;
  let totalPct = 0;
  for (const h of holders) {
    const p = Number(h.percent);
    if (!Number.isFinite(p)) continue;
    totalPct += p;
    if (Number(h.is_locked) === 1 || h.is_locked === true || h.is_locked === "1") {
      lockedPct += p;
    }
  }
  const lockedShare = totalPct > 0 ? lockedPct / totalPct : null;
  flags.lpLockedShare = lockedShare;
  // FOMO-style: ~0% locked liquidity is a rug vector
  if (holders.length > 0 && lockedShare != null && lockedShare < 0.05) {
    reasons.push("unlocked_liquidity");
    flags.unlockedLiquidity = true;
  }

  return {
    risky: reasons.length > 0,
    reasons,
    flags,
  };
}

export async function fetchGoPlusSecurity(chainId, address) {
  const url = `https://api.gopluslabs.io/api/v1/token_security/${encodeURIComponent(chainId)}?contract_addresses=${encodeURIComponent(address)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`goplus_http_${res.status}`);
    const json = await res.json();
    if (json.code !== 1 && json.code !== "1") {
      throw new Error(`goplus_code_${json.code}`);
    }
    const result = json.result || {};
    return result[String(address).toLowerCase()] || null;
  } finally {
    clearTimeout(t);
  }
}

function riskLabel(assessment) {
  if (!assessment?.risky) return null;
  return `Risky coin — ${assessment.reasons.join("; ").replaceAll("_", " ")}`;
}

function attachHardGate(value, { scanned = false, item = null } = {}) {
  const hardGate = evaluateHardGates({
    symbol: value.symbol,
    status: value.status,
    scanned,
    item,
  });
  return { ...value, hardGate };
}

/**
 * Build a stable risk object for a row (cached).
 */
export async function assessSymbolRisk(symbol, { coinId = null } = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) {
    return { symbol: null, risky: false, status: "skipped", reasons: [] };
  }

  const cached = await cacheGet(sym);
  if (cached) return cached;

  if (NATIVE_SAFE_SYMBOLS.has(sym)) {
    const value = attachHardGate({
      symbol: sym,
      risky: false,
      status: "native_safe",
      reasons: [],
      provider: null,
      checkedAt: new Date().toISOString(),
    });
    await cacheSet(sym, value);
    return value;
  }

  try {
    const contract = await resolveTokenContract(sym, coinId);
    if (!contract) {
      const value = attachHardGate({
        symbol: sym,
        risky: false,
        status: "unresolved",
        reasons: [],
        provider: null,
        checkedAt: new Date().toISOString(),
      });
      // Do not lock a lookup miss for 12h — CoinGecko often 429s mid-scan.
      memSet(sym, value);
      return value;
    }
    if (contract.native) {
      const value = attachHardGate({
        symbol: sym,
        risky: false,
        status: "native_safe",
        reasons: [],
        provider: null,
        checkedAt: new Date().toISOString(),
      });
      await cacheSet(sym, value);
      return value;
    }
    if (!contract.chainId || !contract.address) {
      const value = attachHardGate({
        symbol: sym,
        risky: false,
        status: "no_evm_contract",
        reasons: [],
        coinId: contract.coinId || null,
        provider: null,
        checkedAt: new Date().toISOString(),
      });
      await cacheSet(sym, value);
      return value;
    }

    const item = await fetchGoPlusSecurity(contract.chainId, contract.address);
    const assessed = assessGoPlusSecurity(item);
    const value = attachHardGate({
      symbol: sym,
      risky: assessed.risky,
      status: assessed.risky ? "risky" : "clear",
      reasons: assessed.reasons,
      flags: assessed.flags,
      provider: "goplus",
      chainId: contract.chainId,
      address: contract.address,
      platform: contract.platform,
      coinId: contract.coinId || null,
      checkedAt: new Date().toISOString(),
      label: riskLabel(assessed),
    }, { scanned: Boolean(item), item });
    await cacheSet(sym, value);
    return value;
  } catch (err) {
    const value = attachHardGate({
      symbol: sym,
      risky: false,
      status: "error",
      reasons: [],
      error: sanitizeError(err),
      provider: "goplus",
      checkedAt: new Date().toISOString(),
    });
    // Short mem cache only on errors so we retry sooner
    memSet(sym, value);
    return value;
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
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * Annotate momentum rows with risk — keeps all rows visible.
 * Caps live GoPlus/CoinGecko lookups per call; uses cache for the rest.
 */
export async function enrichRowsWithRisk(rows, { maxChecks = MAX_CHECKS_PER_PASS } = {}) {
  if (!Array.isArray(rows) || !rows.length) {
    return {
      rows: rows || [],
      riskMeta: {
        checked: 0,
        risky: 0,
        cached: 0,
        skipped: 0,
        hardGatePass: 0,
        hardGateBlocked: 0,
        hardGateNotCleared: 0,
      },
    };
  }

  const meta = {
    checked: 0,
    risky: 0,
    cached: 0,
    skipped: 0,
    errors: 0,
    hardGatePass: 0,
    hardGateBlocked: 0,
    hardGateNotCleared: 0,
  };
  let budget = maxChecks;
  const assessments = new Map();

  // Pass 1: cache hits
  for (const row of rows) {
    const sym = String(row?.symbol || "").toUpperCase();
    if (!sym) continue;
    const cached = await cacheGet(sym);
    if (cached) {
      assessments.set(sym, cached);
      meta.cached += 1;
    }
  }

  // Pass 2: live checks for top unscanned
  const need = [];
  for (const row of rows) {
    const sym = String(row?.symbol || "").toUpperCase();
    if (!sym || assessments.has(sym)) continue;
    if (budget <= 0) break;
    need.push(row);
    budget -= 1;
  }

  if (need.length) {
    const live = await mapPool(need, CONCURRENCY, async (row) => {
      const risk = await assessSymbolRisk(row.symbol, { coinId: row.id || null });
      return risk;
    });
    for (const risk of live) {
      if (!risk?.symbol) continue;
      assessments.set(risk.symbol, risk);
      meta.checked += 1;
      if (risk.status === "error") meta.errors += 1;
    }
  }

  const out = rows.map((row) => {
    const sym = String(row?.symbol || "").toUpperCase();
    const risk = assessments.get(sym);
    if (!risk) {
      meta.skipped += 1;
      return row;
    }
    if (risk.risky) meta.risky += 1;
    if (risk.hardGate?.pass) meta.hardGatePass += 1;
    else if (risk.hardGate?.status === "blocked") meta.hardGateBlocked += 1;
    else if (risk.hardGate) meta.hardGateNotCleared += 1;
    const label = risk.label || riskLabel(risk);
    const gateLine = hardGateWarning(risk.hardGate);
    const warnings = Array.isArray(row.warnings) ? row.warnings.slice() : [];
    const evidence = Array.isArray(row.evidence) ? row.evidence.slice() : [];
    if (gateLine) {
      if (!warnings.some((w) => String(w).startsWith("Hard gate:"))) {
        warnings.unshift(gateLine);
      }
      if (!evidence.some((e) => String(e).startsWith("Hard gate:"))) {
        evidence.unshift(`${gateLine} Coin stays on the board.`);
      }
    }
    if (risk.risky && label) {
      if (!warnings.some((w) => String(w).startsWith("Risky coin"))) {
        warnings.unshift(label);
      }
      if (!evidence.some((e) => String(e).startsWith("Risky coin"))) {
        evidence.unshift(`${label}. Shown for awareness — not hidden.`);
      }
    }
    return {
      ...row,
      risk,
      warnings,
      evidence,
    };
  });

  return { rows: out, riskMeta: meta };
}
