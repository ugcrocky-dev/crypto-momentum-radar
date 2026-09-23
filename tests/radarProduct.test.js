import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFomoSignal } from "../lib/fomoRadar.js";
import { normalizeDexAlert, PRODUCT } from "../lib/radarProduct.js";

test("product keeps copying off and names both feeds", () => {
  assert.equal(PRODUCT.copyingEnabled, false);
  assert.equal(PRODUCT.feeds.length, 2);
  assert.ok(PRODUCT.feeds.some((f) => f.id === "fomo_trusted"));
  assert.ok(PRODUCT.feeds.some((f) => f.id === "dex_large_buys"));
  assert.equal(PRODUCT.hardGates, undefined);
});

test("FOMO signal normalizes cohort fields without inventing a wallet PnL", () => {
  const alert = normalizeFomoSignal(
    {
      mint: "0xb911f04a24a9f6234537829290335e623ee71e18",
      sym: "URANUS",
      liq: 494882.78,
      buyers: 20,
      usd: 212095.28,
      first_ts: 1789795238,
      avg_score: 74.65,
      conviction: 11.22,
      who: ["thebrianjung", "0xC4ss", "Rowdy"],
    },
    { kind: "fresh" }
  );
  assert.equal(alert.source, "fomo_robinhood_radar");
  assert.equal(alert.chainId, "4663");
  assert.equal(alert.symbol, "URANUS");
  assert.equal(alert.buyers, 20);
  assert.equal(alert.copyAllowed, false);
  assert.equal(alert.trackRecord.type, "cohort_score");
  assert.equal(alert.attribution.url, "https://fomoradar.app");
});

test("DEX alert stays labeled as no track record", () => {
  const alert = normalizeDexAlert({
    id: "eth:0xabc:0xpepe",
    chain: "eth",
    chainId: "1",
    chainLabel: "Ethereum",
    symbol: "PEPE",
    tokenAddress: "0xpepe",
    wallet: "0x1111111111111111111111111111111111111111",
    walletShort: "0x1111…1111",
    usd: 42000,
    usdReliable: true,
    pool: "PEPE / WETH",
    at: "2026-09-19T00:00:00Z",
    txHash: "0xabc",
    txUrl: "https://etherscan.io/tx/0xabc",
    repeatInWindow: false,
    copyAllowed: false,
  });
  assert.equal(alert.source, "dex_large_buy");
  assert.equal(alert.trackRecord, null);
  assert.equal(alert.copyAllowed, false);
});
