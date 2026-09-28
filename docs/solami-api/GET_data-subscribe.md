A WebSocket carrying decoded [Blur](/docs/blur) market events as they happen: trades, transfers, liquidity changes, token launches, new pools, candles, stats, meme events, graduations, volume surges, and token metadata, across every major DEX.

Authenticate with the `api_key` query parameter, since browsers can't set headers on a WebSocket. An `x-api-key` header or `Authorization: Bearer` also works from a server. The key is checked before the upgrade, so a bad one is a plain HTTP 401 rather than a socket that opens and dies.

```text
wss://ws.solami.dev/data/subscribe?chain=solana&api_key=YOUR_KEY&type=swap
```

**Requires:** the `DataApi` permission.

## Narrowing the feed

Set filters as query parameters at connect time. Each list param takes a comma-separated list. Within a field the match is OR, across fields it's AND. Leave them all off and you get the full firehose.

| Query param | What it matches |
|---|---|
| `chain` | Required. `solana`, or the alias `sol`. |
| `type` | Event types: `swap`, `liquidity`, `token_create`, `pool_create`, `transfer`, `candle`, `token_update`, `stats`, `meme`, `graduation`, `surge`, `radar`, `metadata`, plus the five list snapshots `trending`, `movers`, `launches`, `graduating`, `graduated`. |
| `address` | Token mints. On a liquidity event this matches the `base_mint`. |
| `pool` | Pool addresses. |
| `trader` | Wallet addresses. For a liquidity event this is the provider, for a launch the creator. |
| `dex` | DEX names, for example `pumpswap`. |
| `side` | `buy` or `sell`. Swaps only. |
| `min_base` | Minimum base amount, in raw base units. |
| `min_quote` | Minimum quote amount, in raw quote units. |
| `min_volume_usd` | Minimum trade size in USD. Swaps only. |
| `min_progress` / `max_progress` | Bonding-curve progress, 0-100. `meme` only. |
| `min_mcap_at_trigger` / `max_mcap_at_trigger` | Market cap in USD when the signal fired. `surge` and `radar` only. |
| `min_multiple` | Minimum volume multiple over the token's own baseline. `surge` and `radar` only. |
| `backfill` | 0 to 200, default 0. Replay the last N retained events **per type** that match your filter before live streaming starts, oldest first, each tagged `"backfill": true`. |
| `metadata` | `true` (the default) or `false`. Turns the out-of-band `metadata` events on or off. Any other value is a 400. |

A filter that only makes sense for one event type excludes the others once you set it, because their corresponding field is empty or zero. `side=buy` gives you buys and nothing else; `min_volume_usd=500` gives you swaps and nothing else. The three signal filters (`min_progress`, `min_mcap_at_trigger`, `min_multiple` and their `max_` twins) are the exception: events that don't carry the field pass through untouched.

You can change the filter without reconnecting. Send a text message and it replaces the whole filter, so include every field you still want.

```json
{ "filter": { "types": ["swap"], "mints": ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"], "side": "buy" } }
```

The keys here are plural: `types`, `mints`, `pools`, `traders`, `dexes`, `side`, `min_base`, `min_quote`, `min_volume_usd`, `min_progress`, `max_progress`, `min_mcap_at_trigger`, `max_mcap_at_trigger`, `min_multiple`. Anything the socket can't parse as a filter or a `have` message is ignored, so the stream keeps running.

## What you get

Text frames, one decoded event each, tagged with `type`.

Every frame follows the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers. Raw on-chain base units - `base_amount`, `quote_amount`, `base_reserve`, `quote_reserve`, `fee_amount`, `amount` - are integers, not decimals, so they stay JSON numbers too. A value that cannot be a finite number comes back as `null`, never as a string. A **string** field the ingest has no value for is left out of the frame entirely rather than sent as `""`, so read a missing key as "unknown" and not as an empty value. Numbers keep their zeros.

```json
{
  "type": "swap",
  "signature": "5vJ8...oPq2",
  "slot": 341197053,
  "block_time": 1784630336,
  "dex": "pumpswap",
  "pool": "8xQ2...",
  "mint": "6p6x...",
  "quote_mint": "So11111111111111111111111111111111111111112",
  "trader": "9wTz...",
  "side": "buy",
  "base_amount": 16171939364353,
  "quote_amount": 22578268185,
  "base_decimals": 6,
  "quote_decimals": 9,
  "price": "0.0000013961",
  "price_usd": "0.00016428",
  "volume_usd": "3712.4",
  "candle_ok": true
}
```

### swap frame

