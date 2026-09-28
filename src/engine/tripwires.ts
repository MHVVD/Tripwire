/**
 * Tripwires: per-token rules that fire the moment insiders start heading for the door.
 * Pure logic - the caller feeds tracker updates and gets alerts back; exits, alerts
 * and the UI hang off those.
 */
import type { Flow } from "./decode.js";
import type { Launch, TrackerUpdate } from "./tracker.js";

export type RuleId = "dev_sell" | "cohort_dump" | "dev_transfer" | "lp_pull" | "crash" | "whale_sell";
export type Severity = "critical" | "warning";

export interface Rules {
  /** Dev sells at least this % of their own bag in one go. */
  devSellBagPct: number;
  /** ...or at least this % of total supply. */
  devSellSupplyPct: number;
  /** Bundlers + snipers + dev-linked wallets together sell this % of supply within windowMs. */
  cohortDumpPct: number;
  /** Dev sends at least this % of supply to other wallets. */
  devTransferPct: number;
  /** Price falls this % below its high within windowMs. */
  crashPct: number;
  /** A single sell of at least this % of supply by anyone. */
  whaleSellPct: number;
  /** Someone withdraws liquidity (receives token and SOL together). */
  lpPull: boolean;
  windowMs: number;
  cooldownMs: number;
}

export const DEFAULT_RULES: Rules = {
  devSellBagPct: 25,
  devSellSupplyPct: 1,
  cohortDumpPct: 3,
  devTransferPct: 0.5,
  crashPct: 35,
  whaleSellPct: 2,
  lpPull: true,
  windowMs: 90_000,
  cooldownMs: 60_000,
};

export const CRITICAL_RULES: ReadonlySet<RuleId> = new Set(["dev_sell", "cohort_dump", "lp_pull", "crash"]);

export interface Alert {
  id: string;
  t: number;
  mint: string;
  symbol: string;
  rule: RuleId;
  severity: Severity;
  title: string;
  detail: string;
  signature: string;
  slot: number;
  wallet?: string;
  price: number;
  /** ms from the slot first appearing on our slot stream to this alert. */
  detectMs?: number;
  /** Filled in afterwards: lowest price seen after the alert, and the drop avoided. */
  minPriceAfter?: number;
  avoidedPct?: number;
  followUntil: number;
}

export interface Watch {
  mint: string;
  armedAt: number;
  source: "manual" | "auto" | "position";
  rules: Rules;
  autoExit: boolean;
  /** Price when armed, used for the paper position. */
  entryPrice: number;
  fired: Partial<Record<RuleId, number>>;
  /** Set once an auto-exit has been triggered, so one watch never sells twice. */
  exitedAt?: number;
  cohortSells: { t: number; amount: number }[];
  highs: { t: number; p: number }[];
  alerts: Alert[];
}

export function newWatch(mint: string, now: number, price: number, opts: Partial<Pick<Watch, "source" | "autoExit">> & { rules?: Partial<Rules> } = {}): Watch {
  return {
    mint,
    armedAt: now,
    source: opts.source ?? "manual",
    rules: { ...DEFAULT_RULES, ...opts.rules },
    autoExit: opts.autoExit ?? false,
    entryPrice: price,
    fired: {},
    cohortSells: [],
    highs: price > 0 ? [{ t: now, p: price }] : [],
    alerts: [],
  };
}

let seq = 0;
const fmt = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(2));
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

