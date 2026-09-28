Returns the most active tokens over a lookback window, ranked by volume, traders, or trades. This is what fills a trending board.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `window` | no | How far back to look, in seconds. Defaults to 3600. |
| `sort` | no | `volume`, `traders`, or `trades`. Defaults to `volume`. |
| `min_liquidity_usd` | no | Exclude tokens below this USD liquidity. |
| `limit` | no | How many tokens to return. 1 to 100, defaults to 50. |
| `offset` | no | How many rows to skip before the page starts. Defaults to 0, capped at 10000. Walk it in steps of `limit` to page through the whole list. The response is a bare array, so a page shorter than `limit` is the last one. |
| `enrich` | no | `true` to attach the complete `/data/token/full` payload for each token, under a `token` key. It is literally the same payload - the route calls the same builder - so the two cannot drift. Nested under `token` rather than flattened because `full` also defines `name`, `price_usd`, `liquidity_usd`, `market_cap_usd` and `created_time`, which already mean something narrower on the row. Capped at the first 25 rows. Defaults to `false`, and when false the key is omitted entirely. |

```text
GET /data/token/trending?chain=solana&window=3600&limit=1
```

## What you get back

```json
[
  {
    "mint": "9BB6...",
    "name": "Peanut the Squirrel",
    "symbol": "PNUT",
    "image": "https://ipfs.io/ipfs/QmXe...",
    "price_usd": "0.042109",
    "price_change_pct": "12.4",
    "volume_usd": "1911245.7",
    "trades": 15211,
    "buys": 8402,
    "sells": 6809,
    "traders": 3120,
    "liquidity_usd": "812440",
    "market_cap_usd": "42106524",
    "created_time": 1786099957
  }
]
```

### Response schema

A bare JSON array, no envelope. The fields below describe one element. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `mint` | string | The token mint. |
| `name` | string | Token name from the metadata dimension. `""` when we have none. |
| `symbol` | string | Token symbol. `""` when we have none. |
| `image` | string | Token logo from the metadata dimension. `""` when we have no logo for it. |
| `price_usd` | string (decimal) | Liquidity-weighted USD price across the token's pools - the current price, not the window's close. |
| `price_change_pct` | string (decimal) | Percent price change over the requested `window`. |
| `volume_usd` | string (decimal) | USD volume over the requested `window`. |
| `trades` | number (integer) | Trade count over the `window`. `buys` plus `sells` equals `trades`. |
| `buys` | number (integer) | Buy count over the `window`. |
| `sells` | number (integer) | Sell count over the `window`. |
| `traders` | number (integer) | Distinct traders over the `window`. |
| `liquidity_usd` | string (decimal) | **Changed.** The token's USD liquidity across all its pools, now counting **both legs** (base plus quote). It used to be the quote leg alone, so it reads roughly double on a balanced pool - re-check any saved threshold built on it. See [pool](/docs/api/get_data-pool) for the legs separately. `min_liquidity_usd` filters on the same number. |
| `market_cap_usd` | string (decimal) | Supply times the window's USD close. `"0"`, never null, when the supply can't be resolved yet. |
| `created_time` | number (integer) | Unix seconds the token launched. `0` for tokens that launched before Blur started indexing. |
| `token` | object | Only with `enrich=true`, and only on the first 25 rows: the complete [full](/docs/api/get_data-token-full) payload for the mint. Omitted entirely otherwise. |

For ranking by price change instead of activity, use [movers](/docs/api/get_data-token-movers). For arbitrary sorts and filters, use [list](/docs/api/get_data-token-list).

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, or a bad `sort`, `window`, or `limit`. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 502 | The query failed. Retry. |
