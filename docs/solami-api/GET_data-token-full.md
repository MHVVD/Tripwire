Returns everything about one token in a single flat object: metadata, price, liquidity, pools, and windowed stats. This is what fills a token detail page without four round trips.

**Requires:** the `DataApi` permission.

## What you send

| Query param | Required | What it is |
|---|---|---|
| `chain` | yes | `solana`, or the alias `sol`. |
| `address` | yes | One token mint. |
| `sniper_slots` | no | How many slots after creation count as sniper buys. Defaults to 5. |

```text
GET /data/token/full?chain=solana&address=94eHt3vvu8Fp2i2x2Ett2tvsKmyVABFNpEmZ7Gsjpump
```

## What you get back

A real capture, **abridged in one place only**: `stats` comes back with twelve windows and two are shown here so the object fits on the page. Everything else is the complete response.

```json
{
  "mint": "94eHt3vvu8Fp2i2x2Ett2tvsKmyVABFNpEmZ7Gsjpump",
  "name": "Never Kill Yourself",
  "symbol": "NEVER",
  "decimals": 6,
  "uri": "https://metadata.j7tracker.io/metadata/45799d731dc14f61.json",
  "image": "https://metadata.j7tracker.io/images/45799d731dc14f61",
  "description": "Deployed using https://j7tracker.io",
  "socials": {
    "website": "https://chatgpt.com/c/6a91cf6a-02c4-83e9-8c7b-6f9d88df0915",
    "x": "https://x.com/meggarwicky/status/2093401853442621869",
    "telegram": null,
    "discord": null,
    "youtube": null,
    "instagram": null,
    "tiktok": null
  },
  "launchpad": "pumpfun",
  "creator": "DWHEZ8JnfGtud25Gjhn3MndpTMshNEd12WMu2ciCa7ri",
  "created_slot": 442399655,
  "created_time": 1787940869,
  "price_usd": "0.00003036382841990667",
  "price_native": "0.00000029313235924298645",
  "quote_mint": "So11111111111111111111111111111111111111112",
  "supply": 970167700580153,
  "market_cap_usd": "29458.005598951153",
  "fdv_usd": "29458.005598951153",
  "holders": 310,
  "holders_exact": true,
  "top10_pct": "25.12506660103436",
  "liquidity_usd": "4702.070688518221",
  "tvl_usd": "4702.070688518221",
  "ath_mcap_usd": "83076.83743084758",
  "indexed_from_creation": true,
  "history_from": 1787940869,
  "surge": null,
  "dev": {
    "wallet": "DWHEZ8JnfGtud25Gjhn3MndpTMshNEd12WMu2ciCa7ri",
    "tokens_launched": 4
  },
  "screener": {
    "bonding_pct": "29.07290243764706",
    "is_graduated": false,
    "organic_score": "25.03756317442972",
    "dev_pct": "0",
    "net_buy_usd": "162130.26050886797",
    "fees_usd": "3990.698168402347",
    "launchpad": "pumpfun",
    "socials": { "any": true, "website": true, "x": true, "telegram": false }
  },
  "pools": [
    {
      "pool": "74HpZ1vf3hw8Q1vWomRQzF8QM17C8XjPwKpASZzkWquu",
      "dex": "pumpfun",
      "quote_mint": "So11111111111111111111111111111111111111112",
      "price_usd": "0.00004250991565764533",
      "liquidity_usd": "0",
      "base_usd": "0",
      "quote_usd": "0",
      "tvl_usd": "0",
      "base_reserve": 66490084378,
      "quote_reserve": 85005361380,
      "volume_usd": "174760.65891006019",
      "fees_usd": "2184.508684237641",
      "trades": 3064,
      "traders": 959,
      "created_time": 0,
      "lp_burn_pct": null
    },
    {
      "pool": "8AoAckcdGC9mps5qfpAa3dgmPnKLTnwkHPss9nZ6RJX2",
      "dex": "pumpswap",
      "quote_mint": "So11111111111111111111111111111111111111112",
      "price_usd": "0.000010482310349715796",
      "liquidity_usd": "4702.070688518221",
      "base_usd": "4436.004942886146",
      "quote_usd": "266.0657456320752",
      "tvl_usd": "4702.070688518221",
      "base_reserve": 423189620884142,
      "quote_reserve": 2568598355,
      "volume_usd": "171919.2019525304",
      "fees_usd": "1806.21356879615",
      "trades": 4258,
      "traders": 1039,
      "created_time": 1787942098,
      "lp_burn_pct": "100"
    }
  ],
  "stats": {
    "3600": {
      "trades": 308,
      "buys": 308,
      "sells": 0,
      "traders": 77,
      "volume_usd": "11246.508466720403",
      "fees_usd": "137.60863199170757",
      "open": "0",
      "high": "0",
      "low": "0",
      "close": "0",
      "price_change_pct": "0"
    },
    "86400": {
      "trades": 7322,
      "buys": 5954,
      "sells": 1368,
      "traders": 1833,
      "volume_usd": "346679.86086259113",
      "fees_usd": "3990.7222530337926",
      "open": "0.000004105284683243659",
      "high": "0.00039903275833303706",
      "low": "0.0000033927972588790135",
      "close": "0.00004250991565764533",
      "price_change_pct": "935.4925160526865"
    }
  },
  "intel": {
    "mint": "94eHt3vvu8Fp2i2x2Ett2tvsKmyVABFNpEmZ7Gsjpump",
    "score": 2,
    "rugged": false,
    "flags": [
      { "name": "dev_exited", "level": "warning", "detail": "the creator no longer holds any tokens" }
    ],
    "dev": { "wallets": 1, "held_pct": "0", "initial_pct": "15.799919353535508" },
    "snipers": { "wallets": 9, "held_pct": "0", "initial_pct": "20.701646434571032" },
    "bundlers": { "wallets": 3, "held_pct": "0", "initial_pct": "8.841405648610372" },
    "insiders": { "wallets": 0, "held_pct": "0", "initial_pct": "0" },
    "fees": {
      "total_sol": "1.441670989",
      "total_usd": "149.2311532578303",
      "venues": { "jito": { "sol": "1.441670989", "usd": "149.2311532578303" } }
    }
  }
}
```

