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

## Hard gates (copy block, not a hide)

Hard gates decide whether a coin may be copied. They do not remove it from the leaderboard or the research list. Missing evidence fails closed.

| Gate | Block when |
|---|---|
| Contract | honeypot, mintable, transfer pausable, hidden owner, owner can change balances, reclaim ownership, selfdestruct, blacklist function, modifiable tax, cannot buy, creator honeypot history, source not open |
| Tax | buy or sell tax above 10% |
| Liquidity lock | LP holders exist and locked share under 5%, or lock data missing |
| Concentration | any non-excluded holder above 15%, top 10 above 50% after burn / lock / CEX / pair tags, or owner/creator supply above 15% |
| Liquidity | known pool liquidity under $50,000, or liquidity missing |
| Unscanned | no GoPlus result, error, unresolved id, or no EVM contract |

Native L1s (BTC, ETH, SOL, and the other chain assets in `NATIVE_L1_SYMBOLS`) are exempt from ERC20 gates. That exemption is not a trade approval. `copyAllowed` stays false — this app does not send live orders. A clear gate only means the safety checks did not reject the coin.

## Validation status

Comparative A/B/C validation is **pending forward paper tracking**. Do not claim predictive edge.


## Forward validation

Comparative A/B/C evaluation is **pending forward paper tracking**.

```bash
node scripts/validation_forward.js
```

Protocol lives in `data/validation-forward.json`. Do not backtest social using later engagement totals. No predictive edge is claimed.