One confirmed trade, the same shape [GET /data/token/trades](/docs/api/get_data-token-trades) returns a row in.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `swap`. |
| `signature` | string | The transaction the trade landed in. |
| `slot` | number (integer) | Slot the transaction confirmed in. |
| `block_time` | number (integer) | Unix seconds of the block. |
| `dex` | string | The venue, for example `pumpswap`. |
| `pool` | string | The pool the trade went through. |
| `mint` | string | The base token mint. |
| `quote_mint` | string | The quote token mint. |
| `trader` | string | The wallet that traded. |
| `side` | string | `buy` or `sell`, from the trader's perspective. |
| `base_amount` | number (integer) | Raw amount. Apply `base_decimals`. |
| `quote_amount` | number (integer) | Raw amount. Apply `quote_decimals`. |
| `base_decimals` | number (integer) | Decimals of the base mint. |
| `quote_decimals` | number (integer) | Decimals of the quote mint. |
| `base_reserve` | number (integer) | Raw base-side pool reserve after the trade. `0` when the venue doesn't report reserves on a swap. |
| `quote_reserve` | number (integer) | Raw quote-side pool reserve after the trade. `0` when the venue doesn't report reserves on a swap. |
| `fee_amount` | number (integer) | Raw fee taken, in `fee_mint` units. |
| `fee_mint` | string | The mint the fee was taken in. Left out on a fee-less swap. |
| `price` | string (decimal) | Quote per base, decimal-adjusted. |
| `price_usd` | string (decimal) | USD price of the trade. |
| `volume_usd` | string (decimal) | USD size of the trade. |
| `candle_ok` | boolean | `false` when the price guard judged this print an outlier. The trade is real and still streams, but it never touches a candle, so one bad fill can't set a bar's high or low. |

`liquidity` events carry a `kind` of `add` or `remove` plus the `provider`. `token_create` and `pool_create` carry `name`, `symbol`, `uri`, and `creator`, blank on a pool.

```json
{ "type": "liquidity", "signature": "5vJ8...oPq2", "slot": 361050001, "block_time": 1786100210, "dex": "meteora_dlmm", "pool": "8sLb...", "kind": "add", "provider": "9wTz...", "base_mint": "9BB6...", "quote_mint": "So11111111111111111111111111111111111111112", "base_amount": 2670000000, "quote_amount": 95017000000, "base_decimals": 9, "quote_decimals": 6, "base_reserve": 0, "quote_reserve": 0 }
```

### liquidity frame

One add or remove against a pool.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `liquidity`. |
| `signature` | string | The transaction the change landed in. |
| `slot` | number (integer) | Slot the transaction confirmed in. |
| `block_time` | number (integer) | Unix seconds of the block. |
| `dex` | string | The venue. |
| `pool` | string | The pool that changed. |
| `kind` | string | `add` or `remove`. |
| `provider` | string | The wallet that added or removed. This is what the `trader` filter matches on a liquidity event. |
| `base_mint` | string | The base token mint. This is what the `address` filter matches. |
| `quote_mint` | string | The quote token mint. |
| `base_amount` | number (integer) | Raw base amount moved. Apply `base_decimals`. |
| `quote_amount` | number (integer) | Raw quote amount moved. Apply `quote_decimals`. |
| `base_decimals` | number (integer) | Decimals of the base mint. |
| `quote_decimals` | number (integer) | Decimals of the quote mint. |
| `base_reserve` | number (integer) | Raw base-side reserve after the change. `0` when the venue doesn't report it. |
| `quote_reserve` | number (integer) | Raw quote-side reserve after the change. `0` when the venue doesn't report it. |

```json
{ "type": "token_create", "signature": "5vJ8...oPq2", "slot": 361050001, "block_time": 1786100210, "dex": "pumpfun", "mint": "9BB6...", "pool": "8sLb...", "base_mint": "9BB6...", "quote_mint": "So11111111111111111111111111111111111111112", "name": "The Green Bull", "symbol": "BULL", "uri": "https://ipfs.io/ipfs/Qm...", "creator": "EYbh..." }
```

### token_create frame

A new token, seen at its creation instruction. No fractional fields.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `token_create`. |
| `signature` | string | The transaction the token was created in. |
| `slot` | number (integer) | Slot the transaction confirmed in. |
| `block_time` | number (integer) | Unix seconds of the block. |
| `dex` | string | The venue or launchpad it was created on. |
| `mint` | string | The new token mint. |
| `pool` | string | The pool opened alongside it, when there is one. |
| `base_mint` | string | The base token mint of that pool. |
| `quote_mint` | string | The quote token mint of that pool. |
| `name` | string | Token name from the creation instruction. Left out when it carried none. |
| `symbol` | string | Token symbol. Left out when it carried none. |
| `uri` | string | The metadata URI. Left out when it carried none. |
| `creator` | string | The wallet that created the token. This is what the `trader` filter matches on a creation. |

