import test from "node:test";
import assert from "node:assert/strict";
import { formatFomoAlertText, notifyConfigured } from "../lib/notify.js";

test("FOMO alert text never claims a trade was placed", () => {
  const text = formatFomoAlertText({
    kind: "fresh",
    symbol: "SI",
    buyers: 14,
    avgScore: 72.2,
    usd: 109000,
    who: ["looc", "0xC4ss"],
    tokenAddress: "0xabc",
    risk: {
      label: "Risky coin — unlocked liquidity",
    },
  });
  assert.match(text, /FOMO FRESH: SI/);
  assert.match(text, /Copying OFF/);
  assert.match(text, /Risky coin/);
  assert.doesNotMatch(text, /Hard gate|order filled|auto-?trade|bought for you/i);
});

test("notify channels report configuration without inventing credentials", () => {
  const cfg = notifyConfigured();
  assert.equal(typeof cfg.telegram, "boolean");
  assert.equal(typeof cfg.webhook, "boolean");
  assert.equal(typeof cfg.any, "boolean");
});
