/**
 * Builds a live picture of every token launched while Tripwire is running, from the
 * gRPC firehose alone: who created it, who bought in the creation slot (bundlers),
 * who bought within a few slots (snipers), where the dev's tokens went, price,
 * bonding-curve progress and flow. This is our own on-the-fly version of the
 * "intel" a token-safety panel needs, available the second a token exists.
 */
import type { DecodedTx, Flow } from "./decode.js";
import { PUMP_SUPPLY_RAW } from "./decode.js";
import { scoreLaunch, type RiskReport, type ExternalIntel } from "./scorer.js";

export type Role = "dev" | "bundler" | "sniper" | "linked" | "trader";

export interface Holder {
  wallet: string;
  role: Role;
  firstSlot: number;
  bought: number;
  sold: number;
  /** Net tokens received by plain transfer (positive) or sent away (negative). */
  transferred: number;
  solIn: number;
  solOut: number;
}

export interface PricePoint {
  t: number;
  p: number;
}

export interface Launch {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  creator: string;
  /** Bonding-curve PDA, a counterparty rather than a holder. */
  curve?: string;
  createSlot: number;
  createdAt: number;
  supplyRaw: number;
  decimals: number;
  price: number;
  athPrice: number;
  progress: number;
  migrated: boolean;
  trades: number;
  buys: number;
  sells: number;
  volumeSol: number;
  lastTradeAt: number;
  holders: Map<string, Holder>;
  prices: PricePoint[];
  /** Wallets that received tokens from the dev or a linked wallet. */
  devRecipients: Set<string>;
  external?: ExternalIntel;
  /** Armed by hand rather than seen launching; early-buyer roles are unknown. */
  adopted?: boolean;
  risk: RiskReport;
}

export interface TrackerOptions {
  sniperSlots: number;
  /** How long to keep following a launch with no trades before dropping it. */
  idleMs: number;
  maxLaunches: number;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  sniperSlots: 5,
  idleMs: 30 * 60_000,
  maxLaunches: 3000,
};

export interface TrackerUpdate {
  launch: Launch;
  created: boolean;
  flows: Flow[];
  tx: DecodedTx;
}

export class LaunchTracker {
  readonly launches = new Map<string, Launch>();
  onEvict?: (mint: string) => void;
  /** Mints that must not be evicted (watched). */
  pinned = new Set<string>();
  constructor(private readonly opts: TrackerOptions = DEFAULT_TRACKER_OPTIONS) {}

  get(mint: string): Launch | undefined {
    return this.launches.get(mint);
  }

  /** Feeds one decoded transaction. Returns an update per tracked mint it touched. */
  ingest(tx: DecodedTx, now: number): TrackerUpdate[] {
    if (tx.failed) return [];
    const out: TrackerUpdate[] = [];

    if (tx.launch && !this.launches.has(tx.launch.mint)) {
      const l = tx.launch;
      const launch: Launch = {
        mint: l.mint,
        name: l.name,
        symbol: l.symbol,
        uri: l.uri,
        creator: l.creator,
        curve: l.curve,
        createSlot: tx.slot,
        createdAt: now,
        supplyRaw: PUMP_SUPPLY_RAW,
        decimals: 6,
        price: 0,
        athPrice: 0,
        progress: 0,
        migrated: false,
        trades: 0,
        buys: 0,
        sells: 0,
        volumeSol: 0,
        lastTradeAt: now,
        holders: new Map(),
        prices: [],
        devRecipients: new Set(),
        risk: { score: 0, level: "low", flags: [], metrics: emptyMetrics() },
      };
      this.launches.set(l.mint, launch);
      this.evict(now);
    }

    const byMint = new Map<string, Flow[]>();
    for (const f of tx.flows) {
      if (!this.launches.has(f.mint)) continue;
      const arr = byMint.get(f.mint) ?? [];
      arr.push(f);
      byMint.set(f.mint, arr);
    }
    if (tx.migratedMint && this.launches.has(tx.migratedMint) && !byMint.has(tx.migratedMint)) {
      byMint.set(tx.migratedMint, []);
    }
    if (tx.launch && !byMint.has(tx.launch.mint)) byMint.set(tx.launch.mint, []);

    for (const [mint, flows] of byMint) {
      const launch = this.launches.get(mint)!;
      this.apply(launch, tx, flows, now);
      out.push({ launch, created: tx.launch?.mint === mint, flows, tx });
    }
    return out;
  }

