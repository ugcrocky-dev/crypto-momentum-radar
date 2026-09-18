import {
  computeFreshness,
  HIGH_FREQUENCY_CADENCE,
  sanitizeError,
} from "../lib/freshness.js";

const CACHE_TTL_MS = 10_000;
let cache = { at: 0, payload: null };

function classifySide(change1h) {
  if (change1h >= 1.5) return "Upside Acceleration";
  if (change1h <= -1.5) return "Downside Flush";
  return "Chop / Watch";
}

function liquidityTier(volume) {
  if (volume >= 50_000_000) return "deep";
  if (volume >= 5_000_000) return "liquid";
  return "thin";
}

function rankRows(markets) {
  const rows = (markets || [])
    .filter((m) => m && m.symbol && m.current_price != null)
    .map((m) => {
      const change1h = Number(m.price_change_percentage_1h_in_currency ?? 0);
      const change24h = Number(
        m.price_change_percentage_24h_in_currency ??
          m.price_change_percentage_24h ??
          0
      );
      const volume = Number(m.total_volume ?? 0);
      const mcap = Number(m.market_cap ?? 0);
      const pulse = Math.abs(change1h) * 0.7 + Math.abs(change24h) * 0.3;
      const volScore = Math.log10(Math.max(volume, 1));
      const score = pulse * 2 + volScore;
      const symbol = String(m.symbol).toUpperCase();
      return {
        id: m.id,
        symbol,
        name: m.name,
        price: m.current_price,
        change1h,
        change24h,
        volume,
        quoteVolume: volume,
        marketCap: mcap,
        score: Math.round(score * 1000) / 1000,
        image: m.image || null,
        // UI (index bundle) requires side for Tape column className.
        side: classifySide(change1h),
        liquidityTier: liquidityTier(volume),
        market: m.id || symbol,
        alert: null,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  const upside = rows.filter((r) => r.change1h > 0).length;
  const downside = rows.filter((r) => r.change1h < 0).length;
  const deepLiquidity = rows.filter((r) => r.volume >= 5_000_000).length;

  return {
    rows: rows.slice(0, 60),
    summary: {
      source: "coingecko-markets",
      refreshSeconds: 10,
      sourceRows: rows.length,
      returnedRows: Math.min(60, rows.length),
      upsideCount: upside,
      downsideCount: downside,
      deepLiquidityCount: deepLiquidity,
      methodology:
        "Ranks liquid crypto markets by fast pulse move, quote volume, tape activity, range, and liquidity penalties. CoinGecko fallback preserves both 1h and 24h changes.",
    },
    alerts: rows.slice(0, 5).map((r) => ({
      symbol: r.symbol,
      direction: r.change1h >= 0 ? "up" : "down",
      change1h: r.change1h,
    })),
  };
}

async function fetchCoinGecko() {
  const url =
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=1h%2C24h";
  const headers = { Accept: "application/json" };
  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (res.status === 429) {
      const err = new Error("provider_rate_limited");
      err.code = 429;
      throw err;
    }
    if (!res.ok) {
      throw new Error(`provider_http_${res.status}`);
    }
    const markets = await res.json();
    if (!Array.isArray(markets) || markets.length === 0) {
      throw new Error("provider_empty_response");
    }
    return markets;
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const now = Date.now();
  if (cache.payload && now - cache.at < CACHE_TTL_MS) {
    const ageSeconds = Math.round((now - cache.at) / 1000);
    const freshness = computeFreshness({
      sourceGeneratedAt: cache.payload.data.generatedAt,
      nowMs: now,
      cadence: HIGH_FREQUENCY_CADENCE,
    });
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        ...cache.payload,
        source: "live-coingecko-cache",
        metadata: {
          ageSeconds,
          cacheTtlSeconds: CACHE_TTL_MS / 1000,
        },
        data: {
          ...cache.payload.data,
          freshness: {
            status: freshness.status,
            ageSeconds: freshness.ageSeconds,
            ageMs: freshness.ageMs,
            sourceGeneratedAt: freshness.sourceGeneratedAt,
            evaluatedAt: freshness.evaluatedAt,
            actionable: freshness.actionable,
            ...(freshness.reason ? { reason: freshness.reason } : {}),
          },
        },
      })
    );
    return;
  }

  try {
    const markets = await fetchCoinGecko();
    const ranked = rankRows(markets);
    const generatedAt = new Date().toISOString();
    const freshness = computeFreshness({
      sourceGeneratedAt: generatedAt,
      nowMs: Date.now(),
      cadence: HIGH_FREQUENCY_CADENCE,
    });

    const payload = {
      source: "live-coingecko",
      metadata: {
        ageSeconds: 0,
        cacheTtlSeconds: CACHE_TTL_MS / 1000,
      },
      data: {
        schemaVersion: 1,
        generatedAt,
        rows: ranked.rows,
        summary: ranked.summary,
        alerts: ranked.alerts,
        freshness: {
          status: freshness.status,
          ageSeconds: freshness.ageSeconds,
          ageMs: freshness.ageMs,
          sourceGeneratedAt: freshness.sourceGeneratedAt,
          evaluatedAt: freshness.evaluatedAt,
          actionable: freshness.actionable,
        },
      },
    };

    cache = { at: Date.now(), payload };
    res.statusCode = 200;
    res.end(JSON.stringify(payload));
  } catch (err) {
    // Do not clear cache on failure — serve last good HF payload if present
    if (cache.payload) {
      const freshness = computeFreshness({
        sourceGeneratedAt: cache.payload.data.generatedAt,
        nowMs: Date.now(),
        cadence: HIGH_FREQUENCY_CADENCE,
      });
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          ...cache.payload,
          source: "live-coingecko-stale-cache",
          metadata: {
            ageSeconds: Math.round((Date.now() - cache.at) / 1000),
            cacheTtlSeconds: CACHE_TTL_MS / 1000,
            lastError: sanitizeError(err),
          },
          data: {
            ...cache.payload.data,
            freshness: {
              status: freshness.status === "fresh" ? "stale" : freshness.status,
              ageSeconds: freshness.ageSeconds,
              sourceGeneratedAt: freshness.sourceGeneratedAt,
              evaluatedAt: freshness.evaluatedAt,
              actionable: false,
              reason: sanitizeError(err),
            },
          },
        })
      );
      return;
    }

    res.statusCode = err.code === 429 ? 503 : 503;
    res.end(
      JSON.stringify({
        error: "high_frequency_unavailable",
        detail: sanitizeError(err),
      })
    );
  }
}