### Response schema

One flat object per mint, with the pools, stats, screener, dev, surge and intel blocks nested inside it. Types follow the [Blur numbers convention](/docs/blur#numbers): every fractional value is a decimal string, integers stay JSON numbers.

| Field | Type | What it is |
|---|---|---|
| `mint` | string | The token mint you asked for. |
| `name` | string | null | Token name from the on-chain metadata. `null` when we can't resolve it. |
| `symbol` | string | null | Token symbol. `null` when we can't resolve it. |
| `decimals` | number (integer) | Decimals on the mint. `0` for an unresolvable mint. |
| `uri` | string | null | The metadata URI on the mint. `null` when there is none. |
| `image` | string | null | Logo URL from the off-chain JSON behind `uri`. `null` when the uri is empty, unreachable, or has no logo. |
| `description` | string | null | Description from the same off-chain JSON. `null` when absent. |
| `socials` | object | Social links from the off-chain JSON. |
| `socials.website` | string | null | Website link. `null` when the token has none. |
| `socials.x` | string | null | X link. `null` when the token has none. |
| `socials.telegram` | string | null | Telegram link. `null` when the token has none. |
| `socials.discord` | string | null | Discord link. `null` when the token has none. |
| `socials.youtube` | string | null | YouTube link. `null` when the token has none. |
| `socials.instagram` | string | null | Instagram link. `null` when the token has none. |
| `socials.tiktok` | string | null | TikTok link. `null` when the token has none. |
| `launchpad` | string | null | The launchpad the token was created on. `null` when the creation predates our indexing - "we don't know", not "nobody". |
| `creator` | string | null | The wallet that created the mint. `null` on the same terms as `launchpad`. |
| `created_slot` | number (integer) | null | Slot the token was created in. `null` when the creation isn't indexed. |
| `created_time` | number (integer) | null | Unix seconds the token was created. `null` when the creation isn't indexed. |
| `price_usd` | string (decimal) | Last price in USD, liquidity-weighted across the token's pools. |
| `price_native` | string (decimal) | The same price in the quote token (`quote_mint`). |
| `quote_mint` | string | The quote token of the last trade the price came from. `""` when the token has never been priced. |
| `supply` | number (integer) | Raw integer. Apply `decimals`. `0` for an unresolvable mint. See the note on freshness below. |
| `market_cap_usd` | string (decimal) | Supply (UI-adjusted) times `price_usd`. `"0"` when supply or price is unavailable. |
| `fdv_usd` | string (decimal) | The same figure as `market_cap_usd` today. |
| `holders` | number (integer) | Owner wallets with a positive balance. Pool and bonding-curve accounts are excluded - see below. `0` for very new tokens until we've counted them. |
| `holders_exact` | boolean | Whether `holders` and `top10_pct` are exact yet, or still the pre-sweep estimate. A request for a mint with no sweep starts one. |
| `top10_pct` | string (decimal) | Percent of supply held by the top 10 ledger holders. Capped at `"100"`. `"0"` when supply is unavailable. |
| `liquidity_usd` | string (decimal) | **Changed.** Both legs, summed across every pool in `pools`. `liquidity_usd` used to be the quote leg only. |
| `tvl_usd` | string (decimal) | The same number as `liquidity_usd`, under the other name. |
| `ath_mcap_usd` | string (decimal) | null | All-time-high market cap. `null`, never `"0"`, for tokens older than market-cap stamping, and whenever `indexed_from_creation` is `false`. |
| `indexed_from_creation` | boolean | Whether our history for this mint starts at its creation. |
| `history_from` | number (integer) | Unix seconds of the earliest activity we hold for this mint. |
| `surge` | object | null | The most recent surge trigger, or `null` if it never triggered. See the surge block below. |
| `surge.trigger_time` | number (integer) | Unix seconds the trigger fired. |
| `surge.mcap_at_trigger` | string (decimal) | Market cap at that moment. Recorded live, because it cannot be reconstructed afterwards. `"0"` means the supply was unresolved then - unknown, not a zero market cap. |
| `surge.multiple` | string (decimal) | Window volume against the baseline, the ratio that fired the trigger. |
| `surge.mcap_change_since_trigger_pct` | string (decimal) | Percent move from `mcap_at_trigger` to the **live** market cap. Falls back to `"0"` when it can't be computed. |
| `surge.ath_change_since_trigger_pct` | string (decimal) | null | Percent move from `mcap_at_trigger` to the token's **all-time-high** market cap: how far it ran, rather than where it sits now. `null`, never `"0"`, when it can't be computed. |
| `dev` | object | Context on the creator. Full launch history is at [dev](/docs/api/get_data-token-dev). |
| `dev.wallet` | string | null | The creator wallet. `null` when the creation isn't indexed. |
| `dev.tokens_launched` | number (integer) | How many tokens that wallet has launched. `0` when unknown. |
| `screener` | object | null | The screener snapshot, the same values the [screener](/docs/api/get_data-token-screener) filters on. `null` when the token has no snapshot row yet. |
| `screener.bonding_pct` | string (decimal) | How far along the bonding curve the token is. |
| `screener.is_graduated` | boolean | Whether the curve has migrated to an AMM pool. |
| `screener.organic_score` | string (decimal) | The screener's organic-activity score. |
| `screener.dev_pct` | string (decimal) | Percent of supply the creator holds. |
| `screener.net_buy_usd` | string (decimal) | Buy volume minus sell volume, in USD. |
| `screener.fees_usd` | string (decimal) | Swap fees paid on the token, in USD. |
| `screener.launchpad` | string | null | The launchpad, as the snapshot recorded it. `null` when it recorded none. |
| `screener.socials` | object | Which socials the token has, as booleans. |
| `screener.socials.any` | boolean | Whether the token has any social link at all. |
| `screener.socials.website` | boolean | Whether it has a website. |
| `screener.socials.x` | boolean | Whether it has an X account. |
| `screener.socials.telegram` | boolean | Whether it has a Telegram. |
| `pools` | array of object | Every venue the token trades on, deepest first, up to 20. Same rows as [token pools](/docs/api/get_data-token-pools), over a 24h window. |
| `pools[].pool` | string | The pool address. |
| `pools[].dex` | string | The venue, e.g. `pumpfun`, `pumpswap`. |
| `pools[].quote_mint` | string | The pool's quote token. |
| `pools[].price_usd` | string (decimal) | Last USD price in that pool. |
| `pools[].liquidity_usd` | string (decimal) | Both legs of that pool. `"0"` on a bonding curve that has already graduated. |
| `pools[].base_usd` | string (decimal) | USD value of the base leg on its own. |
| `pools[].quote_usd` | string (decimal) | USD value of the quote leg on its own. |
| `pools[].tvl_usd` | string (decimal) | The same number as `pools[].liquidity_usd`. |
| `pools[].virtual_base_reserve` | number (integer) | Raw virtual base reserve on venues that quote against a virtual curve. `0` where the venue has none. |
| `pools[].virtual_quote_reserve` | number (integer) | Raw virtual quote reserve, on the same terms. |
| `pools[].base_reserve` | number (integer) | Raw integer. |
| `pools[].quote_reserve` | number (integer) | Raw integer. |
| `pools[].volume_usd` | string (decimal) | USD volume in that pool over the 24h window. |
| `pools[].fees_usd` | string (decimal) | Swap fees taken by that pool over the 24h window, in USD. |
| `pools[].trades` | number (integer) | Trade count in that pool over the window. |
| `pools[].traders` | number (integer) | Distinct traders in that pool over the window. |
| `pools[].created_time` | number (integer) | Unix seconds the pool was created. `0` when we have no creation record. |
| `pools[].lp_burn_pct` | string (decimal) | null | How much of the LP supply has been burned. `null` on a bonding curve, which has no LP mint. |
| `stats` | object | Keyed by lookback window in seconds. Same numbers as [stats](/docs/api/get_data-token-stats), plus USD volume and fees. |
| `stats.<secs>.trades` | number (integer) | Trade count over that window, across every pool. |
| `stats.<secs>.buys` | number (integer) | Buy count over that window. |
| `stats.<secs>.sells` | number (integer) | Sell count over that window. |
| `stats.<secs>.traders` | number (integer) | Distinct traders over that window. |
| `stats.<secs>.volume_usd` | string (decimal) | USD volume over that window, across every pool. |
| `stats.<secs>.fees_usd` | string (decimal) | Swap fees over that window, in USD. |
| `stats.<secs>.open` | string (decimal) | USD price of the first trade in the window. |
| `stats.<secs>.high` | string (decimal) | Highest USD price in the window. |
| `stats.<secs>.low` | string (decimal) | Lowest USD price in the window. |
| `stats.<secs>.close` | string (decimal) | USD price of the last trade in the window. |
| `stats.<secs>.price_change_pct` | string (decimal) | Move from `open` to `close`, as a percentage. |
| `intel` | object | Holder-quality signals: dev, sniper, bundler, and insider wallets with the share they bought at launch and hold now. The summary form of [intel](/docs/api/get_data-token-intel) - the per-wallet `list` arrays are omitted here. |
| `intel.mint` | string | The mint the intel describes. |
| `intel.score` | number (integer) | Risk score, 0 to 10. Higher is worse. |
| `intel.rugged` | boolean | Whether liquidity is gone after significant volume. |
| `intel.flags` | array of object | The risk flags that fired. |
| `intel.flags[].name` | string | Flag identifier, e.g. `dev_exited`, `no_liquidity`. |
| `intel.flags[].level` | string | `warning` or `danger`. |
| `intel.flags[].detail` | string | A sentence explaining the flag. |
| `intel.dev` | object | The creator cohort. |
| `intel.dev.wallets` | number (integer) | How many wallets are in the cohort. |
| `intel.dev.held_pct` | string (decimal) | Percent of supply the cohort holds now. Capped at `"100"`. |
| `intel.dev.initial_pct` | string (decimal) | Percent of supply the cohort bought at launch. Capped at `"100"`. |
| `intel.snipers` | object | The sniper cohort, same three fields as `intel.dev`. |
| `intel.bundlers` | object | The bundler cohort, same three fields as `intel.dev`. |
| `intel.insiders` | object | The insider cohort, same three fields as `intel.dev`. |
| `intel.fees` | object | null | Lifetime tip and swap-fee spend on the token - the same block as [fees](/docs/api/get_data-token-fees). `null` if the lookup failed. |
| `intel.fees.total_sol` | string (decimal) | Tips across every venue, in SOL. |
| `intel.fees.total_usd` | string (decimal) | The same total in USD. |
| `intel.fees.tips_usd` | string (decimal) | The same figure as `total_usd`, under the name that says what it is. |
| `intel.fees.trading_usd` | string (decimal) | The DEX swap fee the pools themselves took, in USD. |
| `intel.fees.total_paid_usd` | string (decimal) | `tips_usd` plus `trading_usd`. |
| `intel.fees.venues` | object | Keyed by venue name. |
| `intel.fees.venues.<venue>.sol` | string (decimal) | Tips to that venue, in SOL. |
| `intel.fees.venues.<venue>.usd` | string (decimal) | The same, in USD. |

Times are unix seconds. Unknown mint returns an empty result.

## Liquidity without descending into `pools`

**New.** `liquidity_usd` and `tvl_usd` are top-level fields. Previously liquidity was only reachable by summing `pools[]` yourself, which meant every caller wanting one number on a token card had to iterate an array to get it.

They are exactly the sums, so nothing is estimated. In the capture, `"0"` plus `"4702.070688518221"` gives `"4702.070688518221"` for both.

**Changed: liquidity now counts both legs.** `liquidity_usd` and `tvl_usd` are the same number - `base_usd + quote_usd` summed across pools. `liquidity_usd` used to be the quote leg alone, so it read as roughly half a balanced pool's depth and disagreed with `tvl_usd` beside it. The individual legs are still there per pool as `base_usd` and `quote_usd`. Everything serving liquidity moved together: [pool](/docs/api/get_data-pool), [token pools](/docs/api/get_data-token-pools), [liquidity](/docs/api/get_data-token-liquidity), [price](/docs/api/get_data-token-price) with `liquidity=true`, the [screener](/docs/api/get_data-token-screener) and the discovery routes.

**Changed: a graduated bonding curve contributes zero.** The pumpfun row in the capture reads `liquidity_usd: "0"` while still showing real `base_reserve`, `quote_reserve` and 24h activity. Migration empties the curve into the AMM pool, so its last observed reserves describe an account that no longer holds anything, and counting them double-counted the token's depth. The pool with `lp_burn_pct: "100"` is the AMM pool it graduated into, and it carries all of the token's depth here.

A mint with no pools returns `"0"`. A mint we have never priced can return **negative zero** (`"-0"`) on both fields; treat it as `"0"`.

[liquidity](/docs/api/get_data-token-liquidity) now also sums across pools, so its top-level `liquidity_usd` and this one answer the same question. The one case where they still differ is a graduated launchpad token: that route reads the candle history and does not zero the spent curve, so it reports more.

## Twelve stats windows

**Changed.** `stats` used to carry three windows. It now always carries the same twelve as the [pool](/docs/api/get_data-pool) route: `60, 300, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400, 259200, 604800` seconds.

There is no `windows` parameter on this route: passing one is ignored and you get all twelve regardless. If you only want a couple of windows, [stats](/docs/api/get_data-token-stats) takes an explicit list.

Each window carries eleven metrics - `open`, `high`, `low`, `close`, `volume_usd`, `fees_usd`, `trades`, `buys`, `sells`, `traders`, `price_change_pct`. `fees_usd` and the four OHLC fields are new here. A quiet window returns the block with every metric at zero rather than being omitted, so `stats["60"]` is always present.

## What counts as a holder

**Changed, and it changes the numbers.** AMM pool accounts and bonding-curve accounts are **excluded from the holder set** on this route, on [holders](/docs/api/get_data-token-holders), on [screener](/docs/api/get_data-token-screener), and on [security](/docs/api/get_data-token-security).

A pool is not a holder. It is the counterparty everyone trades against, and its balance is the float, not somebody's position. Counting it made `top10_pct` read around 85% on a typical fresh token, because the curve itself was the top holder by an order of magnitude - a concentration figure that described the venue rather than the holders.

The capture above is what the corrected figure looks like: `top10_pct` reads `"25.12506660103436"` across 310 holders, and no entry in the token's holder set is one of its two pools. On the tokens that motivated the change, the old definition put a typical fresh token's top-10 share around 85% where the real figure was under 20%.

Two consequences for anyone comparing against stored numbers:

- **`holders` drops by one or two** - the pool accounts that used to be counted.
- **`top10_pct` drops a lot**, and on a young token it can drop by 60 points or more.

**This is a definition change, not a data change.** Nothing about the chain moved. A historical series of `top10_pct` spanning the change will show a cliff at the cutover that no token actually experienced, so do not read it as distribution improving.

## Share of supply cannot exceed 100

**Changed.** `top10_pct` here, and the `held_pct` and `initial_pct` figures inside `intel`, are capped at `"100"`.

They used to be able to exceed it. A share above 100 is not a real reading: it means the holder balances we have observed are ahead of the supply figure we divide by, which happens for an account that has not traded since we last observed its balance. Continuous ingestion resolves it. The cap is a floor under nonsense, not a correction to the balances, which were never wrong. Read an exact `"100"` as "at or above the whole supply" rather than as a precise measurement.

## How fresh `supply` is

`supply` on this route, and the `market_cap_usd`, `fdv_usd` and `top10_pct` derived from it, come from the token-metadata cache, which has a **one-hour** TTL.

**Changed elsewhere, not here.** [supply](/docs/api/get_data-token-supply), [security](/docs/api/get_data-token-security) and [intel](/docs/api/get_data-token-intel) now read supply from a mint-account sweep that refreshes roughly every **15 minutes**, replacing a figure that could sit an hour behind.

Most of the time the two agree: the token in the capture returns `top10_pct` of `"25.12506660103436"` both here and on `security`, read seconds apart. They can drift apart while the hour-long cache is behind the sweep, because the two then divide the same balances by different supply snapshots - a second live mint read `"12.80913097529508"` here against a supply of `967892161750676` and `"12.3978574698259"` on `security` against `1000000000000000`. It converges as the cache turns over. Use [supply](/docs/api/get_data-token-supply) when you need the freshest supply and market cap on their own.

## What can go wrong

| Status | Meaning |
|---|---|
| 400 | Missing or unsupported `chain`, or no `address`. |
| 401 | Missing or invalid API key. |
| 403 | The key lacks `DataApi`. |
| 502 | The query failed. Retry. |

## Everything in one call

`full` is the single-request token page: metadata, price, liquidity, pools, windowed stats, intel cohorts, the screener snapshot, dev context, ATH market cap and the last surge. Each addition is a single primary-key read, so the route stays in the tens of milliseconds.

| Block | What it is |
|---|---|
| `screener` | `bonding_pct`, `is_graduated`, `organic_score`, `dev_pct`, `net_buy_usd`, `fees_usd`, `launchpad`, plus a `socials` object. The same values the [screener](/docs/api/get_data-token-screener) filters on. |
| `dev` | `wallet` and `tokens_launched`. Full launch history is at [dev](/docs/api/get_data-token-dev). |
| `ath_mcap_usd` | All-time-high market cap. `null`, never `"0"`, for tokens older than market-cap stamping. |
| `surge` | Latest trigger: `trigger_time`, `mcap_at_trigger`, `multiple`, `mcap_change_since_trigger_pct` against live mcap, and `ath_change_since_trigger_pct` against the peak. `null` if it never triggered. |
| `intel` | Dev, sniper, bundler and insider cohorts with held percentages, plus a `fees` block: `total_sol`, `total_usd`, and a `venues` map keyed by venue with `sol` and `usd` per venue. |
| `pools` | Every venue the token trades on, deepest first, each with both legs valued and its own window volume, fees, trades and traders. |

## The surge block

`surge` describes the most recent time the token tripped the surge detector, and how it has moved since:

```json
{
  "trigger_time": 1787891400,
  "mcap_at_trigger": "180000",
  "multiple": "12",
  "mcap_change_since_trigger_pct": "0",
  "ath_change_since_trigger_pct": "400"
}
```

That capture shows the asymmetry in one response. The token's recorded peak is five times its trigger mcap, so `ath_change_since_trigger_pct` reads `"400"`; its live market cap is currently unavailable, and `mcap_change_since_trigger_pct` reports the `"0"` fallback rather than saying it doesn't know.

The five fields are typed in the response schema above, under `surge`.

The two change fields deliberately fail differently, and the difference matters if you chart them:

- `mcap_change_since_trigger_pct` falls back to **`"0"`** when it can't be computed - when `mcap_at_trigger` is unknown, or when the live market cap is unavailable.
- `ath_change_since_trigger_pct` is **`null`** when `mcap_at_trigger` is unknown, and whenever the token has no recorded ATH market cap. It is never coerced to zero, because "the peak is unknown" and "it never moved from the trigger" are different statements, and a leaderboard sorted on this column must not rank the first as the second.

ATH market cap is forward-only, so a token that peaked before market-cap stamping has no recorded ATH and this field stays `null` however far it actually ran. Treat `null` as "unknown", and only `"0"` on the live column as "flat".

`ath_mcap_usd` is only a real figure when `indexed_from_creation` is `true`. For a token that was already trading before this deployment started, the highest value we have seen is the high *of our window*, not of the token's life - so we return `null` rather than dress a windowed maximum up as an all-time high. `indexed_from_creation` and `history_from` are recomputed per request, so indexing more history flips the flag on its own and the ATH value starts appearing.
