Returns holder count over time for one token, bucketed at the interval you choose. This is what draws a holder-growth chart.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `address` | yes | One token mint. |
| `interval` | no | Bucket size: `1m`, `1h`, or `1d`. Defaults to `1h`. |
| `from`, `to` | no | Time range, unix seconds. |

```text
GET /data/token/holders/chart?chain=solana&address=9BB6...&interval=1h
```

## What you get back

```json
[
  { "time": 1786100400, "holders": 21040, "net_change": 0 },
  { "time": 1786104000, "holders": 21075, "net_change": 35 },
  { "time": 1786107600, "holders": 21103, "net_change": 28 }
]
```

A bare array of buckets, ascending by time. A mint we don't know returns an empty array.

### Response schema

A bare JSON array, no envelope. The fields below describe one element. Every field on a bucket is a whole number, so nothing here is restrung. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `time` | number (integer) | Bucket start, unix seconds. |
| `holders` | number (integer) | Holder count at the end of the bucket. |
| `net_change` | number (integer) | Holders gained minus holders lost within the bucket, i.e. the difference from the previous bucket. The first bucket in the range is `0`. |

For the current top holders, use [holders](/docs/api/get_data-token-holders).

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, no `address`, or an unknown `interval`. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 502 | The query failed. Retry. |
