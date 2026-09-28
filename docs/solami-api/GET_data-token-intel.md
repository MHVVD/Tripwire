Returns the full intel picture for one token: a risk score with flags, plus dev, sniper, bundler, and insider wallets and what each of them bought and still holds. This is what powers a token-safety drilldown.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `address` | yes | One token mint. |
| `sniper_slots` | no | How many slots after launch still count as sniping. Defaults to 5, max 50. |

```text
GET /data/token/intel?chain=solana&address=9BB6...&sniper_slots=5
```

## What you get back

```json
{
  "mint": "9BB6...",
  "score": 2,
  "rugged": false,
  "flags": [
    { "name": "no_socials", "level": "warning", "detail": "no social links in token metadata" }
  ],
  "dev": {
    "wallets": 1,
    "held": 0,
    "initial": 41000000000000,
    "held_pct": "0",
    "initial_pct": "4.1",
    "list": [
      {
        "wallet": "GB1e...",
        "initial": 41000000000000,
        "held": 0,
        "initial_pct": "4.1",
        "held_pct": "0"
      }
    ]
  },
  "snipers": {
    "wallets": 1,
    "held": 0,
    "initial": 9378824719426,
    "held_pct": "0",
    "initial_pct": "0.94",
    "list": [
      {
        "wallet": "7xKX...",
        "initial": 9378824719426,
        "held": 0,
        "initial_pct": "0.94",
        "held_pct": "0",
        "slots_after_launch": 2
      }
    ]
  },
  "bundlers": {
    "wallets": 1,
    "held": 7762275306,
    "initial": 212529032085,
    "held_pct": "0.0008",
    "initial_pct": "0.02",
    "list": [
      {
        "wallet": "DZ8b...",
        "initial": 212529032085,
        "held": 7762275306,
        "initial_pct": "0.02",
        "held_pct": "0.0008",
        "bundle_slot": 361044210
      }
    ]
  },
  "insiders": {
    "wallets": 0,
    "held": 0,
    "initial": 0,
    "held_pct": "0",
    "initial_pct": "0",
    "list": []
  },
  "fees": {
    "total_sol": "66.2",
    "total_usd": "11487.3",
    "tips_usd": "11487.3",
    "trading_usd": "24310.55",
    "total_paid_usd": "35797.85",
    "venues": {
      "jito": { "sol": "66.2", "usd": "11487.3" }
    }
  }
}
```

### Response schema

