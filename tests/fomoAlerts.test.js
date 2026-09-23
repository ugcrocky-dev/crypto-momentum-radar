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
      hardGate: { pass: false, status: "blocked", blocked: ["unlocked_liquidity"], missing: [] },
    },
  });
  assert.match(text, /FOMO FRESH: SI/);
  assert.match(text, /Copying OFF/);
  assert.match(text, /Hard gate: blocked/);
  assert.doesNotMatch(text, /order filled|auto-?trade|bought for you/i);
});

test("notify channels report configuration without inventing credentials", () => {
  const cfg = notifyConfigured();
  assert.equal(typeof cfg.telegram, "boolean");
  assert.equal(typeof cfg.webhook, "boolean");
  assert.equal(typeof cfg.any, "boolean");
});
