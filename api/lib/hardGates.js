/**
 * Hard gates for any copy decision.
 * A failed or uncleared gate blocks copying. It does not remove the coin
 * from the momentum board or the research list.
 *
 * Missing evidence fails closed. Native L1s (no ERC20 owner) are exempt
 * from contract gates — that is not a trade recommendation.
 */

export const HARD_GATES = {
  maxBuyTax: 0.1,
  maxSellTax: 0.1,
  minLpLockedShare: 0.05,
  maxTopHolderShare: 0.15,
  maxTop10Share: 0.5,
  minLiquidityUsd: 50_000,
};

/** Chain assets with no ERC20 owner/mint/LP object to screen. */
export const NATIVE_L1_SYMBOLS = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LTC",
  "TRX", "TON", "ATOM", "NEAR", "SUI", "APT", "BCH", "XLM", "ETC", "HBAR",
  "ICP", "FIL", "INJ", "SEI", "TIA", "ALGO", "VET", "XTZ", "EOS", "FLOW",
  "KAVA", "RUNE", "THETA",
]);

const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0xdead000000000000000000000000000000000000",
]);

const EXCLUDE_TAG = /burn|dead|null|blackhole|lock|cex|binance|coinbase|kraken|okx|bybit|kucoin|gate\.io|mexc|bridge|pair|uniswap|pancake|liquidity|pool/i;

/** "1" rejects. Missing key fails closed. */
const REJECT_IF_ON = [
  ["is_honeypot", "honeypot"],
  ["is_mintable", "mintable"],
  ["transfer_pausable", "transfer_pausable"],
  ["hidden_owner", "hidden_owner"],
  ["owner_change_balance", "owner_can_change_balance"],
  ["can_take_back_ownership", "can_take_back_ownership"],
  ["selfdestruct", "selfdestruct"],
  ["is_blacklisted", "blacklist_function"],
  ["slippage_modifiable", "slippage_modifiable"],
  ["personal_slippage_modifiable", "personal_slippage"],
  ["cannot_buy", "cannot_buy"],
  ["honeypot_with_same_creator", "creator_honeypot_history"],
];

export const HARD_GATE_PUBLIC = {
  mode: "block_copy",
  hidesRows: false,
  failClosed: true,
  rules: HARD_GATES,
  rejects: REJECT_IF_ON.map((pair) => pair[1]).concat([
    "not_open_source",
    "unlocked_liquidity",
    "top_holder",
    "top10_concentration",
    "owner_supply",
    "creator_supply",
    "high_buy_tax",
    "high_sell_tax",
    "thin_liquidity",
  ]),
  note: "Hard gates block copying only. Risky and blocked coins stay visible. Uncleared scans are not copyable. Not investment advice. Gates do not prevent every rug.",
};

function isOn(value) {
  return value === "1" || value === 1 || value === true;
}

