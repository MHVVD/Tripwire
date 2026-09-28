/**
 * Risk score for a launch, 0 (clean) to 100 (walk away). Pure function of the
 * tracker's state plus whatever Blur intel we could attach. Every point comes with a
 * plain-English flag so the UI can say *why*.
 */
import type { Launch } from "./tracker.js";
import { held } from "./tracker.js";

export type Level = "unknown" | "low" | "medium" | "high" | "critical";

export interface RiskFlag {
  id: string;
  severity: "info" | "warning" | "danger";
  weight: number;
  detail: string;
}

export interface RiskMetrics {
  devInitialPct: number;
  devHeldPct: number;
  devSoldPct: number;
  devTransferredPct: number;
  bundlerPct: number;
  bundlers: number;
  sniperPct: number;
  snipers: number;
  linkedWallets: number;
  insiderHeldPct: number;
  uniqueBuyers: number;
  buySellRatio: number;
  drawdownPct: number;
}

export interface RiskReport {
  score: number;
  level: Level;
  flags: RiskFlag[];
  metrics: RiskMetrics;
}

/** What Blur's REST API can add for a mint: intel, security and dev history. */
export interface ExternalIntel {
  source: "blur";
  intelScore?: number;
  rugged?: boolean;
  intelFlags?: { name: string; level: string; detail: string }[];
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  top10Pct?: number;
  devTokensLaunched?: number;
  devMigrated?: number;
  bundlerHeldPct?: number;
  sniperHeldPct?: number;
  insiderHeldPct?: number;
  fundingClusterPct?: number;
  fundedByDev?: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

export function computeMetrics(l: Launch): RiskMetrics {
  let devInitial = 0;
  let devHeld = 0;
  let devSold = 0;
  let devTransferred = 0;
  let bundlerInitial = 0;
  let bundlers = 0;
  let sniperInitial = 0;
  let snipers = 0;
  let linked = 0;
  let insiderHeld = 0;
  let uniqueBuyers = 0;
  for (const h of l.holders.values()) {
    if (h.bought > 0) uniqueBuyers++;
    if (h.role === "dev") {
      devInitial += h.bought;
      devHeld += held(h);
      devSold += h.sold;
      devTransferred += Math.max(0, -h.transferred);
    } else if (h.role === "bundler") {
      bundlers++;
      bundlerInitial += h.bought;
    } else if (h.role === "sniper") {
      snipers++;
      sniperInitial += h.bought;
    } else if (h.role === "linked") {
      linked++;
    }
    if (h.role !== "trader") insiderHeld += held(h);
  }
  const drawdown = l.athPrice > 0 ? Math.max(0, (1 - l.price / l.athPrice) * 100) : 0;
  return {
    devInitialPct: pct(devInitial, l.supplyRaw),
    devHeldPct: pct(devHeld, l.supplyRaw),
    devSoldPct: devInitial > 0 ? Math.min(100, pct(devSold, devInitial)) : 0,
    devTransferredPct: pct(devTransferred, l.supplyRaw),
    bundlerPct: pct(bundlerInitial, l.supplyRaw),
    bundlers,
    sniperPct: pct(sniperInitial, l.supplyRaw),
    snipers,
    linkedWallets: Math.max(linked, l.devRecipients.size),
    insiderHeldPct: pct(insiderHeld, l.supplyRaw),
    uniqueBuyers,
    buySellRatio: l.sells > 0 ? l.buys / l.sells : l.buys,
    drawdownPct: drawdown,
  };
}

export function scoreLaunch(l: Launch): RiskReport {
  const m = computeMetrics(l);
  const flags: RiskFlag[] = [];
  const add = (id: string, severity: RiskFlag["severity"], weight: number, detail: string) =>
    flags.push({ id, severity, weight, detail });
  const f1 = (n: number) => n.toFixed(1);

  const sameSlot = `${plural(m.bundlers, "same-slot buyer")} took ${f1(m.bundlerPct)}% in the creation slot`;
  if (m.bundlerPct >= 10) add("bundled", "danger", 30, sameSlot);
  else if (m.bundlerPct >= 3) add("bundled", "warning", 15, sameSlot);

  const sniped = `${plural(m.snipers, "sniper")} took ${f1(m.sniperPct)}% within 5 slots`;
  if (m.sniperPct >= 20) add("sniped", "danger", 20, sniped);
  else if (m.sniperPct >= 8) add("sniped", "warning", 10, sniped);

  if (m.devInitialPct >= 10) add("dev_bag", "warning", 15, `dev bought ${f1(m.devInitialPct)}% of supply at launch`);

  if (m.devSoldPct >= 50) add("dev_dumped", "danger", 25, `dev has sold ${f1(m.devSoldPct)}% of their bag`);
  else if (m.devSoldPct >= 10) add("dev_selling", "warning", 12, `dev has sold ${f1(m.devSoldPct)}% of their bag`);

  if (m.devTransferredPct >= 0.5)
    add("dev_moved", "danger", 20, `dev moved ${f1(m.devTransferredPct)}% of supply to ${plural(l.devRecipients.size, "other wallet")}`);

  if (l.creatorLaunches >= 3) add("serial_launcher", "danger", 20, `creator launched ${l.creatorLaunches} tokens since Tripwire started`);
  if (l.airdrop) add("airdrop", "info", 0, "dev sent tokens to 50+ wallets (airdrop); only the first 50 are followed");

  if (m.insiderHeldPct >= 25) add("insiders_hold", "danger", 20, `dev, bundlers and snipers still hold ${f1(m.insiderHeldPct)}%`);
  else if (m.insiderHeldPct >= 12) add("insiders_hold", "warning", 10, `dev, bundlers and snipers still hold ${f1(m.insiderHeldPct)}%`);

  if (m.drawdownPct >= 70 && l.trades > 10) add("collapsed", "danger", 20, `price is ${f1(m.drawdownPct)}% below its high`);

  const x = l.external;
  if (x) {
    if (x.rugged) add("rugged", "danger", 40, "Blur marks this token as rugged (liquidity drained after real volume)");
    if (x.mintAuthority) add("mint_authority", "danger", 25, "mint authority is not revoked");
    if (x.freezeAuthority) add("freeze_authority", "danger", 25, "freeze authority is not revoked");
    if (x.top10Pct !== undefined && x.top10Pct >= 50) add("concentrated", "warning", 10, `top 10 holders own ${f1(x.top10Pct)}%`);
    if (x.devTokensLaunched !== undefined && x.devTokensLaunched >= 10 && !flags.some((f) => f.id === "serial_launcher")) {
      const rate = pct(x.devMigrated ?? 0, x.devTokensLaunched);
      if (rate < 5) add("serial_launcher", "danger", 20, `dev launched ${x.devTokensLaunched} tokens, ${x.devMigrated ?? 0} ever graduated`);
    }
    if (x.fundedByDev) add("dev_funded_buyers", "danger", 25, "early buyers were funded by the dev wallet");
    else if (x.fundingClusterPct !== undefined && x.fundingClusterPct >= 30)
      add("cluster", "warning", 15, `${f1(x.fundingClusterPct)}% of early buyers share one funder`);
    for (const f of x.intelFlags ?? []) {
      if (flags.some((g) => g.id === f.name)) continue;
      if (f.name === "no_socials") add(f.name, "info", 3, f.detail);
    }
  }

  const score = Math.min(100, flags.reduce((s, f) => s + f.weight, 0));
  // A hand-armed token with no launch history and no Blur data: we simply don't know.
  const unknown = l.adopted && !x && l.trades < 5;
  const level: Level = unknown ? "unknown" : score >= 70 ? "critical" : score >= 45 ? "high" : score >= 20 ? "medium" : "low";
  return { score, level, flags, metrics: m };
}
