Looks up what happened to a transaction you sent through [Beam](/docs/beam): whether it landed, which route it took, which region handled it, and what you tipped.

No authentication needed.

## What you send

| Path param | What it is |
|---|---|
| `signature` | The transaction signature, base58, as returned to the sender. |

## What you get back

```json
{
  "signature": "5vJ8...oPq2",
  "is_landed": true,
  "landed_via_jito": false,
  "rebroadcasted": false,
  "region": "AMS",
  "tip_lamports": 100000,
  "tip_address": "Tip1111...",
  "bundle_uuid": "",
  "first_seen_ms": 1700000000123,
  "forwarded_ms": 1700000000125,
  "timestamp": 1700000000
}
```

| Field | What it is |
|---|---|
| `is_landed` | Whether the transaction landed on-chain. |
| `landed_via_jito` | `true` if it landed through the Jito bundle path rather than straight to the validator. |
| `rebroadcasted` | `true` if Beam had to send it again. |
| `region` | Which Beam region handled it, for example `AMS` or `NYC`. |
| `tip_lamports`, `tip_address` | The tip carried on the transaction, and where it went. |
| `bundle_uuid` | The Jito bundle id if a bundle was accepted, empty otherwise. Look one up at `https://explorer.jito.wtf/bundle/{bundle_uuid}`. |
| `first_seen_ms` | When Beam first received the transaction, unix milliseconds. |
| `forwarded_ms` | When Beam finished forwarding it to the validator, unix milliseconds. Subtract `first_seen_ms` for the time we held it. |
| `timestamp` | When the record was written, unix seconds. |

## What can go wrong

| Status | Meaning |
|---|---|
| 404 | No Beam record for that signature. Either it was never sent through Beam, or the record has aged out: transactions that didn't land are kept about a day, ones that landed are kept. |
| 500 | The lookup failed. Retry. |
