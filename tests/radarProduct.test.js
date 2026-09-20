import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFomoSignal } from "../lib/fomoRadar.js";
import { normalizeDexAlert, PRODUCT } from "../lib/radarProduct.js";
import { evaluateHardGates } from "../lib/hardGates.js";

test("product keeps copying off and names both feeds", () => {
  assert.equal(PRODUCT.copyingEnabled, false);
  assert.equal(PRODUCT.feeds.length, 2);
  assert.ok(PRODUCT.feeds.some((f) => f.id === "fomo_trusted"));
  assert.ok(PRODUCT.feeds.some((f) => f.id === "dex_large_buys"));
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

test("empty GoPlus tax strings count as zero tax, not a missing scan", () => {
  const gate = evaluateHardGates({
    symbol: "SI",
    status: "clear",
    scanned: true,
    item: {
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
      buy_tax: "",
      sell_tax: "",
      owner_percent: "0",
      creator_percent: "0",
      holders: [
        { address: "0x1111111111111111111111111111111111111111", percent: "0.04", is_locked: 0, tag: "" },
        { address: "0x2222222222222222222222222222222222222222", percent: "0.04", is_locked: 0, tag: "" },
      ],
      lp_holders: [{ address: "0x3333333333333333333333333333333333333333", percent: "1", is_locked: 1, tag: "lock" }],
      dex: [{ liquidity: "120000" }],
    },
  });
  assert.equal(gate.pass, true);
  assert.equal(gate.copyAllowed, false);
});
