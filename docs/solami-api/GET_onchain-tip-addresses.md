Returns the tip accounts to pay when you send a transaction through [Beam](/docs/beam). Add a transfer to one of them as an instruction in your transaction, and the send is treated as tipped.

Pick one at random per transaction rather than always using the first.

The list changes rarely, but read it rather than hardcoding it.

No authentication needed.

## What you send

Nothing.

## What you get back

An array of base58 addresses.

```json
[
  "Tip1111111111111111111111111111111111111111",
  "Tip2222222222222222222222222222222222222222"
]
```

## What can go wrong

Nothing. This endpoint always returns 200.
