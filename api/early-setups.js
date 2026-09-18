import {
  computeFreshness,
  MAIN_CADENCE,
  sanitizeError,
} from "../lib/freshness.js";
import { enrichRowBtcRelative } from "../lib/btcRelative.js";
import {
  buildEarlySetup,
  buildEarlySetupFromMomentumRow,
  attachFreshnessGate,
} from "../lib/earlySetups.js";
import { fetchCandles } from "../lib/ohlcv.js";

async function loadMomentumRows() {
  const base =
    process.env.MOMENTUM_PEER_URL ||
    "http://108.174.57.19:3000/api/momentum";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(base, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`momentum_http_${res.status}`);
    const json = await res.json();
    return json;
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

  const url = new URL(req.url || "/", "http://localhost");
  const timeframe = url.searchParams.get("timeframe") || "1h";
  const limit = Math.min(30, Number(url.searchParams.get("limit") || 20));
  const withCandles = url.searchParams.get("candles") !== "0";

  const nowMs = Date.now();
  let momentum;
  try {
    momentum = await loadMomentumRows();
  } catch (err) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "momentum_unavailable", detail: sanitizeError(err) }));
    return;
  }

  const sourceGeneratedAt =
    momentum?.data?.sourceGeneratedAt ||
    momentum?.data?.generatedAt ||
    null;
  const freshness = computeFreshness({
    sourceGeneratedAt,
    nowMs,
    cadence: MAIN_CADENCE,
  });
  const regime = momentum?.data?.regime || {};
  const rows = Array.isArray(momentum?.data?.rows) ? momentum.data.rows.slice(0, limit) : [];

  const setups = [];
  for (const row of rows) {
    const enriched = enrichRowBtcRelative(row, regime);
    const shortExcess = enriched.btcRelative?.d7?.excessReturnPp ?? null;

    let setup;
    if (withCandles && row.symbol) {
      try {
        const ohlcv = await fetchCandles({
          symbol: row.symbol,
          coinId: row.id || null,
          timeframe,
          limit: 120,
        });
        setup = buildEarlySetup({
          symbol: row.symbol,
          name: row.name,
          id: row.id || row.symbol,
          timeframe,
          candles: ohlcv.candles,
          momentumRow: row,
          btcShortExcessPp: shortExcess,
          nowMs,
          provisional: Boolean(ohlcv.approximate),
        });
        setup.ohlcv = {
          provider: ohlcv.provider,
          pair: ohlcv.pair,
          approximate: Boolean(ohlcv.approximate),
          candleCount: ohlcv.candles.length,
          lastClosedAt: ohlcv.candles.length
            ? new Date(ohlcv.candles[ohlcv.candles.length - 1].t).toISOString()
            : null,
        };
      } catch (err) {
        setup = buildEarlySetupFromMomentumRow(row, { regime, nowMs, freshness });
        setup.ohlcvError = sanitizeError(err);
      }
    } else {
      setup = buildEarlySetupFromMomentumRow(row, { regime, nowMs, freshness });
    }

    setup = attachFreshnessGate(setup, sourceGeneratedAt, nowMs);
    setup.btcRelative = enriched.btcRelative;
    setups.push(setup);
  }

  const order = { Igniting: 0, Coiling: 1, Confirmed: 2, Failed: 3, Expired: 4 };
  setups.sort((a, b) => {
    const ao = a.state != null ? order[a.state] ?? 9 : 8;
    const bo = b.state != null ? order[b.state] ?? 9 : 8;
    if (ao !== bo) return ao - bo;
    return (b.setupReadiness || 0) - (a.setupReadiness || 0);
  });

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      source: "early-setups",
      metadata: {
        timeframe,
        limit,
        withCandles,
        fetchedAt: new Date(nowMs).toISOString(),
        momentumSource: momentum?.source || null,
      },
      data: {
        generatedAt: new Date(nowMs).toISOString(),
        sourceGeneratedAt,
        freshness: {
          status: freshness.status,
          ageHours: freshness.ageHours,
          ageMinutes: freshness.ageMinutes,
          sourceGeneratedAt: freshness.sourceGeneratedAt,
          evaluatedAt: freshness.evaluatedAt,
          actionable: freshness.actionable,
          ...(freshness.reason ? { reason: freshness.reason } : {}),
        },
        setups,
        methodology: {
          states: ["Coiling", "Igniting", "Confirmed", "Failed", "Expired"],
          note: "Compression is direction-neutral. Setup readiness ≠ directional confidence. Hypothesis weights — not proven optimal. Not trade advice.",
        },
      },
    })
  );
}
