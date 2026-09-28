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
    level: "low" | "medium" | "high" | "critical";
    flags: { id: string; severity: "info" | "warning" | "danger"; weight: number; detail: string }[];
    metrics: {
      devInitialPct: number; devHeldPct: number; devSoldPct: number; devTransferredPct: number;
      bundlerPct: number; bundlers: number; sniperPct: number; snipers: number;
      linkedWallets: number; insiderHeldPct: number; uniqueBuyers: number;
      buySellRatio: number; drawdownPct: number;
    };
  };
  enriched: boolean;        // Blur REST intel attached
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
  detectMs?: number;
  minPriceAfter?: number;
  avoidedPct?: number;      // % drop after the alert that an exit would have avoided
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
           criticalAlerts: number; medianAvoidedPct: number; medianDetectMs: number };
}
```

## REST

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/launch/:mint` | | `LaunchView & { holders: { wallet, role, bought, sold, held, heldPct }[] }` (top 25 by held) |
| POST | `/api/watch` | `{ mint, autoExit?: boolean, devWallet?: string }` | `WatchView` |
| DELETE | `/api/watch/:mint` | | `{ ok: true }` |
| POST | `/api/exit/:mint` | `{}` | `ExitRecord` (manual exit, respects EXIT_MODE) |

Roles: `dev`, `bundler` (bought in the creation slot), `sniper` (within 5 slots), `linked` (received tokens from the dev side), `trader`.