### pool_create frame

The same frame with `"type": "pool_create"` and no `name`, `symbol` or `uri` - a pool has no identity of its own. No fractional fields.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `pool_create`. |
| `signature` | string | The transaction the pool was created in. |
| `slot` | number (integer) | Slot the transaction confirmed in. |
| `block_time` | number (integer) | Unix seconds of the block. |
| `dex` | string | The venue the pool was opened on. |
| `mint` | string | The token the pool is for. |
| `pool` | string | The new pool address. |
| `base_mint` | string | The base token mint. |
| `quote_mint` | string | The quote token mint. |
| `creator` | string | The wallet that opened the pool. |

`transfer` events are plain token movements, covering all SPL Token and Token-2022 activity rather than only what happens inside a swap. `kind` is `transfer`, `mint`, or `burn`; a mint has no `src_owner` and a burn no `dst_owner`.

```json
{ "type": "transfer", "mint": "9BB6...", "src_owner": "7xKX...", "dst_owner": "DZ8b...", "amount": 5000000000000, "decimals": 6, "kind": "transfer", "slot": 361050001 }
```

### transfer frame

One SPL Token or Token-2022 movement. No fractional fields - `amount` is a raw integer quantity, so apply `decimals` yourself.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `transfer`. |
| `signature` | string | The transaction the movement landed in. |
| `slot` | number (integer) | Slot the transaction confirmed in. |
| `block_time` | number (integer) | Unix seconds of the block. |
| `tx_index` | number (integer) | Position of the transaction within the block. |
| `ix_index` | number (integer) | Position of the instruction within the transaction. |
| `inner_ix_index` | number (integer) | Position within the inner instructions, or `-1` for a top-level instruction. |
| `kind` | string | `transfer`, `mint`, or `burn`. |
| `mint` | string | The token that moved. |
| `src_owner` | string | The wallet the tokens left. Left out on a mint. |
| `dst_owner` | string | The wallet the tokens arrived at. Left out on a burn. |
| `amount` | number (integer) | Raw token quantity. Apply `decimals`. |
| `decimals` | number (integer) | Decimals of the mint. `0` on a mint or burn. |
| `indexed_at` | number (integer) | Unix **milliseconds** when the ingest saw the movement. |

`candle` events push OHLCV bars as they build. You get the current bar on every priced trade, then the final one when the first trade of a newer minute lands for that mint and pool. `closed` tells them apart, so chart clients repaint on `false` and commit on `true`. A quiet minute emits nothing until the next trade.

```json
{ "type": "candle", "interval": "1m", "mint": "9BB6...", "pool": "8sLb...", "time": 1786186980, "open": "0.042109", "high": "0.042379", "low": "0.041914", "close": "0.042201", "volume": "51222.14", "trades": 288, "closed": false }
```

### candle frame

One 1-minute bar for a mint and pool, live or final.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `candle`. |
| `mint` | string | The token the bar is for. |
| `pool` | string | The pool the bar is for. Bars are per mint **and** pool, not per mint. |
| `interval` | string | `1m`. The only interval on the socket. |
| `time` | number (integer) | Bar start, unix seconds aligned to the minute. |
| `open` | string (decimal) | USD price at the start of the bar. |
| `high` | string (decimal) | Highest USD price in the bar. |
| `low` | string (decimal) | Lowest USD price in the bar. |
| `close` | string (decimal) | USD price at the end of the bar, or the live price while `closed` is `false`. |
| `volume` | string (decimal) | USD volume across the bar's trades. |
| `trades` | number (integer) | Trade count in the bar. |
| `closed` | boolean | `false` on the updating bar, `true` on the final one. |

`token_update` events are the token header, live: one per priced trade, carrying price, market cap, liquidity and the rolling 5-minute and 1-hour counters, so a token page can move without re-deriving them from raw trades. They pass the same filters a swap does.

```json
{ "type": "token_update", "mint": "9BB6...", "pool": "8sLb...", "dex": "pumpswap", "quote_mint": "So11111111111111111111111111111111111111112", "slot": 361050001, "block_time": 1786100210, "side": "buy", "price_usd": "0.042109", "price_native": "0.00021", "mcap_usd": "42109000", "liquidity_usd": "188400.5", "volume_usd": "812.4", "volume_5m_usd": "88412.55", "trades_5m": 412, "buys_5m": 231, "sells_5m": 181, "volume_1h_usd": "1911245.7", "trades_1h": 5121 }
```

