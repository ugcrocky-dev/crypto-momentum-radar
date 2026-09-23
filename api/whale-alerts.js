import { sanitizeError } from "../lib/freshness.js";
import {
  MIN_BUY_USD,
  attachRiskLabels,
  collectWhaleBuys,
} from "../lib/whaleAlerts.js";

const CACHE_MS = 60 * 1000;
let cache = { at: 0, body: null };

/**
 * Large DEX buys. Copying is off. No wallet PnL is inferred.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const now = Date.now();
  if (cache.body && now - cache.at < CACHE_MS) {
    res.statusCode = 200;
    res.end(JSON.stringify(cache.body));
    return;
  }

  try {
    const collected = await collectWhaleBuys();
    const alerts = await attachRiskLabels(collected.buys);
    const body = {
      source: "whale-alerts",
      notificationsEnabled: false,
      copyingEnabled: false,
      metadata: {
        provider: "geckoterminal",
        minBuyUsd: MIN_BUY_USD,
        networks: ["eth", "bsc", "base"],
        poolsScanned: collected.poolsScanned,
        droppedUnreliable: collected.droppedUnreliable,
        fetchedAt: new Date(now).toISOString(),
        errors: collected.errors,
        note: "Large on-chain buys only. This source has no wallet profit track record. Risky coins are labeled only. Not trade advice.",
      },
      data: {
        alerts,
        copyingEnabled: false,
      },
    };
    if (!alerts.length && collected.errors.length && collected.poolsScanned === 0) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "whale_feed_unavailable", ...body }));
      return;
    }
    cache = { at: now, body };
    res.statusCode = 200;
    res.end(JSON.stringify(body));
  } catch (err) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "whale_feed_failed", detail: sanitizeError(err) }));
  }
}
