# Research formulas & data sources

## Freshness

See [FRESHNESS.md](./FRESHNESS.md). Shared rules apply to Redis, peer, and static seeds.

## BTC-relative performance

Returns as decimals (`0.10` = +10%):

| Metric | Formula | Label |
|---|---|---|
| Excess return (pp) | `100 × (coinReturn − btcReturn)` | Excess return vs BTC (percentage points) |
| Coin/BTC relative (%) | `100 × ((1 + coinReturn) / (1 + btcReturn) − 1)` | Coin/BTC relative return (%) |

Windows: **7 / 30 / 90** days. **90d is never extrapolated** from shorter windows — show N/A when either side is missing.

Filters (API / research drawer):

- Beating BTC over selected window
- Beating BTC over all *available* windows
- Improving BTC-relative (7d excess > 30d excess)
- Strong momentum without overextension (early-setups `overextended === false`)

## Early setups (hypothesis)

States: `Coiling` → `Igniting` → `Confirmed` | `Failed` | `Expired`

- Compression (BB-width percentile / ATR÷price) is **direction-neutral**
- Resistance from prior bars **excluding** the signal bar
- Confirmed requires closed candles persisting above resistance with volume expansion
- Intrabar / approximate OHLCV → `provisional: true`
- Setup readiness (0–100) ≠ directional confidence

Initial weights (hypothesis, not proven optimal): compression 0.25, volume structure 0.20, higher lows 0.15, distance to resistance 0.15, short BTC-relative 0.15, not overextended 0.10.

## OHLCV providers

| Provider | Use | Cost / access | Notes |
|---|---|---|---|
| Binance public klines | Preferred true OHLC | Free, rate-limited | Pair `SYMBOLUSDT` |
| CoinGecko `market_chart` | Fallback | Free / demo key `COINGECKO_API_KEY` | **Synthetic** OHLC from price buckets — disclosed |

Volume is exchange base volume or CoinGecko `total_volume` — **not** trade counts or buying pressure.

## Derivatives / rotation

Funding and OI shown when present on the snapshot (`market.fundingRate`, `market.openInterestUsd`). Missing → unknown (confidence reduced). Rising OI ≠ buying; rising funding may mean crowded longs.

Leader→follower rotation is a **testable hypothesis**, not an assumption.

## Social / catalysts

Optional providers (not auto-purchased):

| Source | Access | Latency | Cost |
|---|---|---|---|
| X API | OAuth / bearer | seconds–minutes | Paid tiers |
| Reddit | Public JSON / OAuth | minutes | Free–paid |
| LunarCrush | API key | minutes | Paid |
| Santiment | API key | minutes | Paid |

Without keys, traction status is **`insufficient evidence`** (not bearish). AI may summarize retrieved evidence only — never fabricate posts/stats.

## Alerts & paper tracking

- Persist stable `setupId`; never reset original detection/trigger prices on refresh
- Cooldown on duplicate state alerts
- External notifications **disabled** until explicitly enabled
- Paper entry = signal price × (1±slippage) × (1±fees); defaults 5 bps slip + 10 bps fee
- Same-candle stop+target → ambiguous, conservative stop-first

## Watchlist

Default holdings: XRP, AERO, UNI, DOGE, HBAR, ARB, SOL, ETH (editable in research drawer; localStorage). No size/PnL inference.

## Immediate FOMO alerts

Cron (`/api/fomo-alerts/cron`, every minute) and an on-page poller watch [FOMO Robinhood Radar](https://fomoradar.app) for **new** trusted-wallet cohort names. The first pass seeds a baseline without blasting old names. Later new mints are stored, shown under Research → Whales, and optionally pushed.

| Channel | Env | Notes |
|---|---|---|
| In-app banner + browser Notification | none | Works when the site tab is open |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Optional phone push |
| Webhook | `ALERT_WEBHOOK_URL` | Optional POST JSON |

`copyingEnabled` and `autoTrade` stay **false**. Risky coins may still be labeled. This is not automatic FOMO trading.

## Radar product (both feeds)

One research product with two signal feeds. Copying stays off on both.

| Feed | Source | What it shows |
|---|---|---|
| Trusted wallets | [FOMO Robinhood Radar](https://fomoradar.app) public API | Named fomo.family traders on Robinhood Chain, cohort score / conviction / fresh launches |
| Large DEX buys | GeckoTerminal | Buys ≥ $10k on Ethereum, BSC, Base — no wallet profit track record |

GoPlus risk labels (mintable, unlocked LP, and similar) stay as awareness warnings only. Attribution to FOMO Radar is required. Trading money is not spent on paid whale APIs.

Endpoint: `GET /api/radar-product`

## Whale alerts

Large DEX buys from GeckoTerminal (Ethereum, BSC, Base), minimum $10,000. The bought asset is the trade's to-token. Stable-to-stable pools are skipped. Wallet profit history is **not** in this source. `copyingEnabled` stays false. Prefer `/api/radar-product` for the combined product view.

## Validation status

Comparative A/B/C validation is **pending forward paper tracking**. Do not claim predictive edge.


## Forward validation

Comparative A/B/C evaluation is **pending forward paper tracking**.

```bash
node scripts/validation_forward.js
```

Protocol lives in `data/validation-forward.json`. Do not backtest social using later engagement totals. No predictive edge is claimed.
