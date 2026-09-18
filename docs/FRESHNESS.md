# Freshness rules (Momentum Radar)

## Cadence

| Surface | Intended update | Endpoint |
|---|---|---|
| Main rankings | every **15 minutes** | `/api/momentum` via cron `/api/momentum/cron` |
| High-frequency live scan | ~**10 seconds** cache | `/api/high-frequency` |

## Thresholds (main)

Computed at **request time** (and again in the browser as time passes) from `sourceGeneratedAt`:

| Status | Age | UI / actionability |
|---|---|---|
| `fresh` | < 45 minutes | Normal rankings |
| `stale` | 45 minutes – 3 hours | Warning banner; confidence capped to Low |
| `expired` | ≥ 3 hours | Strong warning; not actionable as current |
| `unknown` | missing / invalid / >5 min future | Error state; never shown as fresh |

## Thresholds (high-frequency)

| Status | Age |
|---|---|
| `fresh` | < 60 seconds |
| `stale` | 60 seconds – 5 minutes |
| `expired` | ≥ 5 minutes |

## Timestamps exposed

- **Last successful data update** — `data.sourceGeneratedAt` / `metadata.createdAt`
- **Last fetch/check** — `metadata.fetchedAt` and `refresh.lastAttemptAt`
- **Age of underlying data** — `data.freshness.ageHours` / `ageMinutes` (recomputed)

A successful HTTP request for an unchanged old Redis snapshot must **not** reset age.

## Observability (`refresh` object on `/api/momentum`)

- `lastAttemptAt`
- `lastSuccessAt`
- `lastFailureAt`
- `lastError` (sanitized)
- `lastRunId`
- `ok`

## Static fallback

`/momentum-snapshot.json` and `data/last-known-snapshot.json` use the **same** freshness rules. Bundled `freshness.status: "fresh"` inside those files is ignored.
