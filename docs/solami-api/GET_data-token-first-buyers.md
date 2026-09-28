Returns the first buyers of a token, in the order they bought, each with their whole book on it: entry details, buy and sell totals, and PnL. The route returns numbers, not verdicts - classify sniper, insider, or still-holding on your side.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `address` | yes | One token mint. |
| `limit` | no | How many buyers to return. Defaults to 100, max 100. |
| `offset` | no | How many rows to skip before the page starts. Defaults to 0, capped at 10000. Walk it in steps of `limit` to page through the whole list. The response is a bare array, so a page shorter than `limit` is the last one. |

```text
GET /data/token/first-buyers?chain=solana&address=9BB6...&limit=1
```

## What you get back

```json
[
  {
    "wallet": "7xKX...",
    "tags": ["sniper"],
    "first_buy_signature": "29SS...eQMx",
    "first_buy_slot": 361044212,
    "first_buy_time": 1786100001,
    "first_buy_amount": 9378824719426,
    "first_buy_usd": "145.5",
    "slots_after_launch": 2,
    "bought": 9378824719426,
    "sold": 9383860558444,
    "holding": 0,
    "decimals": 6,
    "invested_usd": "145.5",
    "proceeds_usd": "8979.26",
    "realized_usd": "8966.41",
    "unrealized_usd": "0"
  }
]
```

A bare array, ordered by first buy. A mint we don't know returns an empty array.

### Response schema

A bare JSON array, no envelope. The fields below describe one element. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `wallet` | string | The buyer's wallet. |
| `tags` | array | Wallet classification, same source as [intel](/docs/api/get_data-token-intel): `dev`, `bundler`, or `sniper`. Empty when the token's creation record is unknown. |
| `first_buy_signature` | string | Transaction signature of that first buy. |
| `first_buy_slot` | number (integer) | The slot the first buy landed in. |
| `first_buy_time` | number (integer) | Unix seconds. |
| `first_buy_amount` | number (integer) | Raw token amount of the first buy. Apply `decimals`. |
| `first_buy_usd` | string (decimal) | USD volume of that first buy. |
| `slots_after_launch` | number (integer) | Slots between the token's creation slot and this first buy. **`-1` when the creation slot is unknown.** |
| `bought` | number (integer) | Raw token amounts. Apply `decimals`. All-time, from the permanent positions rollup. |
| `sold` | number (integer) | Raw token amounts. Apply `decimals`. `sold` can exceed `bought` when tokens arrived by transfer. |
| `holding` | number (integer) | Raw token amounts. Apply `decimals`. Read from the balance ledger, so it is transfer-aware. |
| `decimals` | number (integer) | Decimal places for the mint, for turning the raw amounts into UI units. |
| `invested_usd` | string (decimal) | USD. What the wallet put in. |
| `proceeds_usd` | string (decimal) | USD. What it took out. |
| `realized_usd` | string (decimal) | USD. Aggregate average-cost realized PnL on the token. |
| `unrealized_usd` | string (decimal) | USD. What the remaining holding is up or down by. |

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, no `address`, or `limit` above 100. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 502 | The query failed. Retry. |
