/**
 * Tripwires: per-token rules that fire the moment insiders start heading for the door.
 * Pure logic - the caller feeds tracker updates and gets alerts back; exits, alerts
 * and the UI hang off those.
 */
import type { Flow } from "./decode.js";
import { held, isDevSide, type Launch, type TrackerUpdate } from "./tracker.js";

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
  /** A pool loses at least this % of its token side in one withdrawal (and >= 0.5 SOL). */
  lpPullPct: number;
  windowMs: number;
  /** Per-rule cooldown for warnings. */
  cooldownMs: number;
  /** After a critical alert, further critical triggers within this window fold into it. */
  episodeMs: number;
}

export const DEFAULT_RULES: Rules = {
  devSellBagPct: 25,
  devSellSupplyPct: 1,
  cohortDumpPct: 3,
  devTransferPct: 0.5,
  crashPct: 35,
  whaleSellPct: 2,
  lpPullPct: 20,
  windowMs: 90_000,
  cooldownMs: 60_000,
  episodeMs: 5 * 60_000,
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
  /** Signed % price change 1 and 5 minutes after the alert. */
  move1m?: number;
  move5m?: number;
  /** Further critical triggers folded into this alert. */
  suppressed: number;
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
  exitAttempts?: number;
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
  const devSide = (wallet: string) => isDevSide(l, wallet);
  const insider = (wallet: string) => {
    const role = l.holders.get(wallet)?.role;
    return role === "bundler" || role === "sniper" || role === "linked" || role === "dev";
  };

  const fire = (rule: RuleId, title: string, detail: string, wallet?: string) => {
    const severity: Severity = CRITICAL_RULES.has(rule) ? "critical" : "warning";
    if (severity === "critical") {
      const open = [...w.alerts].reverse().find((a) => a.severity === "critical" && now - a.t < r.episodeMs);
      if (open) {
        open.suppressed++;
        return;
      }
    } else {
      const last = w.fired[rule];
      if (last !== undefined && now - last < r.cooldownMs) return;
    }
    w.fired[rule] = now;
    const alert: Alert = {
      id: `${now.toString(36)}-${(seq++).toString(36)}`,
      t: now,
      mint: l.mint,
      symbol: l.symbol || l.mint.slice(0, 6),
      rule,
      severity,
      title,
      detail,
      signature: u.tx.signature,
      slot: u.tx.slot,
      wallet,
      price: l.price,
      detectMs: slotSeenAt !== undefined ? Math.max(0, now - slotSeenAt) : undefined,
      minPriceAfter: l.price,
      avoidedPct: 0,
      suppressed: 0,
      followUntil: now + 10 * 60_000,
    };
    w.alerts.push(alert);
    if (w.alerts.length > 100) w.alerts.shift();
    out.push(alert);
  };

  for (const f of u.flows) {
    const amt = Math.abs(f.tokenDelta);
    const supplyPct = (amt / supply) * 100;
    const sol = Math.abs(f.solDelta) / 1e9;

    if (f.kind === "sell" && devSide(f.owner)) {
      // The tracker has already applied this sale, so the bag before it is what the
      // wallet holds now plus what it just sold.
      const h = l.holders.get(f.owner);
      const bagBefore = Math.max(amt, (h ? held(h) : 0) + amt);
      const bagPct = Math.min(100, (amt / bagBefore) * 100);
      if (bagPct >= r.devSellBagPct || supplyPct >= r.devSellSupplyPct) {
        const who = l.devWallets.has(f.owner) ? "Dev" : "Dev-linked wallet";
        fire("dev_sell", `${who} sold ${fmt(supplyPct)}% of supply`, `${short(f.owner)} sold ${fmt(bagPct)}% of its bag for ${sol.toFixed(2)} SOL`, f.owner);
      }
    }

    if (f.kind === "transfer_out" && devSide(f.owner) && supplyPct >= r.devTransferPct) {
      const to = u.flows.filter((g) => g.kind === "transfer_in" && !l.devWallets.has(g.owner)).length;
      fire("dev_transfer", `Dev moved ${fmt(supplyPct)}% of supply`, `${short(f.owner)} sent tokens to ${to === 1 ? "a fresh wallet" : `${to} wallets`} - classic pre-dump split`, f.owner);
    }

    if (f.kind === "sell" && insider(f.owner)) w.cohortSells.push({ t: now, amount: amt });

    if (f.kind === "sell" && supplyPct >= r.whaleSellPct && sol >= 0.1 && !devSide(f.owner)) {
      fire("whale_sell", `Whale sold ${fmt(supplyPct)}% of supply`, `${short(f.owner)} (${l.holders.get(f.owner)?.role ?? "trader"}) sold for ${sol.toFixed(2)} SOL`, f.owner);
    }
  }

  for (const rm of u.removals) {
    if (rm.pctOfPool >= r.lpPullPct && rm.solOut >= 0.5e9) {
      fire("lp_pull", `Liquidity pulled: ${fmt(rm.pctOfPool)}% of the pool`, `${(rm.solOut / 1e9).toFixed(2)} SOL withdrawn to ${rm.recipients.map(short).join(", ") || "?"}`, rm.recipients[0]);
    }
  }

  // Rolling insider dump.
  w.cohortSells = w.cohortSells.filter((s) => now - s.t <= r.windowMs);
  const dumped = (w.cohortSells.reduce((s, x) => s + x.amount, 0) / supply) * 100;
  if (dumped >= r.cohortDumpPct) {
    fire("cohort_dump", `Insiders dumped ${fmt(dumped)}% in ${Math.round(r.windowMs / 1000)}s`, "same-slot buyers, snipers and dev-linked wallets are selling together");
  }

  // Crash from the rolling high. The last price from before the window stays in, so a
  // drop that spans a quiet stretch still counts.
  if (l.price > 0) {
    w.highs.push({ t: now, p: l.price });
    const inWindow = w.highs.filter((h) => now - h.t <= r.windowMs);
    const before = w.highs.filter((h) => now - h.t > r.windowMs).pop();
    w.highs = before ? [before, ...inWindow] : inWindow;
    const high = Math.max(...w.highs.map((h) => h.p));
    const drop = (1 - l.price / high) * 100;
    if (drop >= r.crashPct) fire("crash", `Price -${fmt(drop)}% in ${Math.round((now - w.highs[0].t) / 1000)}s`, `from ${high.toExponential(3)} to ${l.price.toExponential(3)} SOL`);
  }

  return out;
}

/**
 * Outcome after each alert: the lowest price within 10 minutes (best case for an exit)
 * and the signed price move at +1 and +5 minutes. Returns alerts that changed.
 */
export function followUp(w: Watch, l: Launch, now: number): Alert[] {
  const changed: Alert[] = [];
  if (!(l.price > 0)) return changed;
  for (const a of w.alerts) {
    if (!(a.price > 0) || now > a.followUntil + 60_000) continue;
    const move = (l.price / a.price - 1) * 100;
    let dirty = false;
    if (now <= a.followUntil) {
      const min = Math.min(a.minPriceAfter ?? a.price, l.price);
      if (min !== a.minPriceAfter) {
        a.minPriceAfter = min;
        a.avoidedPct = Math.max(0, (1 - min / a.price) * 100);
        dirty = true;
      }
    }
    if (a.move1m === undefined && now - a.t >= 60_000) {
      a.move1m = move;
      dirty = true;
    }
    if (a.move5m === undefined && now - a.t >= 5 * 60_000) {
      a.move5m = move;
      dirty = true;
    }
    if (dirty) changed.push(a);
  }
  return changed;
}
