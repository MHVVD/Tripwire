/**
 * Wires the pieces together:
 *
 *   Solami gRPC ──► decode ──► LaunchTracker ──► risk score ──► Radar (UI)
 *                                   │
 *                                   └──► Tripwires ──► alerts ──► Telegram/Discord/UI
 *                                                  └──► Exiter ──► Jupiter + Beam
 *   Solami Blur REST ──► enrichment of launches worth a closer look
 */
import { EventEmitter } from "node:events";
import { Connection } from "@solana/web3.js";
import type { Config } from "./config.js";
import { GrpcFeed } from "./solami/grpc.js";
import { BlurClient } from "./solami/blur.js";
import { Beam } from "./solami/beam.js";
import { LaunchTracker, held, type Launch, type TrackerUpdate } from "./engine/tracker.js";
import { evaluate, followUp, newWatch, type Alert, type Watch } from "./engine/tripwires.js";
import { Exiter, parseSecretKey, type ExitRecord } from "./engine/exit.js";
import { Notifier } from "./notify.js";
import type { DecodedTx } from "./engine/decode.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export interface AppEvents {
  launch: [ReturnType<App["launchView"]>];
  launch_removed: [{ mint: string }];
  alert: [Alert];
  alert_update: [Alert];
  watch: [ReturnType<App["watchView"]>];
  watch_removed: [{ mint: string }];
  exit: [ExitRecord];
  health: [ReturnType<App["health"]>];
}

export class App extends EventEmitter<AppEvents> {
  readonly tracker = new LaunchTracker();
  readonly watches = new Map<string, Watch>();
  readonly alerts: Alert[] = [];
  readonly exits: ExitRecord[] = [];
  readonly feed: GrpcFeed;
  readonly blur: BlurClient;
  readonly beam: Beam;
  readonly exiter: Exiter;
  private readonly notifier: Notifier;
  private readonly rpc: Connection;
  private readonly startedAt = Date.now();
  private launchesSeen = 0;
  private solUsd = 0;
  private chainSlot?: number;
  private rpcOk = false;
  private rpcError?: string;
  private dirty = new Set<string>();
  private enriched = new Set<string>();
  private timers: NodeJS.Timeout[] = [];

  constructor(readonly cfg: Config) {
    super();
    this.setMaxListeners(100);
    this.feed = new GrpcFeed(cfg.grpcUrl, cfg.grpcKey, { launchpads: cfg.RADAR });
    this.blur = new BlurClient(cfg.apiUrl, cfg.dataKey, cfg.BLUR_ENRICH);
    this.rpc = new Connection(`${cfg.rpcUrl}?api_key=${cfg.rpcKey}`, "confirmed");
    this.beam = new Beam(this.rpc, cfg.apiUrl);
    this.exiter = new Exiter(
      this.beam,
      {
        mode: cfg.EXIT_MODE,
        wallet: parseSecretKey(cfg.WALLET_SECRET_KEY),
        maxSol: cfg.EXIT_MAX_SOL,
        slippageBps: cfg.EXIT_SLIPPAGE_BPS,
        tipLamports: cfg.BEAM_TIP_LAMPORTS,
        priorityMicroLamports: cfg.PRIORITY_FEE_MICROLAMPORTS,
        jupiterApi: cfg.JUPITER_API,
        paperSizeSol: 0.1,
      },
      (r) => this.onExit(r),
    );
    this.notifier = new Notifier(cfg);
    this.tracker.onEvict = (mint) => this.emit("launch_removed", { mint });
  }

  async start(): Promise<void> {
    this.feed.on("tx", (tx, now) => this.onTx(tx, now));
    this.feed.on("error", (e) => console.warn(`[grpc] ${e.message}`));
    await this.feed.start();
    this.timers.push(
      setInterval(() => this.flush(), 1000),
      setInterval(() => this.emit("health", this.health()), 1000),
      setInterval(() => void this.pollChainSlot(), 2000),
      setInterval(() => void this.pollRpc(), 15_000),
      setInterval(() => void this.pollSolUsd(), 60_000),
    );
    void this.pollChainSlot();
    void this.pollRpc();
    void this.pollSolUsd();
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.feed.stop();
  }

