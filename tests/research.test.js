import test from "node:test";
import assert from "node:assert/strict";
import {
  excessReturnPp,
  coinBtcRelativePct,
  windowRelative,
  enrichRowBtcRelative,
} from "../api/lib/btcRelative.js";
import {
  atrNormalized,
  bollingerWidth,
  deriveSetupState,
  scoreSetupReadiness,
  priorResistance,
  buildEarlySetup,
  selectPreBreakoutRows,
  alreadyExtendedSnapshot,
} from "../api/lib/earlySetups.js";
import { mergeAlerts, simulatePaperEntry, resolveStopTargetHit } from "../api/lib/alerts.js";
import { normalizeWatchlist, prioritizeRows, DEFAULT_WATCHLIST } from "../api/lib/watchlist.js";
import { assessGoPlusSecurity } from "../lib/tokenRisk.js";
import { evaluateHardGates } from "../lib/hardGates.js";

test("BTC excess and coin/BTC formulas", () => {
  // coin +20%, BTC +10% → excess 10pp; coin/BTC = 100*((1.2/1.1)-1) ≈ 9.091
  assert.equal(excessReturnPp(0.2, 0.1), 10);
  assert.ok(Math.abs(coinBtcRelativePct(0.2, 0.1) - 9.091) < 0.01);
});

test("90d never extrapolated from shorter windows", () => {
  const row = enrichRowBtcRelative(
    { symbol: "AAA", market: { change7d: 10, change30d: 20 } },
    { btcChange7d: 5, btcChange30d: 8 }
  );
  assert.equal(row.btcRelative.d7.available, true);
  assert.equal(row.btcRelative.d30.available, true);
  assert.equal(row.btcRelative.d90.available, false);
  assert.equal(row.btcRelative.beatingBtcAllThreePeriods, null);
});

test("windowRelative missing inputs are N/A not zero", () => {
  const w = windowRelative({ coinChangePct: null, btcChangePct: 1, available: true });
  assert.equal(w.available, false);
  assert.equal(w.excessReturnPp, null);
});

test("ATR and BB width on synthetic coil", () => {
  const candles = [];
  let price = 100;
  for (let i = 0; i < 60; i++) {
    price = 100 + Math.sin(i / 8) * 0.4;
    candles.push({
      t: 1_700_000_000_000 + i * 3600000,
      open: price,
      high: price + 0.2,
      low: price - 0.2,
      close: price,
      volume: 1000,
    });
  }
  const atr = atrNormalized(candles);
  const bb = bollingerWidth(candles);
  assert.ok(atr != null && atr < 0.05);
  assert.ok(bb != null && bb < 0.05);
});

test("prior resistance excludes signal bar", () => {
  const candles = [
    { high: 10, low: 9, close: 9.5, open: 9.2, volume: 1 },
    { high: 12, low: 10, close: 11, open: 10, volume: 1 },
    { high: 11, low: 10, close: 10.5, open: 10.2, volume: 1 }, // signal bar high 11 ignored
  ];
  assert.equal(priorResistance(candles, 10), 12);
});

test("compression is not automatically Igniting", () => {
  const state = deriveSetupState({
    compressionPercentile: 10,
    closeAboveResistance: false,
    volumeExpansion: false,
  });
  assert.equal(state, "Coiling");
});

test("setup readiness separates from direction", () => {
  const score = scoreSetupReadiness({
    compressionPercentile: 10,
    volumeDryUp: true,
    volumeExpansion: false,
    higherLows: true,
    distanceToResistancePct: -2,
    btcRelativeShortExcessPp: 3,
    overextended: false,
  });
  assert.ok(score != null && score > 40);
});

test("early setup from thin candles is insufficient not bullish", () => {
  const s = buildEarlySetup({ symbol: "XYZ", candles: [{ t: 1, close: 1, high: 1, low: 1, open: 1, volume: 1 }] });
  assert.equal(s.state, null);
  assert.equal(s.dataConfidence, "Insufficient");
});

test("alerts do not reset trigger price on refresh", () => {
  const existing = [
    {
      setupId: "AAA:1h:Igniting:10",
      symbol: "AAA",
      timeframe: "1h",
      state: "Igniting",
      triggerPrice: 10,
      firstDetectedAt: "2026-09-01T00:00:00.000Z",
      transitions: [],
      lastAlertAt: "2026-09-01T00:00:00.000Z",
    },
  ];
  const incoming = [
    {
      setupId: "AAA:1h:Igniting:10",
      symbol: "AAA",
      timeframe: "1h",
      state: "Igniting",
      features: { resistance: 99 },
      firstDetectedAt: "2026-09-18T00:00:00.000Z",
    },
  ];
  const merged = mergeAlerts(existing, incoming, { nowMs: Date.parse("2026-09-18T12:00:00.000Z") });
  assert.equal(merged[0].triggerPrice, 10);
});

test("pre-breakout pool drops confirmed and overextended names", () => {
  const rows = [
    { symbol: "BOOM", state: "Confirmed momentum", market: { change24h: 30, change7d: 40, volumeChange24h: 10 } },
    { symbol: "HOT", state: "Overextended", market: { change24h: 5, change7d: 8, volumeChange24h: 10 } },
    { symbol: "RUN", state: "Building", market: { change24h: 40, change7d: 10, volumeChange24h: 10 } },
    { symbol: "COIL", state: "Building", market: { change24h: 4, change7d: 8, volumeChange24h: 20 } },
    { symbol: "QUIET", state: "Watch", market: { change24h: 2, change7d: 3, volumeChange24h: 5 } },
    { symbol: "DEAD", state: "Weak", market: { change24h: 1, change7d: 1, volumeChange24h: 1 } },
  ];
  assert.equal(alreadyExtendedSnapshot(rows[0]), true);
  const picked = selectPreBreakoutRows(rows).map((r) => r.symbol);
  assert.deepEqual(picked, ["COIL", "QUIET"]);
});

