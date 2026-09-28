Other tokens sharing this token's name or symbol: the impersonation check. A brand-new token with the ticker of something well known is the oldest trick there is.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `address` | yes | One token mint. |
| `limit` | no | Max matches returned. |
| `offset` | no | How many rows to skip before the page starts. Defaults to 0, capped at 10000. Walk it in steps of `limit` to page through the whole list. The response is a bare array, so a page shorter than `limit` is the last one. |

```text
GET /data/token/duplicates?chain=solana&address=9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump
```

## What you get back

```json
{
  "mint": "9BB6...",
  "name": "Api Token A",
  "symbol": "APITOKA",
  "creator": "DEVWALLET...",
  "created_time": 1787850000,
  "count": 1,
  "truncated": false,
  "duplicates": [
    {
      "mint": "APIMINTCOPY...",
      "name": "Api Token A",
      "symbol": "APITOKA",
      "creator": "OTHERDEV...",
      "dex": "pumpfun",
      "created_time": 1787840000,
      "matched": "both",
      "earlier": true
    }
  ],
  "image_hash": "3b8f2c1d9e4a7605f2c8b31d04e9a7562c1fbd830a94e6c27d51f8b3406e9c2a",
  "avatar_reused_by": ["APIMINTCOPY..."]
}
```

### Response schema

One object for the token you asked about, with the namesakes under `duplicates`. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `mint` | string | The token mint you asked about. |
| `name` | string | The queried token's own name, from its creation record, so the comparison baseline is explicit. |
| `symbol` | string | The queried token's own symbol, from the same record. |
| `creator` | string | The wallet that created the queried token. |
| `created_time` | number (integer) | Unix seconds the queried token launched. |
| `count` | number (integer) | Matches found. |
| `truncated` | boolean | `true` when `limit` cut the list. |
| `duplicates` | array of object | The namesakes, oldest first. |
| `duplicates[].mint` | string | That token's mint. |
| `duplicates[].name` | string | Its name at creation. |
| `duplicates[].symbol` | string | Its symbol at creation. |
| `duplicates[].creator` | string | The wallet that created it. |
| `duplicates[].dex` | string | The launchpad or AMM it launched on. |
| `duplicates[].created_time` | number (integer) | Unix seconds it launched. |
| `duplicates[].matched` | string | `symbol`, `name`, or `both`. |
| `duplicates[].earlier` | boolean | `true` when that token was created **before** the one you asked about. This is the one that matters: the earlier token is usually the original. |
| `image_hash` | string | Lowercase hex sha256 of the **bytes** of this token's current avatar. |
| `avatar_reused_by` | array | Other mints whose current avatar hashes to the same value. The queried mint is excluded from its own list, so a non-empty array always means somebody else. |

Results are oldest-first so the original is never truncated away. Matching is case-insensitive and exact; empty names and symbols never match.

## The avatar check

Name and symbol are the obvious impersonation vector. The picture is the other one: a clone that picks a slightly different ticker still needs the same avatar to be convincing, and that is what `image_hash` catches.

**It hashes the image bytes, not the URI, and that is the whole point.** The same picture served through two IPFS gateways is two different URIs, and so is the same file re-uploaded to a different host. Comparing metadata URLs would miss every one of those, so the comparison is over content: rehosting the image does not change its hash, and a clone cannot slip the check by moving the file.

The caveats, plainly:

- `image_hash` is `""` when we have no bytes to hash: the avatar was never fetched, the fetch was refused as an unsafe target, or the file was over the 4MB cap. Empty means **unknown**, not "this token has no image".
- **An empty hash never counts as a match for another empty hash.** Two unfetched tokens are not reported as sharing an avatar, which would otherwise be far and away the largest source of false positives on this route.
- Hashes are forward-only. A token whose avatar was never fetched is absent from the comparison entirely, so `avatar_reused_by` is a floor: it can under-report reuse, it will not invent it.
- The hash is of the **current** avatar. A token that has since swapped its picture is compared on what it shows now, not on what it launched with.

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, or no `address`. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 502 | The query failed. Retry. |