function isOff(value) {
  return value === "0" || value === 0 || value === false;
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asShare(value, scale) {
  const n = finite(value);
  if (n == null || n < 0) return null;
  return n / scale;
}

function shareScale(values) {
  const nums = values.map((v) => finite(v)).filter((n) => n != null && n >= 0);
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum > 1.5 ? 100 : 1;
}

function isBurn(address) {
  return BURN_ADDRESSES.has(String(address || "").toLowerCase());
}

function excludedHolder(holder) {
  if (!holder || typeof holder !== "object") return true;
  if (isBurn(holder.address)) return true;
  if (isOn(holder.is_locked)) return true;
  const tag = String(holder.tag || holder.label || "");
  if (tag && EXCLUDE_TAG.test(tag)) return true;
  return false;
}

function notCleared(missing, extra = {}) {
  return {
    pass: false,
    status: "not_cleared",
    blocked: [],
    missing,
    exemptions: [],
    copyAllowed: false,
    ...extra,
  };
}

function exempt() {
  return {
    pass: true,
    status: "exempt",
    blocked: [],
    missing: [],
    exemptions: ["native_l1"],
    copyAllowed: false,
    note: "Native L1 — ERC20 rug gates do not apply. Not a copy approval.",
  };
}

/**
 * @param {{ symbol?: string, status?: string, scanned?: boolean, item?: object|null, native?: boolean }} input
 */
export function evaluateHardGates(input = {}) {
  const symbol = String(input.symbol || "").toUpperCase();
  if (input.native === true || NATIVE_L1_SYMBOLS.has(symbol)) {
    return exempt();
  }

  const item = input.item;
  if (!input.scanned || !item || typeof item !== "object") {
    const status = input.status || "unscanned";
    const reason =
      status === "error"
        ? "scan_error"
        : status === "unresolved"
          ? "unresolved_token"
          : status === "no_evm_contract"
            ? "no_evm_contract"
            : status === "native_safe"
              ? "not_scanned"
              : "unscanned";
    return notCleared([reason]);
  }

  const blocked = [];
  const missing = [];

  for (const [key, reason] of REJECT_IF_ON) {
    if (!(key in item) || item[key] == null || item[key] === "") {
      missing.push(key);
      continue;
    }
    if (isOn(item[key])) blocked.push(reason);
  }

  if (!("is_open_source" in item) || item.is_open_source == null || item.is_open_source === "") {
    missing.push("is_open_source");
  } else if (!isOn(item.is_open_source)) {
    blocked.push("not_open_source");
  }

  const buyTax = asShare(item.buy_tax, finite(item.buy_tax) > 1 ? 100 : 1);
  const sellTax = asShare(item.sell_tax, finite(item.sell_tax) > 1 ? 100 : 1);
  if (buyTax == null) missing.push("buy_tax");
  else if (buyTax > HARD_GATES.maxBuyTax) blocked.push("high_buy_tax");
  if (sellTax == null) missing.push("sell_tax");
  else if (sellTax > HARD_GATES.maxSellTax) blocked.push("high_sell_tax");

  const lpHolders = Array.isArray(item.lp_holders) ? item.lp_holders : null;
  if (!lpHolders || lpHolders.length === 0) {
    missing.push("lp_lock");
  } else {
    const scale = shareScale(lpHolders.map((h) => h.percent));
    let locked = 0;
    let total = 0;
    for (const h of lpHolders) {
      const p = asShare(h.percent, scale);
      if (p == null) continue;
      total += p;
      if (isOn(h.is_locked)) locked += p;
    }
    if (total <= 0) missing.push("lp_lock");
    else if (locked / total < HARD_GATES.minLpLockedShare) blocked.push("unlocked_liquidity");
  }

  const holders = Array.isArray(item.holders) ? item.holders : null;
  if (!holders || holders.length === 0) {
    missing.push("holder_concentration");
  } else {
    const scale = shareScale(holders.map((h) => h.percent));
    const kept = [];
    for (const h of holders) {
      if (excludedHolder(h)) continue;
      const p = asShare(h.percent, scale);
      if (p == null) continue;
      kept.push(p);
    }
    kept.sort((a, b) => b - a);
    if (!kept.length) {
      missing.push("holder_concentration");
    } else {
      if (kept[0] > HARD_GATES.maxTopHolderShare) {
        blocked.push(`top_holder_${Math.round(kept[0] * 100)}pct`);
      }
      const top10 = kept.slice(0, 10).reduce((a, b) => a + b, 0);
      if (top10 > HARD_GATES.maxTop10Share) {
        blocked.push(`top10_${Math.round(top10 * 100)}pct`);
      }
    }
  }

  const ownerShare = asShare(item.owner_percent, finite(item.owner_percent) > 1 ? 100 : 1);
  const creatorShare = asShare(item.creator_percent, finite(item.creator_percent) > 1 ? 100 : 1);
  if (ownerShare == null) missing.push("owner_percent");
  else if (ownerShare > HARD_GATES.maxTopHolderShare && !isBurn(item.owner_address)) {
    blocked.push("owner_supply");
  }
  if (creatorShare == null) missing.push("creator_percent");
  else if (creatorShare > HARD_GATES.maxTopHolderShare && !isBurn(item.creator_address)) {
    blocked.push("creator_supply");
  }

  const dex = Array.isArray(item.dex) ? item.dex : null;
  if (!dex || dex.length === 0) {
    missing.push("liquidity");
  } else {
    let liquidity = 0;
    let any = false;
    for (const pool of dex) {
      const n = finite(pool?.liquidity);
      if (n == null) continue;
      any = true;
      if (n > 0) liquidity += n;
    }
    if (!any || liquidity <= 0) missing.push("liquidity");
    else if (liquidity < HARD_GATES.minLiquidityUsd) blocked.push("thin_liquidity");
  }

  const status = blocked.length ? "blocked" : missing.length ? "not_cleared" : "clear";
  return {
    pass: status === "clear",
    status,
    blocked,
    missing,
    exemptions: [],
    copyAllowed: false,
    rules: HARD_GATES,
  };
}

export function hardGateWarning(gate) {
  if (!gate || gate.pass) return null;
  const reasons = (gate.status === "blocked" ? gate.blocked : gate.missing) || [];
  const detail = reasons.map((r) => String(r).replaceAll("_", " ")).join("; ");
  if (gate.status === "blocked") {
    return detail
      ? `Hard gate: blocked — ${detail}. Still shown. Not a copy.`
      : "Hard gate: blocked. Still shown. Not a copy.";
  }
  return detail
    ? `Hard gate: not cleared — ${detail}. Copy blocked until every gate has evidence.`
    : "Hard gate: not cleared. Copy blocked until every gate has evidence.";
}
