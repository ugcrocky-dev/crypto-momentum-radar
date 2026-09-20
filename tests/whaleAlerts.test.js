import test from "node:test";
import assert from "node:assert/strict";
import {
  isQuoteSymbol,
  selectCandidatePools,
  tradesToBuys,
  markRepeatWallets,
  publishableBuys,
  shortAddress,
} from "../lib/whaleAlerts.js";

const network = {
  id: "eth",
  chainId: "1",
  label: "Ethereum",
  explorer: "https://etherscan.io/tx/",
};

const pool = {
  address: "0xpool",
  name: "PEPE / WETH",
  reserveUsd: 2_000_000,
  base: { address: "0xpepe", symbol: "PEPE", name: "Pepe" },
  quote: { address: "0xweth", symbol: "WETH", name: "Wrapped Ether" },
};

test("quote symbols are recognized", () => {
  assert.equal(isQuoteSymbol("usdc"), true);
  assert.equal(isQuoteSymbol("PEPE"), false);
});

test("stable-stable pools are skipped and the alt pool is kept", () => {
  const payload = {
    included: [
      { id: "eth_usdc", type: "token", attributes: { address: "0xusdc", symbol: "USDC", name: "USD Coin" } },
      { id: "eth_usdt", type: "token", attributes: { address: "0xusdt", symbol: "USDT", name: "Tether" } },
      { id: "eth_pepe", type: "token", attributes: { address: "0xpepe", symbol: "PEPE", name: "Pepe" } },
      { id: "eth_weth", type: "token", attributes: { address: "0xweth", symbol: "WETH", name: "Wrapped Ether" } },
    ],
    data: [
      {
        attributes: { address: "0xstable", name: "USDC / USDT", reserve_in_usd: "9000000" },
        relationships: {
          base_token: { data: { id: "eth_usdc" } },
          quote_token: { data: { id: "eth_usdt" } },
        },
      },
      {
        attributes: { address: "0xpepepool", name: "PEPE / WETH", reserve_in_usd: "1500000" },
        relationships: {
          base_token: { data: { id: "eth_pepe" } },
          quote_token: { data: { id: "eth_weth" } },
        },
      },
    ],
  };
  const picked = selectCandidatePools(payload, { limit: 2 });
  assert.equal(picked.length, 1);
  assert.equal(picked[0].base.symbol, "PEPE");
  assert.equal(picked[0].reserveUsd, 1500000);
});

test("only large buys of the non-quote token are kept", () => {
  const trades = [
    {
      attributes: {
        kind: "sell",
        volume_in_usd: "80000",
        tx_hash: "0xsell",
        tx_from_address: "0x1111111111111111111111111111111111111111",
        to_token_address: "0xweth",
        block_timestamp: "2026-09-19T00:00:00Z",
      },
    },
    {
      attributes: {
        kind: "buy",
        volume_in_usd: "500",
        tx_hash: "0xsmall",
        tx_from_address: "0x2222222222222222222222222222222222222222",
        to_token_address: "0xpepe",
        block_timestamp: "2026-09-19T00:01:00Z",
      },
    },
    {
      attributes: {
        kind: "buy",
        volume_in_usd: "42000",
        tx_hash: "0xbig",
        tx_from_address: "0x3333333333333333333333333333333333333333",
        to_token_address: "0xpepe",
        price_to_in_usd: "0.00001",
        block_timestamp: "2026-09-19T00:02:00Z",
      },
    },
    {
      attributes: {
        kind: "buy",
        volume_in_usd: "90000",
        tx_hash: "0xquote",
        tx_from_address: "0x4444444444444444444444444444444444444444",
        to_token_address: "0xweth",
        block_timestamp: "2026-09-19T00:03:00Z",
      },
    },
  ];
  const buys = tradesToBuys(trades, pool, network, { minUsd: 10000 });
  assert.equal(buys.length, 1);
  assert.equal(buys[0].symbol, "PEPE");
  assert.equal(buys[0].usd, 42000);
  assert.equal(buys[0].usdReliable, true);
  assert.equal(buys[0].copyAllowed, false);
  assert.equal(buys[0].trackRecord, null);
  assert.equal(buys[0].txUrl, "https://etherscan.io/tx/0xbig");
  assert.equal(shortAddress(buys[0].wallet), "0x3333…3333");
});

test("dollar size is unreliable when it exceeds pool reserves", () => {
  const thin = { ...pool, reserveUsd: 200 };
  const buys = tradesToBuys(
    [
      {
        attributes: {
          kind: "buy",
          volume_in_usd: "10000000",
          tx_hash: "0xwild",
          tx_from_address: "0x5555555555555555555555555555555555555555",
          to_token_address: "0xpepe",
          block_timestamp: "2026-09-19T00:04:00Z",
        },
      },
    ],
    thin,
    network
  );
  assert.equal(buys[0].usdReliable, false);
});

test("unreliable dollar prints are not published as whale buys", () => {
  const thin = tradesToBuys(
    [
      {
        attributes: {
          kind: "buy",
          volume_in_usd: "10000000",
          tx_hash: "0xwild",
          tx_from_address: "0x5555555555555555555555555555555555555555",
          to_token_address: "0xpepe",
          block_timestamp: "2026-09-19T00:04:00Z",
        },
      },
    ],
    { ...pool, reserveUsd: 200 },
    network
  );
  const real = tradesToBuys(
    [
      {
        attributes: {
          kind: "buy",
          volume_in_usd: "25000",
          tx_hash: "0xreal",
          tx_from_address: "0x7777777777777777777777777777777777777777",
          to_token_address: "0xpepe",
          block_timestamp: "2026-09-19T00:06:00Z",
        },
      },
    ],
    pool,
    network
  );
  const published = publishableBuys([...thin, ...real]);
  assert.equal(published.droppedUnreliable, 1);
  assert.deepEqual(published.buys.map((b) => b.txHash), ["0xreal"]);
});

test("repeat wallets in the same window are marked, not called a track record", () => {
  const one = tradesToBuys(
    [
      {
        attributes: {
          kind: "buy",
          volume_in_usd: "20000",
          tx_hash: "0xa",
          tx_from_address: "0x6666666666666666666666666666666666666666",
          to_token_address: "0xpepe",
          block_timestamp: "2026-09-19T00:05:00Z",
        },
      },
    ],
    pool,
    network
  )[0];
  const two = { ...one, id: "eth:0xb:0xpepe", txHash: "0xb" };
  const marked = markRepeatWallets([one, two]);
  assert.equal(marked[0].repeatInWindow, true);
  assert.equal(marked[0].trackRecord, null);
  assert.equal(marked[1].copyAllowed, false);
});
