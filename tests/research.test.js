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
} from "../api/lib/earlySetups.js";
import { mergeAlerts, simulatePaperEntry, resolveStopTargetHit } from "../api/lib/alerts.js";
import { normalizeWatchlist, prioritizeRows, DEFAULT_WATCHLIST } from "../api/lib/watchlist.js";

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
