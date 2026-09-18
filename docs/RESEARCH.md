# Research formulas & data sources

## Freshness

See [FRESHNESS.md](./FRESHNESS.md). Shared rules apply to Redis, peer, and static seeds.

## BTC-relative performance

Returns as decimals (`0.10` = +10%). Excess pp = `100*(coin-BTC)`. Coin/BTC % = `100*((1+coin)/(1+BTC)-1)`. 90d only when both coin and BTC 90d returns exist — never extrapolated.

## Early setups

Hypothesis detector (Coiling / Igniting / Confirmed / Failed / Expired). Not trade advice. OHLCV optional; snapshot-proxy setups available without candles.

## OHLCV

Binance public klines first; CoinGecko market_chart approximate OHLC fallback. Volume is exchange/base or market total_volume — not trade counts or buying pressure.

## Data sources

- Main momentum: Redis snapshot + peer read-through (`MOMENTUM_PEER_URL`)
- High-frequency: CoinGecko markets (1h/24h), ~10s cache
- Cron: peer sync into Redis every 15 minutes