test("GoPlus risk labels mintable and unlocked LP without hiding", () => {
  const assessed = assessGoPlusSecurity({
    is_mintable: "1",
    transfer_pausable: "0",
    is_honeypot: "0",
    hidden_owner: "0",
    lp_holders: [
      { address: "0x1", is_locked: 0, percent: "0.99" },
      { address: "0x2", is_locked: 0, percent: "0.01" },
    ],
  });
  assert.equal(assessed.risky, true);
  assert.ok(assessed.reasons.includes("mintable"));
  assert.ok(assessed.reasons.includes("unlocked_liquidity"));
});

function clearedToken(overrides = {}) {
  return {
    is_honeypot: "0",
    is_mintable: "0",
    transfer_pausable: "0",
    hidden_owner: "0",
    owner_change_balance: "0",
    can_take_back_ownership: "0",
    selfdestruct: "0",
    is_blacklisted: "0",
    slippage_modifiable: "0",
    personal_slippage_modifiable: "0",
    cannot_buy: "0",
    honeypot_with_same_creator: "0",
    is_open_source: "1",
    buy_tax: "0",
    sell_tax: "0",
    owner_percent: "0",
    creator_percent: "0",
    owner_address: "0xabc",
    holders: [
      { address: "0x1111111111111111111111111111111111111111", percent: "0.04", is_locked: 0, tag: "" },
      { address: "0x2222222222222222222222222222222222222222", percent: "0.04", is_locked: 0, tag: "" },
      { address: "0x3333333333333333333333333333333333333333", percent: "0.03", is_locked: 0, tag: "" },
    ],
    lp_holders: [
      { address: "0x4444444444444444444444444444444444444444", percent: "1", is_locked: 1, tag: "lock" },
    ],
    dex: [{ liquidity: "250000" }],
    ...overrides,
  };
}

test("hard gate blocks mintable, unlocked LP, and concentrated holder without hiding the row", () => {
  const gate = evaluateHardGates({
    symbol: "PIEVERSE",
    status: "risky",
    scanned: true,
    item: clearedToken({
      is_mintable: "1",
      hidden_owner: "1",
      lp_holders: [{ address: "0x1", percent: "1", is_locked: 0, tag: "" }],
      holders: [
        { address: "0x9999999999999999999999999999999999999999", percent: "0.228", is_locked: 0, tag: "" },
        { address: "0x8888888888888888888888888888888888888888", percent: "0.04", is_locked: 0, tag: "" },
      ],
    }),
  });
  assert.equal(gate.pass, false);
  assert.equal(gate.status, "blocked");
  assert.equal(gate.copyAllowed, false);
  assert.ok(gate.blocked.includes("mintable"));
  assert.ok(gate.blocked.includes("hidden_owner"));
  assert.ok(gate.blocked.includes("unlocked_liquidity"));
  assert.ok(gate.blocked.some((r) => r.startsWith("top_holder_")));
});

test("hard gate passes a dispersed locked-LP token and still refuses live copy", () => {
  const gate = evaluateHardGates({
    symbol: "CLEAR",
    status: "clear",
    scanned: true,
    item: clearedToken(),
  });
  assert.equal(gate.pass, true);
  assert.equal(gate.status, "clear");
  assert.equal(gate.copyAllowed, false);
});

test("hard gate fails closed when holder or scan evidence is missing", () => {
  const missingHolders = evaluateHardGates({
    symbol: "PARTIAL",
    status: "clear",
    scanned: true,
    item: clearedToken({ holders: [] }),
  });
  assert.equal(missingHolders.pass, false);
  assert.equal(missingHolders.status, "not_cleared");
  assert.ok(missingHolders.missing.includes("holder_concentration"));

  const unscanned = evaluateHardGates({ symbol: "NEW", status: "unresolved", scanned: false });
  assert.equal(unscanned.pass, false);
  assert.ok(unscanned.missing.includes("unresolved_token"));
});

test("native L1 is exempt from ERC20 gates; a listed ERC20 major is not", () => {
  const btc = evaluateHardGates({ symbol: "BTC", status: "native_safe", scanned: false });
  assert.equal(btc.pass, true);
  assert.equal(btc.status, "exempt");
  const uni = evaluateHardGates({ symbol: "UNI", status: "native_safe", scanned: false });
  assert.equal(uni.pass, false);
  assert.equal(uni.status, "not_cleared");
});

test("paper entry applies fees and slippage", () => {
  const p = simulatePaperEntry({ signalPrice: 100, side: "long" });
  assert.equal(p.ok, true);
  assert.ok(p.entryPrice > 100);
});

test("ambiguous stop+target resolves conservatively", () => {
  const r = resolveStopTargetHit(
    { high: 110, low: 90 },
    { stop: 95, target: 105, side: "long" }
  );
  assert.equal(r.ambiguous, true);
  assert.equal(r.hit, "stop");
});

test("default watchlist symbols present", () => {
  assert.deepEqual(normalizeWatchlist(DEFAULT_WATCHLIST), DEFAULT_WATCHLIST);
  const rows = prioritizeRows([{ symbol: "BTC" }, { symbol: "SOL" }, { symbol: "ETH" }], ["ETH", "SOL"]);
  assert.equal(rows[0].symbol, "ETH");
  assert.equal(rows[1].symbol, "SOL");
  assert.equal(rows[0].onWatchlist, true);
});
