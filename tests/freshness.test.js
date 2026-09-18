import test from "node:test";
import assert from "node:assert/strict";
import {
  computeFreshness,
  applyFreshnessToSnapshot,
  MAIN_CADENCE,
  HIGH_FREQUENCY_CADENCE,
} from "../api/lib/freshness.js";

const HOUR = 3600000;
const MIN = 60000;

test("old cached snapshot is expired, not fresh", () => {
  const now = Date.parse("2026-09-18T09:00:00.000Z");
  const source = "2026-09-02T06:15:06.142Z";
  const f = computeFreshness({ sourceGeneratedAt: source, nowMs: now, cadence: MAIN_CADENCE });
  assert.equal(f.status, "expired");
  assert.ok(f.ageHours > 300);
  assert.equal(f.actionable, false);
});

test("unchanged refresh does not reset age", () => {
  const source = "2026-09-18T08:00:00.000Z";
  const t1 = Date.parse("2026-09-18T08:10:00.000Z"); // 10m → fresh
  const t2 = Date.parse("2026-09-18T09:00:00.000Z"); // 60m → stale
  const a = computeFreshness({ sourceGeneratedAt: source, nowMs: t1, cadence: MAIN_CADENCE });
  const b = computeFreshness({ sourceGeneratedAt: source, nowMs: t2, cadence: MAIN_CADENCE });
  assert.equal(a.sourceGeneratedAt, b.sourceGeneratedAt);
  assert.ok(b.ageMinutes > a.ageMinutes);
  assert.equal(a.status, "fresh");
  assert.equal(b.status, "stale");
});

test("missing timestamp is unknown never fresh", () => {
  const f = computeFreshness({ sourceGeneratedAt: null, nowMs: Date.now() });
  assert.equal(f.status, "unknown");
  assert.equal(f.actionable, false);
});

test("future-dated timestamp is unknown", () => {
  const now = Date.parse("2026-09-18T09:00:00.000Z");
  const f = computeFreshness({
    sourceGeneratedAt: "2026-09-18T12:00:00.000Z",
    nowMs: now,
  });
  assert.equal(f.status, "unknown");
  assert.equal(f.reason, "materially_future_dated");
});

test("static fallback uses same freshness rules", () => {
  const now = Date.parse("2026-09-18T09:00:00.000Z");
  const snap = {
    generatedAt: "2026-08-21T20:52:14.034Z",
    sourceGeneratedAt: "2026-08-21T16:20:10.611Z",
    freshness: { status: "fresh", ageHours: 4.5, sourceGeneratedAt: "2026-08-21T16:20:10.611Z" },
    rows: [{ symbol: "BTC", confidence: "High" }],
  };
  const out = applyFreshnessToSnapshot(snap, { nowMs: now, cadence: MAIN_CADENCE });
  assert.equal(out.freshness.status, "expired");
  assert.notEqual(out.freshness.ageHours, 4.5);
  assert.equal(out.rows[0].confidence, "Low");
  assert.equal(out.rows[0].confidenceCapped, true);
});

test("genuinely new valid snapshot is fresh", () => {
  const now = Date.parse("2026-09-18T09:05:00.000Z");
  const f = computeFreshness({
    sourceGeneratedAt: "2026-09-18T09:00:00.000Z",
    nowMs: now,
    cadence: MAIN_CADENCE,
  });
  assert.equal(f.status, "fresh");
  assert.equal(f.actionable, true);
  assert.ok(f.ageMinutes < 10);
});

test("high-frequency freshness is independent of main cadence", () => {
  const now = Date.parse("2026-09-18T09:00:30.000Z");
  const hf = computeFreshness({
    sourceGeneratedAt: "2026-09-18T09:00:00.000Z",
    nowMs: now,
    cadence: HIGH_FREQUENCY_CADENCE,
  });
  const main = computeFreshness({
    sourceGeneratedAt: "2026-09-02T06:15:06.142Z",
    nowMs: now,
    cadence: MAIN_CADENCE,
  });
  assert.equal(hf.status, "fresh");
  assert.equal(main.status, "expired");
});

test("failed-refresh semantics: age still from source timestamp", () => {
  // Simulate: refresh attempted now but snapshot unchanged from 2h ago
  const source = "2026-09-18T07:00:00.000Z";
  const now = Date.parse("2026-09-18T09:00:00.000Z");
  const f = computeFreshness({ sourceGeneratedAt: source, nowMs: now });
  assert.equal(f.status, "stale");
  assert.equal(f.ageHours, 2);
});