  // ---- ingest ---------------------------------------------------------------

  private onTx(tx: DecodedTx, now: number): void {
    const usdc = tx.prices[USDC];
    if (usdc && usdc > 0.0005 && usdc < 0.05) this.solUsd = 1 / usdc;

    const updates = this.tracker.ingest(tx, now);
    for (const u of updates) {
      if (u.created) this.launchesSeen++;
      this.dirty.add(u.launch.mint);
      const w = this.watches.get(u.launch.mint);
      if (w) this.onWatchedUpdate(w, u, now);
      else this.maybeAutoWatch(u.launch, now);
    }
  }

  private onWatchedUpdate(w: Watch, u: TrackerUpdate, now: number): void {
    const before = u.launch.devRecipients.size;
    const fired = evaluate(w, u, now, this.feed.slotFirstSeen(u.tx.slot));
    followUp(w, u.launch, now);
    for (const a of w.alerts) {
      if (a.t < now && now <= a.followUntil && a.avoidedPct !== undefined) this.emitAlertUpdate(a);
    }
    for (const a of fired) {
      this.alerts.unshift(a);
      if (this.alerts.length > 500) this.alerts.pop();
      this.emit("alert", a);
      void this.notifier.alert(a, u.launch);
      if (a.severity === "critical" && w.autoExit && !w.exitedAt) {
        w.exitedAt = now;
        void this.exiter.exit(w.mint, a.symbol, a.title, u.launch.price, a.slot);
      }
    }
    if (u.launch.devRecipients.size !== before) this.syncSubscriptions();
    this.emit("watch", this.watchView(w));
  }

  private lastAlertEmit = new Map<string, number>();
  private emitAlertUpdate(a: Alert): void {
    const last = this.lastAlertEmit.get(a.id) ?? 0;
    if (Date.now() - last < 1000) return;
    this.lastAlertEmit.set(a.id, Date.now());
    this.emit("alert_update", a);
  }

  private maybeAutoWatch(l: Launch, now: number): void {
    const c = this.cfg;
    if (!c.AUTO_WATCH || l.adopted) return;
    if (l.progress < c.AUTO_WATCH_MIN_PROGRESS || l.risk.metrics.uniqueBuyers < c.AUTO_WATCH_MIN_BUYERS) return;
    const autos = [...this.watches.values()].filter((w) => w.source === "auto");
    if (autos.length >= c.AUTO_WATCH_MAX) {
      // Recycle the quietest auto watch.
      const quietest = autos
        .map((w) => ({ w, last: this.tracker.get(w.mint)?.lastTradeAt ?? 0 }))
        .sort((a, b) => a.last - b.last)[0];
      if (!quietest || now - quietest.last < 60_000) return;
      this.disarm(quietest.w.mint);
    }
    this.arm(l.mint, { source: "auto" });
  }

  // ---- watches ---------------------------------------------------------------

  arm(mint: string, opts: { source?: Watch["source"]; autoExit?: boolean; devWallet?: string } = {}): Watch {
    const now = Date.now();
    let l = this.tracker.get(mint);
    if (!l) {
      l = this.tracker.adopt(mint, { creator: opts.devWallet }, now);
      void this.blur.creation(mint).then((c) => {
        if (!c || !l) return;
        l.creator ||= c.creator ?? "";
        l.symbol ||= c.symbol ?? "";
        l.name ||= c.name ?? "";
        this.syncSubscriptions();
        this.dirty.add(mint);
      });
    } else if (opts.devWallet && !l.creator) {
      l.creator = opts.devWallet;
    }
    let w = this.watches.get(mint);
    if (!w) {
      w = newWatch(mint, now, l.price, { source: opts.source ?? "manual", autoExit: opts.autoExit ?? false });
      this.watches.set(mint, w);
    } else {
      if (opts.autoExit !== undefined) w.autoExit = opts.autoExit;
      if (opts.source === "manual") w.source = "manual";
    }
    this.tracker.pinned.add(mint);
    this.dirty.add(mint);
    this.syncSubscriptions();
    void this.enrich(l);
    this.emit("watch", this.watchView(w));
    return w;
  }

