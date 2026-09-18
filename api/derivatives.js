import { sanitizeError } from "../lib/freshness.js";
import {
  enrichRowsDerivatives,
  assessRotationHypothesis,
  assessCrowding,
} from "../lib/derivatives.js";

/**
 * GET /api/derivatives?symbols=BTC,ETH,SOL
 * Crowding context only — not directional buy signals.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const symbols = (url.searchParams.get("symbols") || "BTC,ETH,SOL")
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 12)
    .map((s) => ({ symbol: s.toUpperCase() }));

  try {
    const { derivatives, errors } = await enrichRowsDerivatives(symbols, {
      limit: symbols.length,
    });

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        source: "derivatives",
        metadata: {
          fetchedAt: new Date().toISOString(),
          exchange: "binance-usdm",
          note: "Rising OI ≠ buying. Elevated funding may mean crowded positioning.",
        },
        data: {
          rows: derivatives,
          errors,
          methodology: {
            crowding: "Funding magnitude thresholds; missing inputs → unknown + reduced confidence.",
            rotation: "See /api/momentum data.rotation — hypothesis, not assumption.",
          },
          emptyCrowdingExample: assessCrowding({}),
        },
      })
    );
  } catch (err) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "derivatives_unavailable", detail: sanitizeError(err) }));
  }
}
