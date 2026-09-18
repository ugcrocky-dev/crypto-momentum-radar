import {
  computeFreshness,
  MAIN_CADENCE,
  sanitizeError,
} from "../lib/freshness.js";
import { enrichRowBtcRelative } from "../lib/btcRelative.js";
import { enrichRegimeBtcReturns } from "../lib/btcReturns.js";
import {
  buildEarlySetup,
  buildEarlySetupFromMomentumRow,
  attachFreshnessGate,
} from "../lib/earlySetups.js";
import { fetchCandles, lookupCoinGeckoId, resolveCoinGeckoId } from "../lib/ohlcv.js";
import { buildTractionCard } from "../lib/social.js";
import { DEFAULT_WATCHLIST, normalizeWatchlist, prioritizeRows } from "../lib/watchlist.js";

async function loadMomentumRows() {
  const base =
    process.env.MOMENTUM_PEER_URL ||
    "http://108.174.57.19:3000/api/momentum";
  // Prefer same-origin style: try local handler data via peer (works on Vercel)
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

function parseSymbolsParam(raw) {
  if (!raw) return [];
  return normalizeWatchlist(String(raw).split(/[,+\s]+/));
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
  const withSocial = url.searchParams.get("social") === "1";
  const watchOnly = url.searchParams.get("watchlist") === "1";
  // Default ON: prefer holdings / symbols with CG coverage over raw top-rank alts
  // that often fail Binance 451 from Vercel egress.
  const prioritizeHoldings = url.searchParams.get("prioritizeHoldings") !== "0";
  const symbolsParam = parseSymbolsParam(url.searchParams.get("symbols"));
  const focusList = symbolsParam.length ? symbolsParam : DEFAULT_WATCHLIST;

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

  let regime = momentum?.data?.regime || {};
  try {
    const enrichedRegime = await enrichRegimeBtcReturns(regime);
    regime = enrichedRegime.regime;
  } catch {
    /* keep snapshot regime */
  }

  let rows = Array.isArray(momentum?.data?.rows) ? momentum.data.rows.slice() : [];
  if (watchOnly) {
    const set = new Set(focusList);
    rows = rows.filter((r) => set.has(String(r.symbol).toUpperCase()));
  } else if (prioritizeHoldings) {
    rows = prioritizeRows(rows, focusList);
  }
  // Prefer rows that already have a CoinGecko mapping when candle work is requested,
  // so the panel is not dominated by ohlcv_unavailable proxies.
  if (withCandles && prioritizeHoldings) {
    const mapped = [];
    const unmapped = [];
    for (const row of rows) {
      const sym = String(row?.symbol || "").toUpperCase();
      if (lookupCoinGeckoId(sym, row?.id || null)) mapped.push(row);
      else unmapped.push(row);
    }
    rows = [...mapped, ...unmapped];
  }
  rows = rows.slice(0, limit);

  const setups = [];
  for (const row of rows) {
    const enriched = enrichRowBtcRelative(row, regime);
    const shortExcess = enriched.btcRelative?.d7?.excessReturnPp ?? null;

    let setup;
    if (withCandles && row.symbol) {
      try {
        const coinId =
          row.id ||
          (await resolveCoinGeckoId(row.symbol, null)) ||
          null;
        const ohlcv = await fetchCandles({
          symbol: row.symbol,
          coinId,
          timeframe,
          limit: 120,
        });
        setup = buildEarlySetup({
          symbol: row.symbol,
          name: row.name,
          id: row.id || coinId || row.symbol,
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

  // Prefer actionable states first for research review
  const order = { Igniting: 0, Coiling: 1, Confirmed: 2, Failed: 3, Expired: 4 };
  setups.sort((a, b) => {
    const ao = a.state != null ? order[a.state] ?? 9 : 8;
    const bo = b.state != null ? order[b.state] ?? 9 : 8;
    if (ao !== bo) return ao - bo;
    return (b.setupReadiness || 0) - (a.setupReadiness || 0);
  });

  // Traction check only for Coiling/Igniting before entry-review labeling
  if (withSocial) {
    for (const setup of setups) {
      if (setup.state !== "Coiling" && setup.state !== "Igniting") {
        setup.traction = {
          skipped: true,
          reason: "traction_check_only_for_coiling_or_igniting",
        };
        continue;
      }
      try {
        const row = rows.find((r) => r.symbol === setup.symbol);
        setup.traction = await buildTractionCard({
          symbol: setup.symbol,
          name: setup.name,
          change24h: row?.market?.change24h ?? null,
          technicalState: setup.state,
          setupReadiness: setup.setupReadiness,
        });
        // Social never marks ready if technical invalid/stale
        if (setup.freshness?.status !== "fresh" || !setup.state) {
          setup.entryReview = "blocked_technical";
        } else if (setup.traction?.traction === "insufficient evidence") {
          setup.entryReview = "technical_ok_social_unknown";
        } else {
          setup.entryReview = "research_review";
        }
      } catch (err) {
        setup.traction = { error: sanitizeError(err), traction: "insufficient evidence" };
        setup.entryReview = "technical_ok_social_unknown";
      }
    }
  }

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      source: "early-setups",
      metadata: {
        timeframe,
        limit,
        withCandles,
        withSocial,
        prioritizeHoldings,
        focusList,
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
          note: "Compression is direction-neutral. Setup readiness \u2260 directional confidence. Hypothesis weights \u2014 not proven optimal. Not trade advice. Social never overrides invalid technical conditions. When Binance is geo-blocked, CoinGecko approximate OHLC may be used.",
        },
      },
    })
  );
}