### token_update frame

The derived token header for the swap it follows.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `token_update`. |
| `mint` | string | The token. |
| `pool` | string | The pool the trade went through. |
| `dex` | string | The venue. |
| `quote_mint` | string | The quote token mint. |
| `slot` | number (integer) | Slot of the swap this was derived from. |
| `block_time` | number (integer) | Unix seconds of the block. |
| `side` | string | `buy` or `sell` of the swap it came from. |
| `price_usd` | string (decimal) | USD price after the trade. |
| `price_native` | string (decimal) | Price in the pool's quote asset. `price_usd` is this through the live quote/USD anchor. |
| `mcap_usd` | string (decimal) | null | Market cap. `null` when the ingest has no supply for the mint. |
| `liquidity_usd` | string (decimal) | null | The pool's quote-side reserve after the trade in USD, doubled for two-sided AMMs and taken as-is for bonding curves. `null` when the venue doesn't report reserves on the swap. |
| `volume_usd` | string (decimal) | USD size of this swap. `min_volume_usd` filters on it. |
| `volume_5m_usd` | string (decimal) | Rolling 5-minute USD volume for the mint. |
| `trades_5m` | number (integer) | Rolling 5-minute trade count. |
| `buys_5m` | number (integer) | Rolling 5-minute buy count. |
| `sells_5m` | number (integer) | Rolling 5-minute sell count. |
| `volume_1h_usd` | string (decimal) | Rolling 1-hour USD volume. |
| `trades_1h` | number (integer) | Rolling 1-hour trade count. |

The rolling windows count only what this node has seen since it started, outlier-clean prints only, so after a deploy they ramp for up to an hour. 24-hour figures and unique traders stay on the REST side.

`stats` events are windowed stats snapshots, emitted once a minute per actively-trading mint, the same shape [GET /data/token/stats](/docs/api/get_data-token-stats) gives you on request. The 5-minute and 1-hour windows stream; 24h and unique traders stay on the REST side.

```json
{ "type": "stats", "mint": "9BB6...", "price_usd": "0.042109", "block_time": 1786100210, "windows": { "300": { "volume_usd": "88412.55", "trades": 412, "buys": 231, "sells": 181, "price_change_pct": "2.11" }, "3600": { "volume_usd": "1911245.7", "trades": 5121, "buys": 2711, "sells": 2410, "price_change_pct": "12.4" } } }
```

### stats frame

Rolling per-window stats for one mint.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `stats`. |
| `mint` | string | The token. |
| `price_usd` | string (decimal) | USD price at the time of the snapshot. |
| `block_time` | number (integer) | Unix seconds of the trade that rolled the minute. |
| `windows` | object | Keyed by window seconds - `300` and `3600` on the socket. |
| `windows.<secs>.volume_usd` | string (decimal) | USD volume over the window. |
| `windows.<secs>.trades` | number (integer) | Trade count over the window. |
| `windows.<secs>.buys` | number (integer) | Buy count over the window. |
| `windows.<secs>.sells` | number (integer) | Sell count over the window. |
| `windows.<secs>.price_change_pct` | string (decimal) | Percent price change against the oldest minute bucket in the window. |

`meme` events carry launchpad lifecycle updates, fired whenever bonding-curve progress moves by a percentage point or more. Pair `type=meme` with `min_progress=90` for an "about to graduate" feed.

```json
{ "type": "meme", "mint": "9BB6...", "launchpad": "pumpfun", "metadata": null, "creator": "EYbh...", "created_time": 1786100100, "graduated": false, "progress_pct": "43.1", "price_usd": "0.0000066", "base_reserve": 451157544301090, "quote_reserve": 14032101715, "block_time": 1786100210, "windows": { "300": { "volume_usd": "17629.9", "trades": 448, "buys": 236, "sells": 212, "price_change_pct": "5.2" } } }
```

### meme frame