  disarm(mint: string): void {
    if (!this.watches.delete(mint)) return;
    this.tracker.pinned.delete(mint);
    this.dirty.add(mint);
    this.syncSubscriptions();
    this.emit("watch_removed", { mint });
  }

  async manualExit(mint: string): Promise<ExitRecord> {
    const l = this.tracker.get(mint);
    return this.exiter.exit(mint, l?.symbol || mint.slice(0, 6), "manual", l?.price ?? 0);
  }

  /**
   * gRPC already streams every pump.fun/PumpSwap tx. On top of that we subscribe to
   * each watched mint (other DEXes) and every dev-side wallet, so plain token
   * transfers - the dev splitting supply into fresh wallets - reach us too.
   */
  private syncSubscriptions(): void {
    const accounts = new Set<string>();
    for (const mint of this.watches.keys()) {
      accounts.add(mint);
      const l = this.tracker.get(mint);
      if (!l) continue;
      if (l.creator) accounts.add(l.creator);
      for (const r of l.devRecipients) accounts.add(r);
    }
    this.feed.setWatched(accounts);
  }

  private async enrich(l: Launch): Promise<void> {
    if (!this.blur.status.enabled || this.enriched.has(l.mint)) return;
    this.enriched.add(l.mint);
    try {
      const intel = await this.blur.enrich(l.mint, l.creator || undefined);
      this.tracker.attachExternal(l.mint, intel);
      this.dirty.add(l.mint);
    } catch (e) {
      this.enriched.delete(l.mint);
      console.warn(`[blur] enrich ${l.mint}: ${(e as Error).message}`);
    }
  }

  private onExit(r: ExitRecord): void {
    const i = this.exits.findIndex((x) => x.id === r.id);
    if (i >= 0) this.exits[i] = r;
    else this.exits.unshift(r);
    if (this.exits.length > 200) this.exits.pop();
    this.emit("exit", r);
    if (r.status === "landed" || r.status === "failed" || r.status === "simulated") void this.notifier.exit(r);
  }

  // ---- views -----------------------------------------------------------------

  private flush(): void {
    const now = Date.now();
    for (const mint of this.dirty) {
      const l = this.tracker.get(mint);
      if (!l) continue;
      if (this.watches.has(mint)) this.tracker.touch(mint, now);
      this.emit("launch", this.launchView(l));
    }
    this.dirty.clear();
  }

  launchView(l: Launch) {
    const priceUsd = l.price * this.solUsd;
    const spark = l.prices.slice(-60).map((p) => p.p);
    return {
      mint: l.mint,
      name: l.name,
      symbol: l.symbol,
      uri: l.uri,
      creator: l.creator,
      createdAt: l.createdAt,
      price: l.price,
      priceUsd,
      mcapUsd: priceUsd * (l.supplyRaw / 10 ** l.decimals),
      athPrice: l.athPrice,
      progress: l.progress,
      migrated: l.migrated,
      trades: l.trades,
      buys: l.buys,
      sells: l.sells,
      volumeSol: l.volumeSol,
      risk: l.risk,
      enriched: !!l.external,
      watched: this.watches.has(l.mint),
      spark,
    };
  }

