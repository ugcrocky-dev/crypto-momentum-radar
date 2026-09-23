import test from "node:test";
import assert from "node:assert/strict";
import { formatFomoAlertText, notifyConfigured } from "../lib/notify.js";
import { isClearRisk, alertId } from "../lib/fomoImmediate.js";

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
      status: "risky",
      risky: true,
      label: "Risky coin — unlocked liquidity",
    },
  });
  assert.match(text, /FOMO FRESH: SI/);
  assert.match(text, /Copying OFF/);
  assert.match(text, /Risky coin/);
  assert.doesNotMatch(text, /Hard gate|order filled|auto-?trade|bought for you/i);
});

test("clear FOMO alert text marks GoPlus clear", () => {
  const text = formatFomoAlertText({
    kind: "signal",
    symbol: "CREDITS",
    buyers: 3,
    risk: { status: "clear", risky: false },
  });
  assert.match(text, /GoPlus: clear/);
});

test("notify channels report configuration without inventing credentials", () => {
  const cfg = notifyConfigured();
  assert.equal(typeof cfg.telegram, "boolean");
  assert.equal(typeof cfg.webhook, "boolean");
  assert.equal(typeof cfg.any, "boolean");
});

test("isClearRisk only accepts GoPlus clear screens", () => {
  assert.equal(isClearRisk(null), false);
  assert.equal(isClearRisk({ status: "unscanned", risky: false }), false);
  assert.equal(isClearRisk({ status: "risky", risky: true }), false);
  assert.equal(isClearRisk({ status: "clear", risky: false }), true);
});

test("alertId is stable per kind+mint", () => {
  assert.equal(
    alertId({ kind: "fresh", tokenAddress: "0xAbC" }),
    "fresh:0xabc"
  );
});
