# Tripwire local API

The server (`npm start`, default http://127.0.0.1:8787) serves the dashboard from `web/` and this API. The Solami key never leaves the server.

## Live stream: `GET /api/stream` (Server-Sent Events)

Each SSE message has an `event:` name and a JSON `data:` payload.

| event | payload | when |
|---|---|---|
| `snapshot` | `Snapshot` | once on connect |
| `launch` | `LaunchView` | a tracked launch changed (throttled to ~1/s per mint) |
| `launch_removed` | `{ mint }` | launch dropped from tracking |
| `alert` | `Alert` | a tripwire fired |
| `alert_update` | `Alert` | follow-up numbers (`minPriceAfter`, `avoidedPct`) changed |
| `watch` | `WatchView` | a watch was armed or changed |
| `watch_removed` | `{ mint }` | a watch was disarmed |
| `exit` | `ExitRecord` | an exit was created or changed status |
| `health` | `Health` | every second |

```ts
interface Snapshot {
  launches: LaunchView[];   // newest first, up to 150
  watches: WatchView[];
  alerts: Alert[];          // newest first, up to 200
  exits: ExitRecord[];      // newest first, up to 100
  health: Health;
  config: { exitMode: "paper" | "live"; autoWatch: boolean; blur: boolean; wallet?: string };
}

interface LaunchView {
  mint: string; name: string; symbol: string; uri: string; creator: string;
  createdAt: number;        // unix ms (when Tripwire saw the create)
  price: number;            // SOL per whole token
  priceUsd: number;
  mcapUsd: number;
  athPrice: number;
  progress: number;         // pump.fun bonding curve 0-100
  migrated: boolean;
  trades: number; buys: number; sells: number;
  volumeSol: number;
  risk: {
    score: number;          // 0-100, higher = riskier
    level: "unknown" | "low" | "medium" | "high" | "critical";  // unknown = armed by hand, no launch data
    flags: { id: string; severity: "info" | "warning" | "danger"; weight: number; detail: string }[];
    metrics: {
      devInitialPct: number; devHeldPct: number; devSoldPct: number; devTransferredPct: number;
      bundlerPct: number; bundlers: number; sniperPct: number; snipers: number;
      linkedWallets: number; insiderHeldPct: number; uniqueBuyers: number;
      buySellRatio: number; drawdownPct: number;
    };
  };
  enriched: boolean;        // Blur REST intel attached
  adopted: boolean;         // armed by hand, not seen launching
  supply: number;           // whole tokens
  watched: boolean;
  spark: number[];          // last <=60 prices, oldest first
}

interface Alert {
  id: string; t: number; mint: string; symbol: string;
  rule: "dev_sell" | "cohort_dump" | "dev_transfer" | "lp_pull" | "crash" | "whale_sell";
  severity: "critical" | "warning";
  title: string; detail: string;
  signature: string; slot: number; wallet?: string;
  price: number;
  detectMs?: number;        // processing latency: slot first seen on the stream -> alert
  minPriceAfter?: number;
  avoidedPct?: number;      // max % drop within 10 min after the alert (best case for an exit)
  move1m?: number;          // signed % price change 1 min after the alert (negative = fell)
  move5m?: number;          // signed % price change 5 min after the alert
  suppressed?: number;      // further critical triggers folded into this alert (same episode)
}

interface WatchView {
  mint: string; symbol: string;
  source: "manual" | "auto" | "position";
  armedAt: number; autoExit: boolean;
  entryPrice: number; price: number;
  pnlPct: number;           // paper position since arming
  alerts: number;           // count
  lastAlert?: Alert;
  risk: LaunchView["risk"] | null;
}

interface ExitRecord {
  id: string; t: number; mint: string; symbol: string;
  mode: "paper" | "live";
  trigger: string;          // alert title or "manual"
  status: "quoting" | "simulated" | "sending" | "landed" | "failed";
  tokens: number;           // whole tokens sold (or that would be)
  expectedSol?: number;
  signature?: string;
  sendMs?: number;          // time from trigger to send
  landMs?: number;          // time from send to confirmation
  slotDelta?: number;       // slots between alert tx and landing
  beam?: { region?: string; landedViaJito?: boolean; tipLamports?: number; heldMs?: number };
  error?: string;
}

interface Health {
  uptimeSec: number;
  grpc: { connected: boolean; reconnects: number; lastSlot: number; txTotal: number; txPerSec: number;
          msgPerSec: number; watchedAccounts: number; lastError?: string; replayedFromSlot?: number };
  chainSlot?: number;       // from Solami public leader tracking
  slotsBehind?: number;
  blur: { enabled: boolean; ok: boolean; calls: number; errors: number; avgMs: number; lastError?: string };
  rpc: { ok: boolean; lastError?: string };
  beam: { sent: number; landed: number; failed: number; avgLandMs: number };
  solUsd: number;
  stats: { launchesSeen: number; tracked: number; watches: number; alertsFired: number;
           criticalAlerts: number; medianAvoidedPct: number; medianDetectMs: number;
           // Honest outcome check: median signed 5-minute price move after critical alerts,
           // versus the median 5-minute move of the same watched tokens sampled at random times.
           alertMove5m: number | null; baselineMove5m: number | null;
           alertSamples: number; baselineSamples: number };
}
```

## Auth

Mutating requests must be `content-type: application/json` and, when the browser sends an `Origin`, it must match the server's host (blocks cross-site requests from other pages).
When `TRIPWIRE_TOKEN` is set (always required when `HOST` is not loopback; a random one is generated and printed if missing), every `/api/*` request needs it: header `x-tripwire-token: <token>`, or `?token=<token>` on `/api/stream` (EventSource cannot set headers). The dashboard picks it up from `?token=` in the page URL and keeps it in localStorage.

## REST

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/snapshot` | | `Snapshot` |
| GET | `/api/launch/:mint` | | `LaunchView & { holders: { wallet, role, bought, sold, held, heldPct }[] }` (top 25 by held) |
| POST | `/api/watch` | `{ mint, autoExit?: boolean, devWallet?: string }` | `WatchView` |
| DELETE | `/api/watch/:mint` | | `{ ok: true }` |
| POST | `/api/exit/:mint` | `{}` | `ExitRecord` (manual exit, respects EXIT_MODE) |

Roles: `dev`, `bundler` (bought in the creation slot), `sniper` (within 5 slots), `linked` (received tokens from the dev side), `trader`.