  private apply(launch: Launch, tx: DecodedTx, flows: Flow[], now: number): void {
    const price = tx.prices[launch.mint];
    if (price && Number.isFinite(price)) {
      launch.price = price;
      launch.athPrice = Math.max(launch.athPrice, price);
      launch.prices.push({ t: now, p: price });
      if (launch.prices.length > 600) launch.prices.splice(0, launch.prices.length - 600);
    }
    const progress = tx.curveProgress[launch.mint];
    if (progress !== undefined) launch.progress = progress;
    if (tx.migratedMint === launch.mint) {
      launch.migrated = true;
      launch.progress = 100;
    }

    const devSide = (w: string) => w === launch.creator || launch.devRecipients.has(w);

    for (const f of flows) {
      if (f.owner === launch.curve) continue;
      let h = launch.holders.get(f.owner);
      if (!h) {
        h = {
          wallet: f.owner,
          role: this.roleFor(launch, f, tx.slot),
          firstSlot: tx.slot,
          bought: 0,
          sold: 0,
          transferred: 0,
          solIn: 0,
          solOut: 0,
        };
        launch.holders.set(f.owner, h);
      }
      const amt = Math.abs(f.tokenDelta);
      const sol = Math.abs(f.solDelta) / 1e9;
      if (f.kind === "buy") {
        h.bought += amt;
        h.solOut += sol;
        launch.buys++;
        launch.trades++;
        launch.volumeSol += sol;
        launch.lastTradeAt = now;
      } else if (f.kind === "sell") {
        h.sold += amt;
        h.solIn += sol;
        launch.sells++;
        launch.trades++;
        launch.volumeSol += sol;
        launch.lastTradeAt = now;
      } else if (f.kind === "transfer_out") {
        h.transferred -= amt;
      } else {
        h.transferred += amt;
      }
    }

    // Follow the money: a wallet receiving tokens in a tx where a dev-side wallet sent
    // them becomes "linked" to the dev.
    const senders = flows.filter((f) => f.kind === "transfer_out" && devSide(f.owner));
    if (senders.length) {
      for (const f of flows) {
        if (f.kind !== "transfer_in" || devSide(f.owner) || f.owner === launch.creator) continue;
        if (isLikelyPool(launch, f.owner)) continue;
        launch.devRecipients.add(f.owner);
        const h = launch.holders.get(f.owner);
        if (h && h.role === "trader") h.role = "linked";
      }
    }

    launch.risk = scoreLaunch(launch);
  }

  private roleFor(launch: Launch, f: Flow, slot: number): Role {
    if (f.owner === launch.creator) return "dev";
    if (launch.devRecipients.has(f.owner)) return "linked";
    if (f.kind !== "buy") return "trader";
    const after = slot - launch.createSlot;
    if (after <= 0) return "bundler";
    if (after <= this.opts.sniperSlots) return "sniper";
    return "trader";
  }

  /**
   * Start following a token we did not see launch (armed by hand). Roles other than
   * dev/linked cannot be reconstructed, but price, flows and dev activity can.
   */
  adopt(mint: string, info: { creator?: string; name?: string; symbol?: string; supplyRaw?: number; decimals?: number }, now: number): Launch {
    const existing = this.launches.get(mint);
    if (existing) return existing;
    const launch: Launch = {
      mint,
      name: info.name ?? "",
      symbol: info.symbol ?? "",
      uri: "",
      creator: info.creator ?? "",
      createSlot: 0,
      createdAt: now,
      supplyRaw: info.supplyRaw ?? PUMP_SUPPLY_RAW,
      decimals: info.decimals ?? 6,
      price: 0,
      athPrice: 0,
      progress: 0,
      migrated: !mint.endsWith("pump"),
      trades: 0,
      buys: 0,
      sells: 0,
      volumeSol: 0,
      lastTradeAt: now,
      holders: new Map(),
      prices: [],
      devRecipients: new Set(),
      adopted: true,
      risk: { score: 0, level: "low", flags: [], metrics: emptyMetrics() },
    };
    this.launches.set(mint, launch);
    return launch;
  }

  /** Keep a launch alive while something (a watch) still needs it. */
  touch(mint: string, now: number): void {
    const l = this.launches.get(mint);
    if (l) l.lastTradeAt = Math.max(l.lastTradeAt, now);
  }

  /** Attach Blur intel for a mint we know (or create a stub entry for one we don't). */
  attachExternal(mint: string, intel: ExternalIntel): void {
    const l = this.launches.get(mint);
    if (!l) return;
    l.external = intel;
    l.risk = scoreLaunch(l);
  }

  private evict(now: number): void {
    for (const [mint, l] of this.launches) {
      if (!this.pinned.has(mint) && now - l.lastTradeAt > this.opts.idleMs) this.drop(mint);
    }
    for (const mint of this.launches.keys()) {
      if (this.launches.size <= this.opts.maxLaunches) break;
      if (!this.pinned.has(mint)) this.drop(mint);
    }
  }

  private drop(mint: string): void {
    this.launches.delete(mint);
    this.onEvict?.(mint);
  }
}

function isLikelyPool(launch: Launch, wallet: string): boolean {
  if (wallet === launch.curve) return true;
  // AMM vault owners never sign and hold a large share of supply without trading.
  const h = launch.holders.get(wallet);
  return !!h && h.bought === 0 && h.sold === 0 && Math.abs(h.transferred) > launch.supplyRaw * 0.1;
}

export function held(h: Holder): number {
  return Math.max(0, h.bought - h.sold + h.transferred);
}

export function emptyMetrics() {
  return {
    devInitialPct: 0,
    devHeldPct: 0,
    devSoldPct: 0,
    devTransferredPct: 0,
    bundlerPct: 0,
    bundlers: 0,
    sniperPct: 0,
    snipers: 0,
    linkedWallets: 0,
    insiderHeldPct: 0,
    uniqueBuyers: 0,
    buySellRatio: 0,
    drawdownPct: 0,
  };
}
