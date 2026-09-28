/**
 * Builds a live picture of every token launched while Tripwire is running, from the
 * gRPC firehose alone: who created it, who bought in the creation slot, who bought
 * within a few slots, where the dev's tokens went, price, bonding-curve progress and
 * flow. This is our own on-the-fly version of the "intel" a token-safety panel needs,
 * available the second a token exists.
 */
import type { DecodedTx, Flow, LiquidityRemoval } from "./decode.js";
import { PUMP_DECIMALS, PUMP_INITIAL_REAL_TOKENS, PUMP_SUPPLY_RAW, WSOL } from "./decode.js";
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
  /** Wallet that signed the create. Empty when unknown (hand-armed token). */
  creator: string;
  /** Every wallet we treat as the dev: the signer and the curve's recorded creator. */
  devWallets: Set<string>;
  curve?: string;
  /** Curve, Mayhem vault, AMM pools: counterparties, never holders. */
  vaults: Set<string>;
  createSlot: number;
  createdAt: number;
  supplyRaw: number;
  decimals: number;
  initialRealTokens: number;
  quoteMint: string;
  mayhem: boolean;
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
  /** More recipients than we follow: looks like an airdrop, not a split. */
  airdrop: boolean;
  /** Launches by the same creator seen this session (including this one). */
  creatorLaunches: number;
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
  /** Most dev recipients we follow per launch. */
  maxRecipients: number;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  sniperSlots: 5,
  idleMs: 30 * 60_000,
  maxLaunches: 3000,
  maxRecipients: 50,
};

export interface TrackerUpdate {
  launch: Launch;
  created: boolean;
  flows: Flow[];
  removals: LiquidityRemoval[];
  tx: DecodedTx;
}

export class LaunchTracker {
  readonly launches = new Map<string, Launch>();
  onEvict?: (mint: string) => void;
  /** Mints that must not be evicted (watched). */
  pinned = new Set<string>();
  private creatorCounts = new Map<string, number>();

  constructor(private readonly opts: TrackerOptions = DEFAULT_TRACKER_OPTIONS) {}

  get(mint: string): Launch | undefined {
    return this.launches.get(mint);
  }

  /** Feeds one decoded transaction. Returns an update per tracked mint it touched. */
  ingest(tx: DecodedTx, now: number): TrackerUpdate[] {
    if (tx.failed) return [];

    if (tx.launch && !this.launches.has(tx.launch.mint)) {
      const l = tx.launch;
      const n = (this.creatorCounts.get(l.creator) ?? 0) + 1;
      this.creatorCounts.set(l.creator, n);
      if (this.creatorCounts.size > 100_000) this.creatorCounts.clear();
      const launch = blankLaunch(l.mint, now, {
        name: l.name,
        symbol: l.symbol,
        uri: l.uri,
        creator: l.creator,
        supplyRaw: l.supplyRaw,
      });
      launch.devWallets = new Set([l.creator, l.curveCreator].filter(Boolean));
      launch.curve = l.curve;
      launch.vaults = new Set(l.vaults);
      launch.createSlot = tx.slot;
      launch.initialRealTokens = l.initialRealTokens;
      launch.quoteMint = l.quoteMint;
      launch.mayhem = l.mayhem;
      launch.creatorLaunches = n;
      this.launches.set(l.mint, launch);
      this.evict(now);
    }

    const touched = new Set<string>();
    for (const f of tx.flows) if (this.launches.has(f.mint)) touched.add(f.mint);
    for (const r of tx.liquidityRemovals) if (this.launches.has(r.mint)) touched.add(r.mint);
    if (tx.migratedMint && this.launches.has(tx.migratedMint)) touched.add(tx.migratedMint);
    if (tx.launch) touched.add(tx.launch.mint);

    const out: TrackerUpdate[] = [];
    for (const mint of touched) {
      const launch = this.launches.get(mint);
      if (!launch) continue;
      const flows = tx.flows.filter((f) => f.mint === mint);
      this.apply(launch, tx, flows, now);
      out.push({ launch, created: tx.launch?.mint === mint, flows, removals: tx.liquidityRemovals.filter((r) => r.mint === mint), tx });
    }
    return out;
  }

