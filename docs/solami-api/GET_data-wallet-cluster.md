Group a set of wallets by who funded them. Wallets provisioned together by one payer, especially in the same slot, are the signature of a bundle or a sybil set.

Pass the wallets you are looking at, usually a holders or top-traders page. This is deliberately not a global graph walk: it clusters the set you ask about.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `address` | yes | Comma-separated wallet addresses, up to 1000. Addresses aren't validated here - a malformed one goes to the ledger RPC and comes back as a 502, taking the whole request with it. |

```text
GET /data/wallet/cluster?chain=solana&address=148HEjLv...,9FwgDrjX...
```

## What you get back

```json
{
  "requested": 2,
  "resolved": 1,
  "clusters": [
    {
      "funder": "9FwgDrjXXrBRyAwNbhzhocvwW4SAJc6K64LVfsxUTegX",
      "funded": 1,
      "pct_of_requested": "50",
      "same_slot_funded": 0,
      "pct_funded_same_slot": "0",
      "wallets": [
        {
          "wallet": "148HEjLv...",
          "first_funded_slot": 441944442,
          "first_funded_time": 1787775698,
          "first_funded_amount": 100000
        }
      ]
    }
  ]
}
```

### Response schema

The clusters formed over the addresses you passed. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `requested` | number (integer) | How many addresses you passed. |
| `resolved` | number (integer) | How many requested wallets had resolvable funding. The difference is wallets whose first funding predates our ledger coverage - "not determined", which is not the same as "not funded". Only resolved wallets appear in `clusters`. |
| `clusters` | array of object | One entry per distinct first funder, biggest group first. A wallet appears in exactly one cluster, under its own first funder. |
| `clusters[].funder` | string | The shared first funder. |
| `clusters[].funded` | number (integer) | How many of the wallets you passed share this first funder. |
| `clusters[].pct_of_requested` | string (decimal) | `funded / requested x 100` - a share of what you asked about, **not** of the funder's real wallet count. |
| `clusters[].same_slot_funded` | number (integer) | How many of this cluster's wallets were first funded in the same slot as at least one sibling. |
| `clusters[].pct_funded_same_slot` | string (decimal) | Share of that funder's wallets first funded in the **same slot** as at least one sibling. This is the "provisioned together" signal. |
| `clusters[].wallets` | array of object | The cluster's members. |
| `clusters[].wallets[].wallet` | string | The funded wallet. |
| `clusters[].wallets[].first_funded_slot` | number (integer) | The slot its first funding transfer landed in. |
| `clusters[].wallets[].first_funded_time` | number (integer) | Unix seconds of that transfer. |
| `clusters[].wallets[].first_funded_amount` | number (integer) | Raw lamports of that transfer. Divide by 1e9 for SOL. |

Each never-seen wallet costs a ledger lookup, so keep the list to a page's worth. Wallets already resolved by [funding](/docs/api/get_data-wallet-funding) or an earlier cluster call are served from cache.

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, no addresses, or too many addresses. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 502 | No ledger node could answer. |
