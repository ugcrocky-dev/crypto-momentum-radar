# Crypto Momentum Radar

Transparent crypto momentum rankings (UI preserved from production build) with **truthful freshness**.

## What broke (2026-09-02 → 2026-09-18)

Production evidence on `crypto-momentum-radar.vercel.app`:

1. `GET /api/momentum` returned Redis snapshot from **2026-09-02T06:15:06Z** with `metadata.ageMinutes ≈ 23200` but `data.freshness.status: "fresh"` and `ageHours: 0`.
2. Vercel runtime logs: `/api/momentum/cron` every 15 minutes → **500** `MomentumRedisError: Redis command failed` at `acquireLock` since **2026-09-02T06:30:58Z** (first failure immediately after last good write).
3. `GET /api/high-frequency` remained live (`live-coingecko`, generatedAt = now) — separate path.

## This recovery deploy

- Recomputes freshness on every `/api/momentum` read from `sourceGeneratedAt`.
- Caps confidence when stale/expired; keeps last valid snapshot.
- Records refresh attempt/success/failure on Redis.
- Cron recovers stuck locks (no TTL) and syncs a valid snapshot from the healthy VPS peer (`MOMENTUM_PEER_URL`, default `http://108.174.57.19:3000/api/momentum`) instead of leaving rankings frozen.
- High-frequency responses carry their **own** freshness; they never make main rankings look current.
- Client `freshness-guard.js` re-applies age as the page stays open.

## Env (Vercel project — do not commit secrets)

| Var | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Snapshot + lock + status (or `KV_REST_API_*`) |
| `CRON_SECRET` | Auth for `/api/momentum/cron` |
| `MOMENTUM_PEER_URL` | Optional override for peer sync |
| `MOMENTUM_SNAPSHOT_KEY` | Default `momentum:snapshot:v1` |
| `MOMENTUM_LOCK_KEY` | Default `momentum:lock:v1` |
| `MOMENTUM_STATUS_KEY` | Default `momentum:refresh-status:v1` |
| `MOMENTUM_LEGACY_KEYS` | Comma-separated extra Redis keys to try on read |
| `COINGECKO_API_KEY` | Optional for HF scan |

## Scripts

```bash
npm test
npm run build
```

See [docs/FRESHNESS.md](docs/FRESHNESS.md).
