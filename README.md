# Crypto Momentum Radar

Research dashboard for transparent crypto momentum rankings, BTC-relative performance, and early technical setups. **Not live trading advice.** High scores do not predict profitable trades.

Live: https://crypto-momentum-radar.vercel.app/

## Freshness root cause (verified)

From **2026-09-02T06:30:58Z**, Vercel cron `/api/momentum/cron` returned **500** `MomentumRedisError` at `acquireLock` while the last good Redis write stayed at **2026-09-02T06:15:06Z**. Stored `data.freshness` remained baked as `fresh` / `ageHours: 0`. HF `/api/high-frequency` stayed live separately.

## Recovery (deployed & verified)

- Freshness recomputed on every read from `sourceGeneratedAt` (shared rules for Redis / peer / static)
- Peer read-through when Redis empty/expired (`MOMENTUM_PEER_URL`, VPS `:3000` healthy)
- Client banner ages live; HF freshness is independent
- Stale/expired → not actionable; confidence capped

## Research APIs

| Endpoint | Purpose |
|---|---|
| `GET /api/momentum` | Rankings + freshness + `btcRelative` |
| `GET /api/high-frequency` | Live scan (own freshness) |
| `GET /api/early-setups` | Coiling/Igniting/… hypothesis detector |
| `GET /api/ohlcv?symbol=BTC&timeframe=1h` | Candles (Binance, CG fallback) |
| `GET /api/social?symbol=SOL` | Traction stub (insufficient without keys) |
| `GET/POST /api/alerts` | Setup alert persistence + paper entry |

Docs: [FRESHNESS.md](docs/FRESHNESS.md) · [RESEARCH.md](docs/RESEARCH.md)

## Env (never commit secrets)

| Var | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Snapshot, lock, alerts (or `KV_REST_API_*`) |
| `CRON_SECRET` | Auth for `/api/momentum/cron` |
| `MOMENTUM_PEER_URL` | Peer sync override |
| `MOMENTUM_SNAPSHOT_KEY` / `LOCK_KEY` / `STATUS_KEY` | Redis key overrides |
| `MOMENTUM_LEGACY_KEYS` | Extra read keys |
| `COINGECKO_API_KEY` | Optional HF / OHLCV |
| `X_BEARER_TOKEN` / `REDDIT_*` / `LUNARCRUSH_API_KEY` / `SANTIMENT_API_KEY` | Optional social |

## Scripts

```bash
npm test
npm run build
```

## Outstanding

- Redis writes from Vercel still fail intermittently (peer read-through masks this) — confirm Upstash REST URL/token and snapshot key
- Cron needs working Redis lock + `CRON_SECRET`
- Social adapters pending until keys provided
- Comparative A/B/C validation = **forward paper tracking** (not claimed)
- Composio Vercel connect link may be needed for alternate deploy path: see agent notes