One bonding-curve update for a token still trading on a launchpad.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `meme`. |
| `mint` | string | The token. |
| `launchpad` | string | The launchpad it is trading on: `pumpfun`, `moonshot`, `boop`, `raydium_launchpad` or `meteora_dbc`. |
| `metadata` | object | null | The token's full metadata record, or `null` when the resolver hasn't got there yet. |
| `metadata.name` | string | Token name. |
| `metadata.symbol` | string | Token symbol. |
| `metadata.decimals` | number (integer) | Decimals of the mint. |
| `metadata.uri` | string | The metadata URI. |
| `metadata.creator` | string | The wallet that created the token. |
| `metadata.logo_uri` | string | The logo from the off-chain metadata. |
| `metadata.description` | string | The description from the off-chain metadata. |
| `metadata.socials` | object | Website, x, telegram, discord, youtube, instagram and tiktok links, each `null` when the token doesn't publish one. |
| `creator` | string | The wallet that launched the token, when the ingest knows the launch. |
| `created_time` | number (integer) | Unix seconds the token launched. `0` when the ingest doesn't know the launch. |
| `graduated` | boolean | `true` once the token has left the curve. |
| `progress_pct` | string (decimal) | Bonding-curve progress, 0 to 100, measured as quote reserves against the 85-SOL graduation target. Approximate. `min_progress` and `max_progress` filter on it. |
| `price_usd` | string (decimal) | USD price on the curve. |
| `base_reserve` | number (integer) | Raw base reserve on the curve. |
| `quote_reserve` | number (integer) | Raw quote reserve on the curve. |
| `block_time` | number (integer) | Unix seconds of the trade that moved progress. |
| `windows` | object | The same rolling windows as the `stats` frame, keyed by window seconds. |
| `windows.<secs>.volume_usd` | string (decimal) | USD volume over the window. |
| `windows.<secs>.trades` | number (integer) | Trade count over the window. |
| `windows.<secs>.buys` | number (integer) | Buy count over the window. |
| `windows.<secs>.sells` | number (integer) | Sell count over the window. |
| `windows.<secs>.price_change_pct` | string (decimal) | Percent price change over the window. |

`metadata` here is `null` until the resolver has the token, which is a "not yet", not a "doesn't exist" - enrichment needs the network and deliberately never blocks the stream. Subscribe to the `metadata` event or call [GET /data/token/metadata](/docs/api/get_data-token-metadata) rather than treating `null` as absent.

`graduation` events fire when a token leaves its launchpad for a real pool on another venue, so `launchpad` and `dex` are never equal. One per mint.

```json
{ "type": "graduation", "mint": "9BB6...", "launchpad": "pumpfun", "creator": "EYbh...", "created_time": 1786100100, "pool": "8sLb...", "dex": "pumpswap", "slot": 361044210, "block_time": 1786100210 }
```

### graduation frame

A launchpad token got an AMM pool. No fractional fields.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `graduation`. |
| `mint` | string | The token that graduated. |
| `launchpad` | string | The launchpad it left. |
| `creator` | string | The wallet that launched it. |
| `created_time` | number (integer) | Unix seconds the token launched. |
| `pool` | string | The new AMM pool. |
| `dex` | string | The venue the new pool is on. Never equal to `launchpad`. |
| `slot` | number (integer) | Slot the pool was created in. |
| `block_time` | number (integer) | Unix seconds of the block. |

`surge` and `radar` events fire when a token's own volume breaks out against its own recent baseline, so a quiet token waking up registers the same as a loud one getting louder:

```json
{ "type": "surge", "mint": "9BB6...", "trigger_time": 1786100210, "mcap_at_trigger": "412903.55", "price_at_trigger": "0.0004129", "volume_window_usd": "84210.12", "baseline_usd": "21050.03", "multiple": "4", "trades": 318, "traders_est": 47, "window_secs": 300 }
```

### surge / radar frame

Both types carry exactly these fields; only `type` and `window_secs` differ.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `surge` or `radar`. |
| `mint` | string | The token that broke out. |
| `trigger_time` | number (integer) | Unix seconds the signal fired. |
| `mcap_at_trigger` | string (decimal) | USD market cap at trigger time. `min_mcap_at_trigger` and `max_mcap_at_trigger` filter on it. |
| `price_at_trigger` | string (decimal) | USD price at trigger time. |
| `volume_window_usd` | string (decimal) | USD volume inside the window. Note this is not `volume_usd`, so `min_volume_usd` does not apply. |
| `baseline_usd` | string (decimal) | The pre-window volume rate rescaled to the window length, floored at $100 for a `surge` and $600 for a `radar` so a near-zero baseline can't manufacture a huge `multiple`. |
| `multiple` | string (decimal) | `volume_window_usd` divided by `baseline_usd`. `min_multiple` filters on it. |
| `trades` | number (integer) | Trade count inside the window. |
| `traders_est` | number (integer) | Approximate distinct traders in the window, from a 64-bit sketch. It saturates well below the true number on a busy window. |
| `window_secs` | number (integer) | `300` for a `surge`, `1800` for a `radar`. |

