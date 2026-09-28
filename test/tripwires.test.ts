import { describe, expect, it } from "vitest";
import type { DecodedTx, Flow } from "../src/engine/decode.js";
import { PUMP_SUPPLY_RAW } from "../src/engine/decode.js";
import { LaunchTracker } from "../src/engine/tracker.js";
import { evaluate, followUp, newWatch } from "../src/engine/tripwires.js";

const MINT = "Mint1111111111111111111111111111111111pump";
const DEV = "Dev11111111111111111111111111111111111111";
const CURVE = "Curve111111111111111111111111111111111111";
const pct = (p: number) => Math.round((PUMP_SUPPLY_RAW * p) / 100);

let n = 0;
function tx(slot: number, flows: Partial<Flow>[], price = 3e-8, extra: Partial<DecodedTx> = {}): DecodedTx {
  return {
    signature: `sig${n++}`,
    slot,
    signers: [],
    feeLamports: 5000,
    failed: false,
    flows: flows.map((f) => ({ mint: MINT, owner: "x", tokenDelta: 0, solDelta: 0, kind: "buy", signer: true, ...f }) as Flow),
    prices: { [MINT]: price },
    curves: {},
    liquidityRemovals: [],
    poolOwners: [],
    ...extra,
  };
}
const buy = (owner: string, p: number, sol = 1): Partial<Flow> => ({ owner, tokenDelta: pct(p), solDelta: -sol * 1e9, kind: "buy" });
const sell = (owner: string, p: number, sol = 1): Partial<Flow> => ({ owner, tokenDelta: -pct(p), solDelta: sol * 1e9, kind: "sell" });

function launched() {
  const t = new LaunchTracker();
  const launch = {
    mint: MINT, creator: DEV, curveCreator: DEV, name: "Rug", symbol: "RUG", uri: "", curve: CURVE,
    vaults: [CURVE], supplyRaw: PUMP_SUPPLY_RAW, initialRealTokens: 793_100_000_000_000, mayhem: false,
    quoteMint: "So11111111111111111111111111111111111111112",
  };
  t.ingest(tx(100, [buy(DEV, 8)], 2.8e-8, { launch }), 0);
  t.ingest(tx(100, [buy("Bundle1", 6), buy("Bundle2", 6)]), 10);
  t.ingest(tx(103, [buy("Sniper1", 5)]), 400);
  t.ingest(tx(150, [buy("Trader1", 1)], 4e-8), 20_000);
  return t;
}

describe("LaunchTracker", () => {
  it("assigns dev, bundler, sniper and trader roles from slot timing", () => {
    const l = launched().get(MINT)!;
    expect(l.holders.get(DEV)!.role).toBe("dev");
    expect(l.holders.get("Bundle1")!.role).toBe("bundler");
    expect(l.holders.get("Sniper1")!.role).toBe("sniper");
    expect(l.holders.get("Trader1")!.role).toBe("trader");
  });

  it("scores a bundled launch as risky and says why", () => {
    const r = launched().get(MINT)!.risk;
    expect(r.metrics.bundlerPct).toBeCloseTo(12, 5);
    expect(r.flags.map((f) => f.id)).toContain("bundled");
    expect(r.score).toBeGreaterThanOrEqual(45);
  });

  it("follows tokens the dev sends to fresh wallets", () => {
    const t = launched();
    t.ingest(tx(200, [{ owner: DEV, tokenDelta: -pct(4), solDelta: 0, kind: "transfer_out" }, { owner: "Fresh1", tokenDelta: pct(4), solDelta: 0, kind: "transfer_in", signer: false }]), 30_000);
    const l = t.get(MINT)!;
    expect(l.devRecipients.has("Fresh1")).toBe(true);
    expect(l.risk.flags.map((f) => f.id)).toContain("dev_moved");
  });
});

