import { sanitizeError } from "../lib/freshness.js";
import { listFomoAlerts, runFomoImmediatePass } from "../lib/fomoImmediate.js";

/**
 * GET — recent FOMO immediate alerts
 * POST — run one detection pass (also used by cron)
 * Auto-trade is never enabled here.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "GET" || req.method === "HEAD") {
    try {
      const listed = await listFomoAlerts();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          source: "fomo-alerts",
          copyingEnabled: false,
          autoTrade: false,
          data: listed,
          note: "Immediate FOMO cohort alerts. Copying off. Not trade advice.",
        })
      );
    } catch (err) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "fomo_alerts_unavailable", detail: sanitizeError(err) }));
    }
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  try {
    const result = await runFomoImmediatePass({ notify: true });
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        source: "fomo-alerts",
        copyingEnabled: false,
        autoTrade: false,
        data: result,
      })
    );
  } catch (err) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "fomo_alert_pass_failed", detail: sanitizeError(err) }));
  }
}
