import { sanitizeError } from "../lib/freshness.js";
import { fetchCandles, OHLCV_PROVIDERS } from "../lib/ohlcv.js";
import { computeFreshness, HIGH_FREQUENCY_CADENCE } from "../lib/freshness.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const symbol = url.searchParams.get("symbol");
  const coinId = url.searchParams.get("coinId");
  const timeframe = url.searchParams.get("timeframe") || "1h";
  const limit = Math.min(500, Number(url.searchParams.get("limit") || 100));

  if (!symbol && !coinId) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "symbol_or_coinId_required" }));
    return;
  }

  try {
    const result = await fetchCandles({ symbol, coinId, timeframe, limit });
    const last = result.candles[result.candles.length - 1];
    const freshness = computeFreshness({
      sourceGeneratedAt: last ? new Date(last.t).toISOString() : null,
      nowMs: Date.now(),
      cadence: {
        name: `ohlcv-${timeframe}`,
        freshMs: timeframe === "15m" ? 20 * 60 * 1000 : timeframe === "1h" ? 2 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000,
        staleMs: timeframe === "15m" ? 2 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
      },
    });

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        source: result.provider?.name || "ohlcv",
        metadata: {
          pair: result.pair,
          timeframe,
          approximate: Boolean(result.approximate),
          providers: OHLCV_PROVIDERS,
          fetchedAt: new Date().toISOString(),
        },
        data: {
          candles: result.candles,
          freshness,
          coverage: {
            count: result.candles.length,
            missingVolume: result.candles.filter((c) => c.volume == null).length,
            note: "Volume is exchange/base volume or market total_volume — not trade counts or buying pressure.",
          },
        },
      })
    );
  } catch (err) {
    res.statusCode = err.code === 429 ? 503 : 503;
    res.end(JSON.stringify({ error: "ohlcv_unavailable", detail: sanitizeError(err) }));
  }
}
