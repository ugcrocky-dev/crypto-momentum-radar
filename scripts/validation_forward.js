/**
 * Forward paper-validation harness (A/B/C).
 * Historical social/engagement backtests are insufficient without point-in-time stores.
 * This script records the protocol and can append forward observations.
 *
 * Usage: node scripts/validation_forward.js
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "validation-forward.json");

const PROTOCOL = {
  status: "pending_forward_paper_tracking",
  asOf: new Date().toISOString(),
  cohorts: {
    A: "Existing momentum scanner (/api/momentum rankings)",
    B: "Early technical scanner (/api/early-setups)",
    C: "Early scanner + social/catalyst (/api/early-setups?social=1)",
  },
  metrics: [
    "lead_time_vs_momentum_alerts",
    "false_breakout_rate",
    "max_favorable_excursion",
    "max_adverse_excursion",
    "net_paper_return_after_fees_slippage",
    "alerts_per_day",
    "regime_segment_performance",
  ],
  biasControls: [
    "chronological_only",
    "no_survivorship_fill_from_later_listings",
    "social_evidence_frozen_at_detection_time",
    "no_lookahead_on_engagement_totals",
  ],
  fees: { feeBps: 10, slippageBps: 5 },
  note: "Do not claim predictive edge until held-out forward sample is collected.",
};

async function main() {
  await mkdir(path.join(ROOT, "data"), { recursive: true });
  let existing = { observations: [] };
  try {
    existing = JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    /* first run */
  }
  const next = {
    protocol: PROTOCOL,
    observations: existing.observations || [],
    lastUpdatedAt: new Date().toISOString(),
  };
  await writeFile(OUT, JSON.stringify(next, null, 2));
  console.log(JSON.stringify({ ok: true, path: OUT, observations: next.observations.length, status: PROTOCOL.status }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
