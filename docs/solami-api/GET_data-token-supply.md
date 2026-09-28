Returns the current supply for one or more tokens, read from the mint account, plus market cap and FDV from the latest USD price. This is what fills a market-cap column.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `address` | yes | One mint, or several comma-separated. At most 100. |

```text
GET /data/token/supply?chain=solana&address=9XraX9zhAocVv2zY63KSoV8FLXjjrkSdsCiajtY7bkTb,A4Ma16Xr7fk7VVT8ibyyhY5PGuvUCHCVKMfgAwqwpump
```

## What you get back

```json
[
  {
    "mint": "9XraX9zhAocVv2zY63KSoV8FLXjjrkSdsCiajtY7bkTb",
    "supply": 99999999521288441,
    "decimals": 6,
    "market_cap_usd": "1748946.4318977348",
    "fdv_usd": "1748946.4318977348"
  },
  {
    "mint": "A4Ma16Xr7fk7VVT8ibyyhY5PGuvUCHCVKMfgAwqwpump",
    "supply": 1000000000000000,
    "decimals": 6,
    "market_cap_usd": "990542.1247674959",
    "fdv_usd": "990542.1247674959"
  }
]
```

One object per requested mint, each carrying its own `mint`. Mints we don't know are left out entirely, so match on `mint` rather than position.

### Response schema

One object per resolved mint. A bare JSON array, no envelope. The fields below describe one element. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `mint` | string | The mint this row is for. |
| `supply` | number (integer) | Raw token amount. Divide by `10^decimals`. There are no `minted` or `burned` fields in this response. |
| `decimals` | number (integer) | Divide `supply` by `10^decimals` for the UI amount. |
| `market_cap_usd` | string (decimal) | USD. Supply times the latest price, so it is always the same number as `fdv_usd` here. |
| `fdv_usd` | string (decimal) | USD. Supply times the latest price, so it is always the same number as `market_cap_usd` here. |

## `supply` refreshes every 15 minutes

**Changed.** Supply here comes from a background sweep that reads the mint account directly, at 120 mints a minute with a **15-minute** refresh. It used to sit behind an hour-long cache, so a token that minted or burned could report a stale supply - and a stale market cap with it - for up to an hour.

Nothing about the request changed and there is no parameter to control it. The visible effect is that `supply`, `market_cap_usd` and `fdv_usd` track reality within a quarter of an hour instead of an hour. A mint the sweep has not reached yet falls back to the older cached figure rather than returning nothing.

[security](/docs/api/get_data-token-security) and [intel](/docs/api/get_data-token-intel) read the same sweep, which is what their share-of-supply percentages divide by. [full](/docs/api/get_data-token-full) and [metadata](/docs/api/get_data-token-metadata) still take `supply` from the one-hour metadata cache, so they can be behind this route. When the two disagree, this one is fresher.

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, no `address`, or more than 100 mints. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 502 | The query failed. Retry. |