Both are the same signal on two clocks, and `window_secs` tells them apart. A `surge` compares the last 5 minutes against the past hour and fires at 3x or more; `radar` compares the last 30 minutes against the past 6 hours at a lower bar, catching a steady climb that a 5-minute window smooths over. Each mint then goes quiet for a cooldown, so one move produces one event, not a stream of them. A token needs enough history to have a baseline at all, so a brand-new launch cannot surge on its first minute.

Filter them with `min_multiple` for conviction and `min_mcap_at_trigger` to skip micro-cap noise. `traders_est` is an estimate, not an exact count.

`metadata` events carry token identity and off-chain enrichment, resolved out of band. You get one per mint the first time it appears on your stream, which is after that mint's creation or first trade, never before.

```json
{ "type": "metadata", "mint": "9BB6...", "name": "The Green Bull", "symbol": "BULL", "decimals": 6, "uri": "https://ipfs.io/ipfs/Qm...", "image_url": "https://api.solami.dev/data/token/image/9BB6...?api_key=YOUR_KEY", "logo_uri": "https://...", "description": "...", "socials": { "website": "...", "x": "...", "telegram": "...", "discord": "...", "youtube": "...", "instagram": "...", "tiktok": "..." }, "resolved_at": 1786100210412, "catchup": true }
```

### metadata frame

One resolved token identity. No fractional fields.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `metadata`. |
| `mint` | string | The token. |
| `name` | string | Token name. |
| `symbol` | string | Token symbol. |
| `decimals` | number (integer) | Decimals of the mint. |
| `uri` | string | The metadata URI the enrichment was read from. |
| `image_url` | string | The token's logo served from our own domain, keyed with the API key this socket connected with, and on the matching regional host. Use it instead of `logo_uri` for rendering; the bytes are billed to your account when you fetch them. Left out when the token has no logo. |
| `logo_uri` | string | The logo as the token itself publishes it. |
| `description` | string | The description from the off-chain metadata. |
| `socials` | object | Social links, each left out when the token doesn't publish one. |
| `socials.website` | string | Website. |
| `socials.x` | string | X / Twitter. |
| `socials.telegram` | string | Telegram. |
| `socials.discord` | string | Discord. |
| `socials.youtube` | string | YouTube. |
| `socials.instagram` | string | Instagram. |
| `socials.tiktok` | string | TikTok. |
| `resolved_at` | number (integer) | Unix **milliseconds** the resolver finished. |
| `catchup` | boolean | `true` when the record came from storage rather than a resolution happening right now. Absent on a live resolution. |

`resolved_at` is unix **milliseconds**, not seconds - it's a resolver timestamp, not a block time. A `catchup: true` flag means the record came from storage because the mint showed up on your filter, rather than from a resolution happening right now; a live resolution arrives without it.

If you already hold metadata for some mints, say so and the server skips them. Send this at any time; it's cumulative.

```json
{ "have": ["9BB6...", "6p6x..."] }
```

Or turn the whole thing off at connect with `metadata=false`.

Switch on `type` and ignore ones you don't recognise, so new event types don't break your client.

We send a WebSocket ping every 30 seconds. Standard clients answer it for you. Pings are not metered.

Delivered bytes are metered every five seconds against your [streaming bandwidth](/docs/streaming-bandwidth), then your balance. The upgrade is only accepted if you hold at least 64 KiB of prepaid bandwidth or $0.06 of balance.

## Filling the page on connect

The socket opens with `{ "type": "connected", "region": "fra", "filter": { ... } }`, which echoes the filter the server read out of your query string, so you know the stream is live and parsed the way you meant it before any data arrives.

Then, for every list type your filter admits, one snapshot each: the current `trending` (windows 300, 3600 and 86400), `movers` (gainers and losers over the same three windows), `launches`, `graduating` and `graduated` - the same top 50 the matching REST route returns. An empty filter gets all twelve; `type=swap` gets none. After that the lists are never resent. They're kept current by single-token `enter`, `update` and `exit` frames on a 30-second clock, so apply those to your snapshot and you hold an exact copy of the server's list.

```json
{ "type": "graduating", "event": "snapshot", "min_progress_pct": "70", "generated_at": 1786100240,
  "rows": [ { "mint": "9BB6...", "name": "The Green Bull", "symbol": "BULL", "launchpad": "pumpfun", "progress_pct": "91.5", "price_usd": "0.0000112", "volume_usd": "48210.5", "created_time": 1786099957 } ] }
```

