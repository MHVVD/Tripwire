/**
 * Yellowstone gRPC feed from Solami: slots plus every transaction touching the
 * launchpads and whatever wallets/mints Tripwire is currently watching.
 *
 * - Filters are updated in place by writing a new SubscribeRequest to the stream.
 * - On disconnect we reconnect with `fromSlot` set to the last slot we processed, so
 *   Solami replays the gap instead of us silently missing a dev's sell.
 */
import { EventEmitter } from "node:events";
import yellowstone from "@triton-one/yellowstone-grpc";
import type { SubscribeRequest } from "@triton-one/yellowstone-grpc";

// CommonJS package: depending on the loader the default import is either the module
// object or the Client class itself.
const mod = yellowstone as unknown as { default?: typeof yellowstone.default } & typeof yellowstone;
const Client = (typeof mod === "function" ? mod : mod.default) as typeof yellowstone.default;
const CommitmentLevel = { PROCESSED: 0, CONFIRMED: 1, FINALIZED: 2 } as const;
type ClientT = InstanceType<typeof Client>;
import { decodeTx, PUMP_PROGRAM, PUMPSWAP_PROGRAM, type DecodedTx, type RawTxUpdate } from "../engine/decode.js";

export interface GrpcFeedEvents {
  tx: [DecodedTx, number];
  slot: [number, number];
  status: [GrpcStatus];
  error: [Error];
}

export interface GrpcStatus {
  connected: boolean;
  reconnects: number;
  lastSlot: number;
  txTotal: number;
  txPerSec: number;
  msgPerSec: number;
  /** Median ms between a slot first appearing on the slot stream and its transactions reaching us. */
  txLagMs: number;
  replayedFromSlot?: number;
  watchedAccounts: number;
  lastError?: string;
}

const emptyRequest = (): SubscribeRequest => ({
  accounts: {},
  slots: {},
  transactions: {},
  transactionsStatus: {},
  blocks: {},
  blocksMeta: {},
  entry: {},
  accountsDataSlice: [],
});

