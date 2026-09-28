Returns a security snapshot for one token: mint and freeze authorities, Token-2022 extensions, and how concentrated the supply is. This is what fills a rug-check panel.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `address` | yes | One token mint. No comma-separated list. |

```text
GET /data/token/security?chain=solana&address=9BB6...
```

## What you get back

```json
{
  "mint": "A4Ma16Xr7fk7VVT8ibyyhY5PGuvUCHCVKMfgAwqwpump",
  "mint_authority": null,
  "freeze_authority": null,
  "token2022": true,
  "extensions": ["transfer_fee_config", "metadata_pointer"],
  "transfer_fee_pct": null,
  "non_transferable": false,
  "total_tax_pct": "0.8624682655091331",
  "tax_breakdown": {
    "transfer_fee_pct": "0",
    "swap_fee_pct": "0.8480197552912072",
    "tip_pct": "0.014448510217925951"
  },
  "creator": "FiwwHe2obYsFoxprUXRWdAgHxMfKwK7ca9YB3g8bmX13",
  "creator_pct": "0",
  "top10_pct": "12.3978574698259"
}
```

### Response schema

One object for the mint you asked about. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `mint` | string | The token mint you asked about. |
| `mint_authority` | string | null | `null` means revoked, which is the safe state. |
| `freeze_authority` | string | null | `null` means revoked, which is the safe state. |
| `token2022` | boolean | `true` when the mint is a Token-2022 mint rather than a classic SPL one. |
| `extensions` | array | The Token-2022 extensions enabled on the mint, by name. An **empty array** on a classic SPL mint, which has none. This is where a transfer hook or a permanent delegate shows up, so read it before assuming a token behaves like a normal SPL one. |
| `transfer_fee_pct` | string (decimal) | null | Only non-null for Token-2022 mints with a transfer fee. |
| `non_transferable` | boolean | `true` for a soulbound Token-2022 mint that cannot be moved at all. |
| `metadata_mutable` | boolean | null | Whether the metadata account can still be rewritten. `null` when there is none to read. |
| `total_tax_pct` | string (decimal) | null | What trading this token actually costs, as a percent: the sum of the three parts in `tax_breakdown`. `null`, never `"0"`, when the realized figures could not be computed. |
| `tax_breakdown` | object | null | An object of `transfer_fee_pct`, `swap_fee_pct` and `tip_pct`. Goes `null` as a whole object when the realized figures could not be computed. |
| `tax_breakdown.transfer_fee_pct` | string (decimal) | The **configured** Token-2022 transfer fee on the mint, the same rate as the top-level field. `"0"` rather than `null` for a mint without the extension, because the breakdown has to sum. |
| `tax_breakdown.swap_fee_pct` | string (decimal) | Swap fees paid in USD over the last 24h, divided by volume in USD. Clamped to 0-100. |
| `tax_breakdown.tip_pct` | string (decimal) | Tips paid in USD over the last 24h, divided by volume in USD. Clamped to 0-100. |
| `creator` | string | The wallet recorded on the token's creation instruction. Empty when we never saw the token launch. |
| `creator_pct` | string (decimal) | Percent of supply held by the creator, from current holder balances. Capped at 100. |
| `top10_pct` | string (decimal) | Percent of supply held by the ten largest holders, from current holder balances. **AMM pool and bonding-curve accounts are excluded from the holder set**, so this is concentration among actual holders. Capped at 100. See below. |

`metadata_mutable` and `lp_burn_pct` are not part of this response. For LP burn use [pool](/docs/api/get_data-pool) or [token pools](/docs/api/get_data-token-pools), which report `lp_burn_pct` per pool.

For the full holder list, use [holders](/docs/api/get_data-token-holders).

## `top10_pct` excludes the pools

**Changed, and it changes the number.** A pool account is the counterparty everyone trades against, not a holder with a position, so pool and bonding-curve accounts no longer count toward the holder set on this route or on [holders](/docs/api/get_data-token-holders), [full](/docs/api/get_data-token-full) and [screener](/docs/api/get_data-token-screener).

While they were counted, a young token's own curve was its largest "holder" by an order of magnitude, and `top10_pct` read around 85% on a typical fresh launch where concentration among real holders was under 20%. On a rug-check panel that is the difference between a token that looks fatally concentrated and one that looks ordinary, and the old reading was the wrong one.

**This is a definition change, not a data change.** No balance moved on chain. Concentration figures stored from before the change are not comparable with new ones, so re-baseline any threshold built on this column: an alert at `top10_pct > 50` now fires far less often, and correctly so.

