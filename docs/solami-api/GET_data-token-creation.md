Returns the launch record for one token: who created it, on which launchpad, in which slot and transaction, and the on-chain metadata at launch. Works for any token we have ever seen launch, however old.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `address` | yes | One token mint. |

```text
GET /data/token/creation?chain=solana&address=9BB6...
```

## What you get back

```json
{
  "mint": "9BB6...",
  "creator": "GB1e...",
  "launchpad": "pumpfun",
  "signature": "29SS...eQMx",
  "slot": 361044210,
  "block_time": 1786100000,
  "name": "Peanut the Squirrel",
  "symbol": "PNUT",
  "uri": "https://ipfs.io/ipfs/QmNT..."
}
```

### Response schema

The launch record for the mint. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `mint` | string | The token mint. |
| `creator` | string | The wallet that created the token. |
| `launchpad` | string | Which launchpad it launched on, `pumpfun` for instance. |
| `signature` | string | The creation transaction. |
| `slot` | number (integer) | The slot the creation transaction landed in. |
| `block_time` | number (integer) | Unix seconds of the creation transaction. |
| `name` | string | The name as it was at launch, not as it is now. |
| `symbol` | string | The symbol as it was at launch, not as it is now. |
| `uri` | string | The metadata URI as it was at launch, not as it is now. |

Unknown mint returns an empty result. For a rolling feed of new launches instead of one lookup, use [launches](/docs/api/get_data-token-launches).

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, or no `address`. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 502 | The query failed. Retry. |