export function evaluate(w: Watch, u: TrackerUpdate, now: number, slotSeenAt?: number): Alert[] {
  const l = u.launch;
  const r = w.rules;
  const supply = l.supplyRaw;
  const out: Alert[] = [];
  const devSide = (wallet: string) => wallet === l.creator || l.devRecipients.has(wallet);
  const insider = (wallet: string) => {
    const role = l.holders.get(wallet)?.role;
    return role === "bundler" || role === "sniper" || role === "linked" || role === "dev";
  };

  const fire = (rule: RuleId, title: string, detail: string, f?: Flow) => {
    const last = w.fired[rule];
    if (last !== undefined && now - last < r.cooldownMs) return;
    w.fired[rule] = now;
    const alert: Alert = {
      id: `${now.toString(36)}-${(seq++).toString(36)}`,
      t: now,
      mint: l.mint,
      symbol: l.symbol || l.mint.slice(0, 6),
      rule,
      severity: CRITICAL_RULES.has(rule) ? "critical" : "warning",
      title,
      detail,
      signature: u.tx.signature,
      slot: u.tx.slot,
      wallet: f?.owner,
      price: l.price,
      detectMs: slotSeenAt !== undefined ? Math.max(0, now - slotSeenAt) : undefined,
      minPriceAfter: l.price,
      avoidedPct: 0,
      followUntil: now + 10 * 60_000,
    };
    w.alerts.push(alert);
    out.push(alert);
  };

  for (const f of u.flows) {
    const amt = Math.abs(f.tokenDelta);
    const supplyPct = (amt / supply) * 100;

    if (f.kind === "sell" && devSide(f.owner)) {
      const h = l.holders.get(f.owner);
      const bagBefore = h ? Math.max(1, h.bought + Math.max(0, h.transferred) - (h.sold - amt)) : amt;
      const bagPct = Math.min(100, (amt / bagBefore) * 100);
      if (bagPct >= r.devSellBagPct || supplyPct >= r.devSellSupplyPct) {
        const who = f.owner === l.creator ? "Dev" : "Dev-linked wallet";
        fire("dev_sell", `${who} sold ${fmt(supplyPct)}% of supply`, `${short(f.owner)} dumped ${fmt(bagPct)}% of its bag for ${(f.solDelta / 1e9).toFixed(2)} SOL`, f);
      }
    }

    if (f.kind === "transfer_out" && devSide(f.owner) && supplyPct >= r.devTransferPct) {
      fire("dev_transfer", `Dev moved ${fmt(supplyPct)}% of supply`, `${short(f.owner)} sent tokens to ${l.devRecipients.size} fresh wallet(s) - classic pre-dump split`, f);
    }

    if (f.kind === "sell" && insider(f.owner)) {
      w.cohortSells.push({ t: now, amount: amt });
    }

    if (f.kind === "sell" && supplyPct >= r.whaleSellPct && f.solDelta >= 0.1e9 && !devSide(f.owner)) {
      fire("whale_sell", `Whale sold ${fmt(supplyPct)}% of supply`, `${short(f.owner)} (${l.holders.get(f.owner)?.role ?? "trader"}) sold for ${(f.solDelta / 1e9).toFixed(2)} SOL`, f);
    }

    if (r.lpPull && f.signer && f.kind === "transfer_in" && f.solDelta > 0 && l.migrated) {
      fire("lp_pull", "Liquidity pulled", `${short(f.owner)} withdrew tokens and ${(f.solDelta / 1e9).toFixed(2)} SOL from the pool`, f);
    }
  }

  // Rolling insider dump.
  w.cohortSells = w.cohortSells.filter((s) => now - s.t <= r.windowMs);
  const dumped = (w.cohortSells.reduce((s, x) => s + x.amount, 0) / supply) * 100;
  if (dumped >= r.cohortDumpPct) {
    fire("cohort_dump", `Insiders dumped ${fmt(dumped)}% in ${Math.round(r.windowMs / 1000)}s`, `bundlers, snipers and dev-linked wallets are selling together`);
  }

  // Crash from the rolling high.
  if (l.price > 0) {
    w.highs.push({ t: now, p: l.price });
    w.highs = w.highs.filter((h) => now - h.t <= r.windowMs);
    const high = Math.max(...w.highs.map((h) => h.p));
    const drop = (1 - l.price / high) * 100;
    if (drop >= r.crashPct) fire("crash", `Price -${fmt(drop)}% in ${Math.round(r.windowMs / 1000)}s`, `from ${high.toExponential(3)} to ${l.price.toExponential(3)} SOL`);
  }

  return out;
}

/** Update "loss avoided" on alerts still being followed. */
export function followUp(w: Watch, l: Launch, now: number): void {
  if (!(l.price > 0)) return;
  for (const a of w.alerts) {
    if (now > a.followUntil || !(a.price > 0)) continue;
    a.minPriceAfter = Math.min(a.minPriceAfter ?? a.price, l.price);
    a.avoidedPct = Math.max(0, (1 - a.minPriceAfter / a.price) * 100);
  }
}