```json
{ "type": "graduating", "event": "enter",  "rank": 7,    "generated_at": 1786100270, "min_progress_pct": "70", "mint": "6p6x...", "progress_pct": "71.2" }
{ "type": "graduating", "event": "exit",   "rank": null, "generated_at": 1786100270, "min_progress_pct": "70", "mint": "9BB6..." }
```

A single carries the whole row flattened onto the frame, next to `event` and `rank`, rather than nested under `rows`. An `exit` carries only the `mint`. The snapshot itself has no `mint`, so any mint, pool, trader, dex or `min_*` filter excludes it; singles do carry `mint`, so a socket filtered to one address still receives that token's movements through every list.

Add `backfill=N` and you also get the last N retained events per type that match your filter, oldest first, each tagged `"backfill": true`. The connect phase then ends with a `backfill_end` frame, so you know the page is complete and everything after it is live.

```json
{ "type": "backfill_end", "events": 143 }
```

### trending frame

The volume leaderboard. Rows are the same shape [GET /data/token/trending](/docs/api/get_data-token-trending) returns.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `trending`. |
| `event` | string | `snapshot`, `enter`, `update` or `exit`. |
| `window` | number (integer) | Lookback in seconds: `300`, `3600` or `86400`. Singles carry it too, so one socket can track all three windows. |
| `sort` | string | `volume`. What the list is ranked by. |
| `generated_at` | number (integer) | Unix seconds the list was computed. |
| `rank` | number (integer) | null | 1-based position in the list, on singles only. `null` on an `exit`. |
| `rows` | array of object | The top 50, best first. On the `snapshot` frame only - a single carries these same fields flattened onto the frame itself. |
| `rows[].mint` | string | The token mint. |
| `rows[].name` | string | Token name. `""` when we have none. |
| `rows[].symbol` | string | Token symbol. `""` when we have none. |
| `rows[].image` | string | Token logo. `""` when we have no logo for it. |
| `rows[].price_usd` | string (decimal) | Liquidity-weighted USD price across the token's pools. |
| `rows[].price_change_pct` | string (decimal) | Percent price change over the window. |
| `rows[].volume_usd` | string (decimal) | USD volume over the window. |
| `rows[].trades` | number (integer) | Trade count over the window. |
| `rows[].buys` | number (integer) | Buy count over the window. |
| `rows[].sells` | number (integer) | Sell count over the window. |
| `rows[].traders` | number (integer) | Distinct traders over the window. |
| `rows[].liquidity_usd` | string (decimal) | USD liquidity across all the token's pools, counting both legs. |
| `rows[].market_cap_usd` | string (decimal) | Supply times the window's USD close. `"0"`, never null, when the supply can't be resolved yet. |
| `rows[].created_time` | number (integer) | Unix seconds the token launched. `0` for tokens older than our index. |

### movers frame

The same rows as `trending`, ranked by price change instead of volume, and split by direction.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `movers`. |
| `event` | string | `snapshot`, `enter`, `update` or `exit`. |
| `window` | number (integer) | Lookback in seconds: `300`, `3600` or `86400`. |
| `direction` | string | `gainers` or `losers`. Each direction is its own list, so you get six snapshots. |
| `generated_at` | number (integer) | Unix seconds the list was computed. |
| `rank` | number (integer) | null | 1-based position, on singles only. `null` on an `exit`. |
| `rows` | array of object | The top 50. Every `rows[]` field is exactly as listed for `trending` above. |

### launches frame

The newest launchpad tokens. No fractional fields.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `launches`. |
| `event` | string | `snapshot`, `enter`, `update` or `exit`. |
| `generated_at` | number (integer) | Unix seconds the list was computed. |
| `rank` | number (integer) | null | 1-based position, on singles only. `null` on an `exit`. |
| `rows` | array of object | The 50 newest launches, newest first. |
| `rows[].mint` | string | The token mint. |
| `rows[].name` | string | Token name. |
| `rows[].symbol` | string | Token symbol. |
| `rows[].uri` | string | The metadata URI. |
| `rows[].creator` | string | The wallet that launched it. |
| `rows[].launchpad` | string | The launchpad it was created on. |
| `rows[].slot` | number (integer) | Slot the creation confirmed in. |
| `rows[].block_time` | number (integer) | Unix seconds the token launched. |

### graduating frame

