Who funded this wallet: the first funder with the funding transaction and amount, plus every funder ranked by total SOL sent. This is the building block behind bundler and insider detection.

Funding is resolved live from our own ledger nodes, not from the indexer. The token-program firehose carries no native SOL, so it could never answer this.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `address` | yes | One to **five** wallet addresses, comma-separated. Each is its own paginated ledger walk, so the cap is low - more than five is rejected rather than quietly truncated. |

```text
GET /data/wallet/funding?chain=solana&address=148HEjLv8JFZYZzduhSitV1VtQHRKLc5auX1RzdyGtxx
```

## What you get back

```json
[
  {
    "wallet": "148HEjLv...",
    "resolved": true,
    "cached": true,
    "first_funder": "9FwgDrjXXrBRyAwNbhzhocvwW4SAJc6K64LVfsxUTegX",
    "first_funded_signature": "sn5eM4urHYRPpJgBEeHukPX2ubUjeuhfYygSZg2QJP9i8H9G5xLGbiqEV4meVVyqb18h",
    "first_funded_time": 1787775698,
    "first_funded_slot": 441944442,
    "first_funded_amount": 100000,
    "funders": [
      { "wallet": "9FwgDrjX...", "total": 4000000, "transfers": 40 },
      { "wallet": "CodeDNrx...", "total": 900000, "transfers": 9 }
    ]
  }
]
```

One row per address you passed, in request order - a wallet with no resolvable funding comes back zeroed rather than missing, so the rows line up with your list.

### Response schema

A bare JSON array, no envelope. The fields below describe one element. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `wallet` | string | The wallet this row is about. |
| `resolved` | boolean | Whether the funding history could actually be read. `true` with an empty `first_funder` means we looked and found no funding transfer; `false` means the ledger scan couldn't finish and every other field is `null`. An unreadable history is not evidence a wallet was never funded. |
| `cached` | boolean | Whether the row came from the `wallet_funding` cache rather than a fresh ledger scan. |
| `reason` | string | Why the lookup failed. Present only when `resolved` is `false`. |
| `first_funder` | string | null | Sender of the **earliest inbound native-SOL transfer** we can see. Token transfers and self-transfers are never funding. `null` when unresolved. |
| `first_funded_signature` | string | null | The transaction that funding arrived in. `null` when unresolved. |
| `first_funded_time` | number (integer) | null | Unix seconds of the first funding transfer. `null` when unresolved. |
| `first_funded_slot` | number (integer) | null | The slot it landed in. `null` when unresolved. |
| `first_funded_amount` | number (integer) | null | Raw lamports. Divide by 1e9 for SOL. `null` when unresolved. |
| `funders` | array of object | null | Every distinct sender of inbound SOL, ranked by total lamports. `null` when unresolved. |
| `funders[].wallet` | string | The sender. |
| `funders[].total` | number (integer) | Raw lamports sent to this wallet in total. Divide by 1e9 for SOL. |
| `funders[].transfers` | number (integer) | How many inbound transfers that total is made of. |

An empty `first_funder` means **unknown**, not unfunded: coverage is bounded by our ledger retention, so a wallet funded before that window resolves to empty rather than to a wrong answer.

One wallet failing no longer fails the whole request - the others still return, and the failing one comes back with `resolved: false`.

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, no `address`, or more than five addresses. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 502 | No ledger node could answer, or the address is not valid base58. |