describe("tripwires", () => {
  it("fires dev_sell when the dev dumps, with cooldown", () => {
    const t = launched();
    const w = newWatch(MINT, 20_000, 4e-8);
    const u1 = t.ingest(tx(300, [sell(DEV, 4, 3)], 2e-8), 40_000)[0];
    const a1 = evaluate(w, u1, 40_000);
    expect(a1.map((a) => a.rule)).toContain("dev_sell");
    expect(a1.find((a) => a.rule === "dev_sell")!.severity).toBe("critical");
    const u2 = t.ingest(tx(301, [sell(DEV, 4, 1)], 1.5e-8), 41_000)[0];
    expect(evaluate(w, u2, 41_000).map((a) => a.rule)).not.toContain("dev_sell");
  });

  it("fires dev_transfer and then catches the linked wallet selling as the dev", () => {
    const t = launched();
    const w = newWatch(MINT, 20_000, 4e-8);
    const u1 = t.ingest(tx(300, [{ owner: DEV, tokenDelta: -pct(3), solDelta: 0, kind: "transfer_out" }, { owner: "Fresh1", tokenDelta: pct(3), solDelta: 0, kind: "transfer_in", signer: false }]), 40_000)[0];
    expect(evaluate(w, u1, 40_000).map((a) => a.rule)).toContain("dev_transfer");
    const u2 = t.ingest(tx(310, [sell("Fresh1", 3, 2)], 2e-8), 45_000)[0];
    const fired = evaluate(w, u2, 45_000);
    expect(fired.find((a) => a.rule === "dev_sell")?.title).toMatch(/Dev-linked/);
  });

  it("fires cohort_dump when bundlers and snipers sell together inside the window", () => {
    const t = launched();
    const w = newWatch(MINT, 20_000, 4e-8, { rules: { crashPct: 99 } });
    evaluate(w, t.ingest(tx(300, [sell("Bundle1", 2)]), 40_000)[0], 40_000);
    const fired = evaluate(w, t.ingest(tx(301, [sell("Sniper1", 2)]), 50_000)[0], 50_000);
    expect(fired.map((a) => a.rule)).toContain("cohort_dump");
  });

  it("does not count ordinary traders as insiders", () => {
    const t = launched();
    const w = newWatch(MINT, 20_000, 4e-8);
    const fired = evaluate(w, t.ingest(tx(300, [sell("Trader1", 1, 0.5)]), 40_000)[0], 40_000);
    expect(fired).toHaveLength(0);
  });

  it("sizes a dev sale against what the dev still held, not what it first bought", () => {
    const t = launched();
    const w = newWatch(MINT, 20_000, 4e-8);
    t.ingest(tx(300, [{ owner: DEV, tokenDelta: -pct(7.6), solDelta: 0, kind: "transfer_out" }, { owner: "Fresh1", tokenDelta: pct(7.6), solDelta: 0, kind: "transfer_in", signer: false }]), 40_000);
    // Dev had 8%, moved 7.6%, now sells the last 0.4%: that is 100% of the bag.
    const fired = evaluate(w, t.ingest(tx(301, [sell(DEV, 0.4, 0.2)]), 400_000)[0], 400_000);
    expect(fired.find((a) => a.rule === "dev_sell")?.detail).toMatch(/100% of its bag/);
  });

  it("folds repeated critical triggers into one alert per episode", () => {
    const t = launched();
    const w = newWatch(MINT, 20_000, 4e-8);
    expect(evaluate(w, t.ingest(tx(300, [sell(DEV, 4, 3)], 2e-8), 40_000)[0], 40_000).filter((a) => a.severity === "critical")).toHaveLength(1);
    const again = evaluate(w, t.ingest(tx(301, [sell("Bundle1", 5), sell("Sniper1", 4)], 1e-8), 41_000)[0], 41_000);
    expect(again.filter((a) => a.severity === "critical")).toHaveLength(0);
    expect(w.alerts[0].suppressed).toBeGreaterThan(0);
  });

  it("only fires lp_pull when the pool itself loses a real share", () => {
    const t = launched();
    const w = newWatch(MINT, 20_000, 4e-8);
    const small = evaluate(w, t.ingest(tx(300, [], 4e-8, { liquidityRemovals: [{ mint: MINT, pool: "Pool", pctOfPool: 5, solOut: 3e9, recipients: ["X"] }] }), 40_000)[0], 40_000);
    expect(small).toHaveLength(0);
    const big = evaluate(w, t.ingest(tx(301, [], 4e-8, { liquidityRemovals: [{ mint: MINT, pool: "Pool", pctOfPool: 80, solOut: 30e9, recipients: ["X"] }] }), 41_000)[0], 41_000);
    expect(big.map((a) => a.rule)).toContain("lp_pull");
  });

  it("catches a crash that spans a quiet stretch longer than the window", () => {
    const t = launched();
    const w = newWatch(MINT, 20_000, 4e-8);
    evaluate(w, t.ingest(tx(300, [buy("Trader2", 0.5)], 4e-8), 30_000)[0], 30_000);
    const fired = evaluate(w, t.ingest(tx(900, [sell("Trader2", 0.5, 0.2)], 1e-8), 230_000)[0], 230_000);
    expect(fired.map((a) => a.rule)).toContain("crash");
  });

  it("never treats flows as dev-side when the dev is unknown", () => {
    const t = new LaunchTracker();
    const l = t.adopt(MINT, {}, 0);
    expect(l.risk.level).toBe("unknown");
    const w = newWatch(MINT, 0, 3e-8);
    const u = t.ingest(tx(10, [{ owner: "", tokenDelta: -pct(5), solDelta: 1e9, kind: "sell" }]), 1000)[0];
    expect(evaluate(w, u, 1000).map((a) => a.rule)).not.toContain("dev_sell");
  });

  it("fires crash on a fast drop and measures the outcome afterwards", () => {
    const t = launched();
    const w = newWatch(MINT, 20_000, 4e-8);
    evaluate(w, t.ingest(tx(300, [buy("Trader2", 1)], 5e-8), 30_000)[0], 30_000);
    const fired = evaluate(w, t.ingest(tx(301, [sell("Trader2", 1, 0.2)], 3e-8), 35_000)[0], 35_000);
    const crash = fired.find((a) => a.rule === "crash")!;
    expect(crash).toBeDefined();
    const l = t.ingest(tx(302, [sell("Trader1", 0.5, 0.05)], 0.6e-8), 60_000)[0].launch;
    followUp(w, l, 60_000);
    expect(crash.avoidedPct).toBeCloseTo(80, 0);
    followUp(w, l, 35_000 + 5 * 60_000);
    expect(crash.move1m).toBeCloseTo(-80, 0);
    expect(crash.move5m).toBeCloseTo(-80, 0);
  });
});
