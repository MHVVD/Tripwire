Returns the price of one token at, or last before, an exact timestamp. Use it to value a position at a point in time, or to backfill a price you missed.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `address` | yes | One token mint. |
| `time` | yes | Target timestamp, unix seconds. |

```text
GET /data/token/price/at?chain=solana&address=9BB6...&time=1786150000
```

## What you get back

```json
{
  "mint": "9BB6...",
  "block_time": 1786149988,
  "price_usd": "0.039822",
  "price_native": "0.00053071"
}
```

### Response schema

The matched price for the mint. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `mint` | string | The token mint. |
| `block_time` | number (integer) | The timestamp of the trade the price was taken from. At or before your requested `time`, never after - compare it to `time` to see how stale the match is. |
| `price_usd` | string (decimal) | USD price of that trade. |
| `price_native` | string (decimal) | Quote per base for that trade's pool. Not USD. |

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, no `address`, or a bad `time`. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 502 | The query failed. Retry. |
