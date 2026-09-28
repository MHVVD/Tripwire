Returns the newest token launches, newest first. This is what fills a new-listings feed.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `launchpad` | no | Filter to one launchpad, e.g. `pumpfun`. |
| `limit` | no | How many launches to return. 1 to 100, defaults to 50. |
| `before_time` | no | Unix seconds. Pass the oldest `block_time` you've seen to page older launches. |

```text
GET /data/token/launches?chain=solana&launchpad=pumpfun&limit=2
```

## What you get back

```json
[
  {
    "mint": "9BB6...",
    "name": "Peanut the Squirrel",
    "symbol": "PNUT",
    "uri": "https://ipfs.io/ipfs/QmNT...",
    "creator": "GB1e...",
    "launchpad": "pumpfun",
    "slot": 361044210,
    "block_time": 1786100000
  },
  {
    "mint": "4D8q...",
    "name": "Cosmic Cobra",
    "symbol": "COBRA",
    "uri": "https://ipfs.io/ipfs/QmS8...",
    "creator": "CJKr...",
    "launchpad": "pumpfun",
    "slot": 361044102,
    "block_time": 1786099957
  }
]
```

### Response schema

A bare JSON array, no envelope. The fields below describe one element. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `mint` | string | The token mint. |
| `name` | string | Token name recorded at launch. `""` when we have none. |
| `symbol` | string | Token symbol. `""` when we have none. |
| `uri` | string | The metadata URI at launch. |
| `creator` | string | The wallet that created the token. |
| `launchpad` | string | The launchpad it launched on, e.g. `pumpfun`. |
| `slot` | number (integer) | The slot of the creation transaction. |
| `block_time` | number (integer) | Unix seconds of the creation transaction. Feed the oldest one back as `before_time` to page. |

For the full launch record of a single token, including the creation signature, use [creation](/docs/api/get_data-token-creation).

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, or a bad `limit` or `before_time`. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 502 | The query failed. Retry. |
