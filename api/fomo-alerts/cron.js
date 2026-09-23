import { sanitizeError } from "../../lib/freshness.js";
import { runFomoImmediatePass } from "../../lib/fomoImmediate.js";

function assertCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.authorization || "";
  const header = req.headers["x-cron-secret"];
  if (auth === `Bearer ${secret}`) return true;
  if (header && header === secret) return true;
  return false;
}

/**
 * Poll FOMO every minute for new trusted-wallet buys.
 * Alerts only — never places a trade.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET" && req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  if (!assertCronAuth(req)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ detail: "Unauthorized" }));
    return;
  }

  try {
    const result = await runFomoImmediatePass({ notify: true });
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        source: "fomo-alerts-cron",
        copyingEnabled: false,
        autoTrade: false,
        data: result,
      })
    );
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "fomo_cron_failed", detail: sanitizeError(err) }));
  }
}