  private apply(launch: Launch, tx: DecodedTx, flows: Flow[], now: number): void {
    for (const p of tx.poolOwners) launch.vaults.add(p);

    const price = tx.prices[launch.mint];
    if (price && Number.isFinite(price) && launch.quoteMint === WSOL) {
      launch.price = price;
      launch.athPrice = Math.max(launch.athPrice, price);
      launch.prices.push({ t: now, p: price });
      if (launch.prices.length > 600) launch.prices.splice(0, launch.prices.length - 600);
    }
    const curve = tx.curves[launch.mint];
    if (curve && !launch.migrated) {
      const init = launch.initialRealTokens || PUMP_INITIAL_REAL_TOKENS;
      launch.progress = Math.min(100, Math.max(0, ((init - curve.realTokens) / init) * 100));
    }
    if (tx.migratedMint === launch.mint) {
      launch.migrated = true;
      launch.progress = 100;
    }

    const devSide = (w: string) => isDevSide(launch, w);

    for (const f of flows) {
      if (launch.vaults.has(f.owner)) continue;
      let h = launch.holders.get(f.owner);
      if (!h) {
        h = { wallet: f.owner, role: this.roleFor(launch, f, tx.slot), firstSlot: tx.slot, bought: 0, sold: 0, transferred: 0, solIn: 0, solOut: 0 };
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

    // Follow the money: whoever receives tokens in a tx where a dev-side wallet sent
    // them becomes "linked" to the dev.
    if (flows.some((f) => f.kind === "transfer_out" && devSide(f.owner))) {
      for (const f of flows) {
        if (f.kind !== "transfer_in" || devSide(f.owner) || launch.vaults.has(f.owner)) continue;
        if (launch.devRecipients.size >= this.opts.maxRecipients) {
          launch.airdrop = true;
          break;
        }
        launch.devRecipients.add(f.owner);
        const h = launch.holders.get(f.owner);
        if (h && h.role === "trader") h.role = "linked";
      }
    }

    launch.risk = scoreLaunch(launch);
  }

  private roleFor(launch: Launch, f: Flow, slot: number): Role {
    if (launch.devWallets.has(f.owner)) return "dev";
    if (launch.devRecipients.has(f.owner)) return "linked";
    if (f.kind !== "buy" || launch.adopted) return "trader";
    const after = slot - launch.createSlot;
    if (after <= 0) return "bundler";
    if (after <= this.opts.sniperSlots) return "sniper";
    return "trader";
  }

  /**
   * Start following a token we did not see launch (armed by hand). Early-buyer roles
   * cannot be reconstructed, but price, flows and dev activity can.
   */
  adopt(mint: string, info: { creator?: string; name?: string; symbol?: string; supplyRaw?: number; decimals?: number }, now: number): Launch {
    const existing = this.launches.get(mint);
    if (existing) return existing;
    const launch = blankLaunch(mint, now, info);
    launch.adopted = true;
    launch.migrated = !mint.endsWith("pump");
    launch.risk = scoreLaunch(launch);
    this.launches.set(mint, launch);
    return launch;
  }

  /** Set or update what we know about an adopted token (from Blur or RPC). */
  describe(mint: string, info: { creator?: string; name?: string; symbol?: string; supplyRaw?: number; decimals?: number; migrated?: boolean }): void {
    const l = this.launches.get(mint);
    if (!l) return;
    if (info.creator && !l.creator) {
      l.creator = info.creator;
      l.devWallets.add(info.creator);
      const h = l.holders.get(info.creator);
      if (h) h.role = "dev";
    }
    if (info.name && !l.name) l.name = info.name;
    if (info.symbol && !l.symbol) l.symbol = info.symbol;
    if (info.supplyRaw) l.supplyRaw = info.supplyRaw;
    if (info.decimals !== undefined) l.decimals = info.decimals;
    if (info.migrated !== undefined) l.migrated = info.migrated;
    l.risk = scoreLaunch(l);
  }

  /** Keep a launch alive while something (a watch) still needs it. */
  touch(mint: string, now: number): void {
    const l = this.launches.get(mint);
    if (l) l.lastTradeAt = Math.max(l.lastTradeAt, now);
  }

  /** Attach Blur intel for a mint we are tracking. */
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

function blankLaunch(mint: string, now: number, info: { creator?: string; name?: string; symbol?: string; uri?: string; supplyRaw?: number; decimals?: number }): Launch {
  return {
    mint,
    name: info.name ?? "",
    symbol: info.symbol ?? "",
    uri: info.uri ?? "",
    creator: info.creator ?? "",
    devWallets: new Set(info.creator ? [info.creator] : []),
    vaults: new Set(),
    createSlot: 0,
    createdAt: now,
    supplyRaw: info.supplyRaw ?? PUMP_SUPPLY_RAW,
    decimals: info.decimals ?? PUMP_DECIMALS,
    initialRealTokens: PUMP_INITIAL_REAL_TOKENS,
    quoteMint: WSOL,
    mayhem: false,
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
    airdrop: false,
    creatorLaunches: 1,
    risk: { score: 0, level: "low", flags: [], metrics: emptyMetrics() },
  };
}

/** The dev, or a wallet the dev sent tokens to. Never matches an unknown (empty) dev. */
export function isDevSide(l: Launch, wallet: string): boolean {
  return !!wallet && (l.devWallets.has(wallet) || l.devRecipients.has(wallet));
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