export class GrpcFeed extends EventEmitter<GrpcFeedEvents> {
  private stream?: Awaited<ReturnType<ClientT["subscribe"]>>;
  private watched = new Set<string>();
  private lastSlot = 0;
  private stopped = false;
  private lastDataAt = 0;
  private watchdog?: NodeJS.Timeout;
  private statsTimer?: NodeJS.Timeout;
  private resubTimer?: NodeJS.Timeout;
  private slotSeen = new Map<number, number>();
  private lags: number[] = [];
  private win = { tx: 0, msg: 0 };
  readonly status: GrpcStatus = {
    connected: false,
    reconnects: 0,
    lastSlot: 0,
    txTotal: 0,
    txPerSec: 0,
    msgPerSec: 0,
    txLagMs: 0,
    watchedAccounts: 0,
  };

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly opts: { launchpads: boolean } = { launchpads: true },
  ) {
    super();
  }

  /** When the slot first showed up on our slot stream (ms), for latency accounting. */
  slotFirstSeen(slot: number): number | undefined {
    return this.slotSeen.get(slot);
  }

  async start(): Promise<void> {
    this.statsTimer = setInterval(() => this.tickStats(), 1000);
    this.watchdog = setInterval(() => {
      if (this.status.connected && Date.now() - this.lastDataAt > 20_000) {
        this.fail(new Error("no data for 20s"));
      }
    }, 5000);
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.statsTimer);
    clearInterval(this.watchdog);
    clearTimeout(this.resubTimer);
    this.stream?.destroy();
  }

  /** Replace the set of extra accounts (mints and wallets) we want transactions for. */
  setWatched(accounts: Iterable<string>): void {
    const next = new Set(accounts);
    if (next.size === this.watched.size && [...next].every((a) => this.watched.has(a))) return;
    this.watched = next;
    this.status.watchedAccounts = next.size;
    clearTimeout(this.resubTimer);
    this.resubTimer = setTimeout(() => this.writeRequest(), 250);
  }

  private request(fromSlot?: number): SubscribeRequest {
    const req = emptyRequest();
    req.commitment = CommitmentLevel.PROCESSED;
    req.slots.slots = { filterByCommitment: false };
    if (this.opts.launchpads) {
      req.transactions.launchpads = {
        vote: false,
        failed: false,
        accountInclude: [PUMP_PROGRAM, PUMPSWAP_PROGRAM],
        accountExclude: [],
        accountRequired: [],
      };
    }
    if (this.watched.size) {
      req.transactions.watched = {
        vote: false,
        failed: false,
        accountInclude: [...this.watched].slice(0, 10_000),
        accountExclude: [],
        accountRequired: [],
      };
    }
    if (fromSlot) req.fromSlot = String(fromSlot);
    return req;
  }

  private writeRequest(fromSlot?: number): void {
    if (!this.stream) return;
    this.stream.write(this.request(fromSlot), (err?: Error | null) => {
      if (err) this.emit("error", err);
    });
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    try {
      const client = new Client(this.url, this.token, { grpcMaxDecodingMessageSize: 64 * 1024 * 1024 });
      await client.connect();
      const stream = await client.subscribe();
      this.stream = stream;
      stream.on("data", (d: Record<string, unknown>) => this.onData(d));
      stream.on("error", (e: Error) => this.fail(e));
      stream.on("end", () => this.fail(new Error("stream ended")));
      // Replay a small window before the last processed slot to close the reconnect gap.
      const from = this.lastSlot ? this.lastSlot - 2 : undefined;
      this.writeRequest(from);
      this.status.replayedFromSlot = from;
      this.status.connected = true;
      this.lastDataAt = Date.now();
      this.emit("status", this.status);
    } catch (e) {
      this.fail(e as Error);
    }
  }

  private failing = false;
  private fail(e: Error): void {
    if (this.failing || this.stopped) return;
    this.failing = true;
    this.status.connected = false;
    this.status.lastError = e.message;
    this.emit("error", e);
    this.emit("status", this.status);
    this.stream?.removeAllListeners();
    this.stream?.destroy();
    this.stream = undefined;
    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.status.reconnects, 5));
    this.status.reconnects++;
    setTimeout(() => {
      this.failing = false;
      void this.connect();
    }, delay);
  }

  private onData(d: Record<string, unknown>): void {
    const now = Date.now();
    this.lastDataAt = now;
    this.win.msg++;
    const slotUpd = d.slot as { slot?: string } | undefined;
    if (slotUpd?.slot) {
      const s = Number(slotUpd.slot);
      if (!this.slotSeen.has(s)) {
        this.slotSeen.set(s, now);
        if (this.slotSeen.size > 3000) {
          const first = this.slotSeen.keys().next().value;
          if (first !== undefined) this.slotSeen.delete(first);
        }
        this.emit("slot", s, now);
      }
      return;
    }
    if (!d.transaction) return;
    const tx = decodeTx(d as RawTxUpdate);
    if (!tx) return;
    this.win.tx++;
    this.status.txTotal++;
    if (tx.slot > this.lastSlot) {
      this.lastSlot = tx.slot;
      this.status.lastSlot = tx.slot;
    }
    const seen = this.slotSeen.get(tx.slot);
    if (seen !== undefined) {
      this.lags.push(now - seen);
      if (this.lags.length > 500) this.lags.shift();
    }
    this.emit("tx", tx, now);
  }

  private tickStats(): void {
    this.status.txPerSec = this.win.tx;
    this.status.msgPerSec = this.win.msg;
    this.win = { tx: 0, msg: 0 };
    if (this.lags.length) {
      const sorted = [...this.lags].sort((a, b) => a - b);
      this.status.txLagMs = sorted[Math.floor(sorted.length / 2)];
    }
    this.emit("status", this.status);
  }
}