  launchDetail(mint: string) {
    const l = this.tracker.get(mint);
    if (!l) return undefined;
    const holders = [...l.holders.values()]
      .map((h) => ({ wallet: h.wallet, role: h.role, bought: h.bought / 10 ** l.decimals, sold: h.sold / 10 ** l.decimals, held: held(h) / 10 ** l.decimals, heldPct: (held(h) / l.supplyRaw) * 100 }))
      .sort((a, b) => b.held - a.held || b.bought - a.bought)
      .slice(0, 25);
    return { ...this.launchView(l), holders, external: l.external ?? null };
  }

  watchView(w: Watch) {
    const l = this.tracker.get(w.mint);
    const price = l?.price ?? 0;
    if (!w.entryPrice && price) w.entryPrice = price;
    return {
      mint: w.mint,
      symbol: l?.symbol || w.mint.slice(0, 6),
      source: w.source,
      armedAt: w.armedAt,
      autoExit: w.autoExit,
      entryPrice: w.entryPrice,
      price,
      pnlPct: w.entryPrice > 0 && price > 0 ? (price / w.entryPrice - 1) * 100 : 0,
      alerts: w.alerts.length,
      lastAlert: w.alerts[w.alerts.length - 1],
      risk: l ? l.risk : null,
    };
  }

  health() {
    const g = this.feed.status;
    const settled = this.alerts.filter((a) => Date.now() - a.t > 30_000 && a.avoidedPct !== undefined);
    const detect = this.alerts.map((a) => a.detectMs).filter((x): x is number => x !== undefined);
    return {
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      grpc: { ...g },
      chainSlot: this.chainSlot,
      slotsBehind: this.chainSlot && g.lastSlot ? Math.max(0, this.chainSlot - g.lastSlot) : undefined,
      blur: { ...this.blur.status },
      rpc: { ok: this.rpcOk, lastError: this.rpcError },
      beam: { ...this.beam.status },
      solUsd: this.solUsd,
      stats: {
        launchesSeen: this.launchesSeen,
        tracked: this.tracker.launches.size,
        watches: this.watches.size,
        alertsFired: this.alerts.length,
        criticalAlerts: this.alerts.filter((a) => a.severity === "critical").length,
        medianAvoidedPct: median(settled.filter((a) => a.severity === "critical").map((a) => a.avoidedPct!)),
        medianDetectMs: median(detect),
      },
    };
  }

  snapshot() {
    const launches = [...this.tracker.launches.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 150)
      .map((l) => this.launchView(l));
    return {
      launches,
      watches: [...this.watches.values()].map((w) => this.watchView(w)),
      alerts: this.alerts.slice(0, 200),
      exits: this.exits.slice(0, 100),
      health: this.health(),
      config: {
        exitMode: this.cfg.EXIT_MODE,
        autoWatch: this.cfg.AUTO_WATCH,
        blur: this.blur.status.enabled,
        wallet: this.exiter.walletAddress,
      },
    };
  }

  // ---- pollers ---------------------------------------------------------------

  private async pollChainSlot(): Promise<void> {
    try {
      const res = await fetch(`${this.cfg.apiUrl}/leader-tracking/current`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) this.chainSlot = ((await res.json()) as { slot: number }).slot;
    } catch {
      // Public endpoint; health simply omits slotsBehind when it is unreachable.
    }
  }

  private async pollRpc(): Promise<void> {
    try {
      await this.rpc.getSlot("processed");
      this.rpcOk = true;
      this.rpcError = undefined;
    } catch (e) {
      this.rpcOk = false;
      this.rpcError = (e as Error).message.slice(0, 160);
    }
  }

  private async pollSolUsd(): Promise<void> {
    if (this.solUsd) return;
    try {
      const res = await fetch("https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112", { signal: AbortSignal.timeout(4000) });
      const j = (await res.json()) as Record<string, { usdPrice: number }>;
      const p = j["So11111111111111111111111111111111111111112"]?.usdPrice;
      if (p) this.solUsd = p;
    } catch {
      // The USDC pools on the stream will fill this in shortly anyway.
    }
  }
}