Tokens closest to leaving their bonding curve.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `graduating`. |
| `event` | string | `snapshot`, `enter`, `update` or `exit`. |
| `min_progress_pct` | string (decimal) | The progress floor the list applies, `"70"` by default. |
| `generated_at` | number (integer) | Unix seconds the list was computed. |
| `rank` | number (integer) | null | 1-based position, on singles only. `null` on an `exit`. |
| `rows` | array of object | The 50 highest by curve progress. |
| `rows[].mint` | string | The token mint. |
| `rows[].name` | string | null | Token name, `null` when unresolved. |
| `rows[].symbol` | string | null | Token symbol, `null` when unresolved. |
| `rows[].launchpad` | string | null | The launchpad it is trading on. |
| `rows[].progress_pct` | string (decimal) | Bonding-curve progress, 0 to 100. |
| `rows[].price_usd` | string (decimal) | USD price on the curve. |
| `rows[].volume_usd` | string (decimal) | USD volume so far. |
| `rows[].created_time` | number (integer) | Unix seconds the token launched. |

### graduated frame

Tokens that just got an AMM pool.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `graduated`. |
| `event` | string | `snapshot`, `enter`, `update` or `exit`. |
| `generated_at` | number (integer) | Unix seconds the list was computed. |
| `rank` | number (integer) | null | 1-based position, on singles only. `null` on an `exit`. |
| `rows` | array of object | The 50 most recent graduations, newest first. |
| `rows[].mint` | string | The token mint. |
| `rows[].name` | string | null | Token name, `null` when unresolved. |
| `rows[].symbol` | string | null | Token symbol, `null` when unresolved. |
| `rows[].launchpad` | string | null | The launchpad it left. |
| `rows[].graduated_time` | number (integer) | Unix seconds the AMM pool was created. |
| `rows[].pool` | string | The new pool. |
| `rows[].dex` | string | The venue the new pool is on. |
| `rows[].price_usd` | string (decimal) | USD price in the new pool. |
| `rows[].liquidity_usd` | string (decimal) | USD liquidity in the new pool. |

### backfill_end frame

Sent once, when the connect phase is done. It arrives whenever you asked for `backfill` or at least one snapshot went out.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `backfill_end`. |
| `events` | number (integer) | How many backfilled events preceded it. |

Note the distinction between the event types and the list types: `graduation` is the live "this token just got a pool" event at trade latency, while `graduated` is the page of recent ones on the 30-second clock. Likewise `token_create` against `launches`, and `meme` - every bonding-curve move - against `graduating`, which is membership of the top 50 by progress.

## Replay

Add `from` and `to` (unix seconds) to stream a slice of history over the same socket, as if it were live, for backtesting and demos. `speed` scales the clock; `speed=10` plays an hour in six minutes. For example, a launch hour at 10x speed:

```text
wss://ws.solami.dev/data/subscribe?chain=solana&api_key=YOUR_KEY&type=swap&address=9BB6...&from=1786100000&to=1786103600&speed=10
```

| Param | Rules |
|---|---|
| `from` / `to` | Unix seconds. `to` is required whenever `from` is present, `from` must be less than `to`, and the span is at most 24 hours. |
| `speed` | 1 to 1000, default 10. Gaps between trades are divided by it, then capped at 5 seconds, so a dead hour never stalls the stream. |
| `address` | At least one mint is required. The other filters apply as usual. |

Replay streams swaps only. Each message is a full swap row - the [token trades](/docs/api/get_data-token-trades) shape, including `tx_index`, `ix_index`, `inner_ix_index`, fees, and `price_impact_pct` - with `"type": "swap"` and an extra `"replay": true`. It follows the same numbers convention as a live swap frame: `price`, `price_usd`, `volume_usd`, `fee_pct` and `price_impact_pct` are decimal strings, raw amounts and reserves are integers. The stream ends with `{"type":"replay_end"}` and then a normal close. It is capped at 500,000 rows, and billed per delivered byte exactly like a live stream.

### replay_end frame

The last frame of a replay, immediately before a normal close.

| Field | Type | What it is |
|---|---|---|
| `type` | string | `replay_end`. |

## What can go wrong

Before the socket opens:

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, an unparseable `metadata` value, or a replay range that breaks the rules above (`to` missing, `from` past `to`, span over 24h, `speed` outside 1-1000, or no `address`). |
| 401 | No API key on the request, or the key isn't valid. |
| 403 | The key lacks `DataApi`. |

Once the socket is open:

| Close code | Meaning |
|---|---|
| 1000 | Normal close. A replay sends this once it has played the whole range. |
| 1011 | A replay's history query failed. Retry. |
| 4002 | No bandwidth left and your balance is empty. Buy bandwidth with [POST /bandwidth/buy](/docs/api/post_bandwidth-buy) or top up. Sent at connect time or mid-stream. |
