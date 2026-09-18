/**
 * Traction & catalyst check — research only.
 * Uses Reddit public sample when paid keys absent.
 * Never fabricates posts or mention counts.
 */

import { buildTractionCard, providerDocs } from "../lib/social.js";
import { sanitizeError } from "../lib/freshness.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  if (!symbol) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "symbol_required", providers: providerDocs() }));
    return;
  }

  try {
    const card = await buildTractionCard({
      symbol,
      name: url.searchParams.get("name"),
      change24h: url.searchParams.get("change24h") != null
        ? Number(url.searchParams.get("change24h"))
        : null,
      technicalState: url.searchParams.get("state"),
      setupReadiness: url.searchParams.get("readiness") != null
        ? Number(url.searchParams.get("readiness"))
        : null,
    });

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        source: "social-research",
        data: card,
      })
    );
  } catch (err) {
    res.statusCode = 503;
    res.end(
      JSON.stringify({
        error: "social_unavailable",
        detail: sanitizeError(err),
        providers: providerDocs(),
      })
    );
  }
}