## What the tax figures mean

`tax_breakdown` mixes one posted rate with two measured ones, and the difference is the useful part:

| Part | Where it comes from |
|---|---|
| `transfer_fee_pct` | The **configured** Token-2022 transfer fee on the mint - a rate the token declares. `"0"` for any mint without the extension. |
| `swap_fee_pct` | **Realized over the last 24h**: swap fees paid in USD divided by volume in USD. Clamped to 0-100. |
| `tip_pct` | **Realized over the last 24h**: tips paid in USD divided by volume in USD. Clamped to 0-100. |

Two of the three are what traders actually paid over the day, not what anyone advertises. That is deliberate: a token can post no fee and still cost several percent to get out of, and a posted rate would never show it. It also means the numbers move with the window, so the same token can read differently an hour later.

`total_tax_pct` is the three added together. A Token-2022 mint with a real transfer fee has it counted once in the total and once in the breakdown, not twice. A mint with a genuinely punitive configured fee reads exactly that: a live Token-2022 mint with a 76% transfer fee returns `"transfer_fee_pct": "76"` and `"total_tax_pct": "76"`.

### The realized parts are bounded now

**Changed.** `swap_fee_pct` and `tip_pct` are each clamped to **0-100**, and both report **`"0"` when the token traded less than $1 of volume** in the 24h window.

Previously a ratio against a near-zero denominator - volume as small as a fraction of a cent - produced figures with no meaning, and `total_tax_pct` could come back as `3.4e+177` percent. 95 of 5,827 mints carried an unusable number. If you were clamping this field yourself, or hiding it, you no longer need to.

A dollar of volume is not a statistical threshold, it is a floor below which the ratio carries no information at all. Read `"0"` on a very quiet token as "not measurable from a day this thin", not as "free to trade" - the same reading you would give any realized figure computed from almost no trades. Everything above the floor is a real measurement.

Here is a live mint that traded under a dollar in the window:

```json
{
  "mint": "wDVM7dNw7DHQku2Ge4bk27x9zt4SUrgNkbXPsxgpump",
  "total_tax_pct": "0",
  "tax_breakdown": { "transfer_fee_pct": "0", "swap_fee_pct": "0", "tip_pct": "0" },
  "creator_pct": "0",
  "top10_pct": "49.5612166732425"
}
```

**Both `total_tax_pct` and `tax_breakdown` are `null`, never `"0"`, when the realized figures cannot be computed at all** - a failed query rather than a thin window. `null` means unknown; `"0"` means we looked. Do not render `null` as "0% tax". Note that `tax_breakdown` goes null as a whole object rather than per field; the configured `transfer_fee_pct` is still readable at the top level in that case.

## Share of supply is capped at 100

**Changed.** `top10_pct`, `creator_pct` and the cohort percentages on [full](/docs/api/get_data-token-full) and [intel](/docs/api/get_data-token-intel) can no longer exceed `100`.

They used to. A share above 100 is not a real reading - it means the holder balances we have observed are ahead of the supply figure we are dividing by. That happens for an account that has not traded since we last observed its balance: the balance is a snapshot, the supply is a snapshot, and the two are not always taken at the same instant. Continuous ingestion resolves it on its own within a refresh. The cap is a floor under nonsense, not a correction to the underlying balances, which were never wrong.

A token reading exactly `"100"` is therefore ambiguous: it can be a genuinely fully-concentrated token, or a token whose observed balances briefly ran ahead of its supply. Treat `"100"` as "at or above the whole supply" rather than as a precise measurement.

## Which supply this route divides by

**Changed.** `creator_pct` and `top10_pct` here are computed against supply from the mint-account sweep, which now refreshes roughly every **15 minutes**. It used to sit behind an hour-long cache.

One thing to know if you read both routes: [full](/docs/api/get_data-token-full) still takes its `supply` from the token-metadata cache, which has a one-hour TTL, so while that cache is behind the two routes can divide by different supply figures and report slightly different `top10_pct` for the same mint. A capture of one live mint taken seconds apart read `"12.3978574698259"` here against a supply of `1000000000000000`, and `"12.80913097529508"` on `full` against `967892161750676`. They converge as the metadata cache turns over. For the freshest supply on its own, use [supply](/docs/api/get_data-token-supply), which reads the same sweep this route does.

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, or no `address`. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 502 | The query failed. Retry. |