One object per mint: the score and its flags, then the four cohorts, which all share the same shape. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `mint` | string | The token mint you asked about. |
| `score` | number (integer) | Risk score, 1 to 10. Starts at 1 and each flag adds its weight - **higher is riskier**. |
| `rugged` | boolean | `true` when liquidity is under $100 and lifetime volume is over $10k: the pool was drained after real trading. |
| `flags` | array of object | The risk flags that fired. Empty when none did. |
| `flags[].name` | string | `no_socials`, `mint_authority`, `freeze_authority`, `concentrated`, `dev_exited`, or `no_liquidity`. |
| `flags[].level` | string | `warning` or `danger`. |
| `flags[].detail` | string | One line of plain English saying why it fired. |
| `dev` | object | The token's creator, from the creation record. Empty counts when no creation was recorded. |
| `dev.wallets` | number (integer) | Wallets in the cohort. |
| `dev.held` | number (integer) | Raw token amounts. Apply the mint's `decimals`. What the cohort holds now. |
| `dev.initial` | number (integer) | Raw token amounts. Apply the mint's `decimals`. What the cohort first bought - `0` for a creator who never bought. |
| `dev.held_pct` | string (decimal) | The cohort's current holdings as a percent of supply. Capped at 100. |
| `dev.initial_pct` | string (decimal) | The cohort's initial holdings as a percent of supply. Capped at 100. |
| `dev.list` | array of object | The wallets themselves, at most 10 for `dev`. |
| `dev.list[].wallet` | string | The wallet address. |
| `dev.list[].initial` | number (integer) | Raw token amount the wallet first bought. |
| `dev.list[].held` | number (integer) | Raw token amount it holds now, read live from the balance ledger. |
| `dev.list[].initial_pct` | string (decimal) | That initial amount as a percent of supply. |
| `dev.list[].held_pct` | string (decimal) | That current holding as a percent of supply. |
| `snipers` | object | Wallets whose first buy landed within `sniper_slots` slots of launch. The creator is excluded. Detected over the token's first 5,000 distinct buyers. |
| `snipers.wallets` | number (integer) | Wallets in the cohort. |
| `snipers.held` | number (integer) | Raw token amount the cohort holds now. |
| `snipers.initial` | number (integer) | Raw token amount the cohort first bought. |
| `snipers.held_pct` | string (decimal) | Current holdings as a percent of supply. |
| `snipers.initial_pct` | string (decimal) | Initial holdings as a percent of supply. |
| `snipers.list` | array of object | The wallets themselves, at most 1000 entries. |
| `snipers.list[].wallet` | string | The wallet address. |
| `snipers.list[].initial` | number (integer) | Raw token amount the wallet first bought. |
| `snipers.list[].held` | number (integer) | Raw token amount it holds now. |
| `snipers.list[].initial_pct` | string (decimal) | That initial amount as a percent of supply. |
| `snipers.list[].held_pct` | string (decimal) | That current holding as a percent of supply. |
| `snipers.list[].slots_after_launch` | number (integer) | How many slots after the creation slot the wallet's first buy landed. |
| `bundlers` | object | Wallets whose first buy landed **in the exact creation slot**, bundled with the launch transaction. The creator is excluded. |
| `bundlers.wallets` | number (integer) | Wallets in the cohort. |
| `bundlers.held` | number (integer) | Raw token amount the cohort holds now. |
| `bundlers.initial` | number (integer) | Raw token amount the cohort first bought. |
| `bundlers.held_pct` | string (decimal) | Current holdings as a percent of supply. |
| `bundlers.initial_pct` | string (decimal) | Initial holdings as a percent of supply. |
| `bundlers.list` | array of object | The wallets themselves, at most 1000 entries. |
| `bundlers.list[].wallet` | string | The wallet address. |
| `bundlers.list[].initial` | number (integer) | Raw token amount the wallet first bought. |
| `bundlers.list[].held` | number (integer) | Raw token amount it holds now. |
| `bundlers.list[].initial_pct` | string (decimal) | That initial amount as a percent of supply. |
| `bundlers.list[].held_pct` | string (decimal) | That current holding as a percent of supply. |
| `bundlers.list[].bundle_slot` | number (integer) | The creation slot the buy landed in. |
| `insiders` | object | Wallets that held the token **before its first recorded swap** - they received tokens by transfer before trading existed. The creator and the launch pool are excluded. |
| `insiders.wallets` | number (integer) | Wallets in the cohort. |
| `insiders.held` | number (integer) | Raw token amount the cohort holds now. |
| `insiders.initial` | number (integer) | Raw token amount attributed to the cohort. For insiders this is the held amount at query time, since per-transfer amounts are not stored. |
| `insiders.held_pct` | string (decimal) | Current holdings as a percent of supply. |
| `insiders.initial_pct` | string (decimal) | Initial holdings as a percent of supply. |
| `insiders.list` | array of object | The wallets themselves, at most 1000 entries. |
| `insiders.list[].wallet` | string | The wallet address. |
| `insiders.list[].initial` | number (integer) | The wallet's held amount at query time, raw. |
| `insiders.list[].held` | number (integer) | Raw token amount it holds now. |
| `insiders.list[].initial_pct` | string (decimal) | That initial amount as a percent of supply. |
| `insiders.list[].held_pct` | string (decimal) | That current holding as a percent of supply. |
| `insiders.list[].received_time` | number (integer) | Unix seconds the ledger first saw the wallet holding the token. |
| `fees` | object | null | Tip and fee spend on this token, all-time within the 90-day fees retention. `null` when the fee lookup fails. The full venue split lives on [fees](/docs/api/get_data-token-fees). |
| `fees.total_sol` | string (decimal) | Tips paid across all venues, in SOL. |
| `fees.total_usd` | string (decimal) | The same tips in USD, priced at ingest. |
| `fees.tips_usd` | string (decimal) | The same figure as `total_usd`, kept under both names. |
| `fees.trading_usd` | string (decimal) | The DEX swap fee the pools themselves took, in USD, over the same window. |
| `fees.total_paid_usd` | string (decimal) | `tips_usd` plus `trading_usd` - the real cost of trading this token. |
| `fees.venues` | object | Keyed by venue name (`jito`, `solami`, and the other landing services). |
| `fees.venues.<venue>.sol` | string (decimal) | Tips to that venue, in SOL. |
| `fees.venues.<venue>.usd` | string (decimal) | Tips to that venue, in USD. |

Network and priority fees are not included yet.

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, no `address`, or `sniper_slots` outside 1-50. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 502 | The query failed. Retry. |
