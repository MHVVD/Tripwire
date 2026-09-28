The developer behind a token: their wallet, how many tokens they have launched, and how many of those actually graduated. This is the "is this dev a serial launcher" check.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `address` | yes | One token mint. |
| `limit` | no | How many of the dev's other tokens to return. |
| `offset` | no | How many rows to skip before the page starts. Defaults to 0, capped at 10000. Walk it in steps of `limit` to page through the whole list. The response is a bare array, so a page shorter than `limit` is the last one. |

```text
GET /data/token/dev?chain=solana&address=9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump
```

## What you get back

```json
{
  "mint": "9BB6...",
  "creator": "DEVWALLET...",
  "launchpad": "pumpfun",
  "created_time": 1787850000,
  "tokens_launched": 14,
  "migrated": 2,
  "first_launch": 1779300000,
  "last_launch": 1787850000,
  "scanned": 14,
  "truncated": false,
  "tokens": [
    {
      "mint": "9BB6...",
      "name": "Api Token A",
      "symbol": "APITOKA",
      "dex": "pumpfun",
      "created_time": 1787850000,
      "graduated": true,
      "graduated_time": 1787851200,
      "ath_usd": "0.19",
      "ath_time": 1787852000,
      "ath_mcap_usd": "190000",
      "ath_mcap_time": 1787852000,
      "indexed_from_creation": true,
      "price_usd": "0.042",
      "liquidity_usd": "812440",
      "holders": 40248,
      "total_fees_usd": "18422.5",
      "volume_1h_usd": "91244",
      "bundlers_count": 0,
      "is_current": true
    }
  ]
}
```

### Response schema

One object for the creator behind the mint you asked about, with their launches under `tokens`. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `mint` | string | The token mint you asked about. |
| `creator` | string | The wallet that created the token. Tokens whose creation we never indexed have no dev. |
| `launchpad` | string | The venue the queried token launched on. |
| `created_time` | number (integer) | Unix seconds the queried token launched. |
| `tokens_launched` | number (integer) | Distinct mints this wallet created. |
| `migrated` | number (integer) | How many reached a pool on a **different venue** than the launchpad. A pool created on the launchpad itself is not a migration, matching the graduation event. |
| `first_launch` | number (integer) | Unix seconds of the creator's first launch, over their whole history. |
| `last_launch` | number (integer) | Unix seconds of the creator's most recent launch, over their whole history. |
| `scanned` | number (integer) | How many of the dev's launches were actually examined to build this response. |
| `truncated` | boolean | `true` once `scanned` hits the 5,000-launch scan ceiling, meaning the counts above are a floor rather than a total. A serial launcher past that bar reports 5,000, not its real number. |
| `tokens` | array of object | The dev's most recent launches, with the queried mint pulled to the front. |
| `tokens[].mint` | string | That token's mint. |
| `tokens[].name` | string | Token name from the creation record. |
| `tokens[].symbol` | string | Token symbol from the creation record. |
| `tokens[].dex` | string | The launchpad or AMM that launch happened on. |
| `tokens[].created_time` | number (integer) | Unix seconds that token launched. |
| `tokens[].graduated` | boolean | `true` when a pool exists on a venue other than the launchpad. |
| `tokens[].graduated_time` | number (integer) | Unix seconds of the graduation. `0` when it hasn't happened. |
| `tokens[].ath_usd` | string (decimal) | null | All-time-high USD price. |
| `tokens[].ath_time` | number (integer) | null | Unix seconds of the price high. |
| `tokens[].ath_mcap_usd` | string (decimal) | null | All-time-high market cap. **Forward-only**: renders `null` for tokens that predate market-cap stamping, never `"0"`. |
| `tokens[].ath_mcap_time` | number (integer) | null | Unix seconds of the market-cap high. `null` when it wasn't stamped. Price peaks and supply changes are independent, so compare it with `ath_time` before treating the two as one event. |
| `tokens[].indexed_from_creation` | boolean | Whether our history for that mint starts at its creation. The `ath_*` fields are only returned when this is `true`: for a token that was already trading before this deployment started, the highest value we have seen is the high *of our window*, not of the token's life - so we return `null` rather than dress a windowed maximum up as an all-time high. It is recomputed per request, so indexing more history flips the flag on its own and the `ath_*` values start appearing. |
| `tokens[].price_usd` | string (decimal) | The token's current liquidity-weighted USD price. |
| `tokens[].liquidity_usd` | string (decimal) | **Changed.** The token's USD liquidity across all its pools, now counting **both legs** (base plus quote). It used to be the quote leg alone, so it reads roughly double on a balanced pool. |
| `tokens[].holders` | number (integer) | Current holder count, same source as [holders](/docs/api/get_data-token-holders). |
| `tokens[].total_fees_usd` | string (decimal) | Lifetime fees generated by that token, in USD. |
| `tokens[].volume_1h_usd` | string (decimal) | That token's volume over the last hour, in USD. |
| `tokens[].bundlers_count` | number (integer) | How many bundler wallets were detected on that launch. `0` means none were found, which for a launch we indexed is a real answer, not a gap. Carried per token so a serial launcher's pattern is visible across the list without a call per mint. |
| `tokens[].is_current` | boolean | `true` on the one row matching the mint you queried - it is pulled to the front of the list, so this is how you tell it apart without comparing addresses. |

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, or no `address`. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 404 | No creation record for that mint, so there is no dev to report. |
| 502 | The query failed. Retry. |
