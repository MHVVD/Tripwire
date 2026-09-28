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
    curveProgress: { [MINT]: 10 },
    ...extra,
  };
}
const buy = (owner: string, p: number, sol = 1): Partial<Flow> => ({ owner, tokenDelta: pct(p), solDelta: -sol * 1e9, kind: "buy" });
const sell = (owner: string, p: number, sol = 1): Partial<Flow> => ({ owner, tokenDelta: -pct(p), solDelta: sol * 1e9, kind: "sell" });

function launched() {
  const t = new LaunchTracker();
  const launch = { mint: MINT, creator: DEV, name: "Rug", symbol: "RUG", uri: "", curve: CURVE };
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
    const w = newWatch(MINT, 20_000, 4e-8);
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

  it("fires crash on a fast drop and measures the drop avoided afterwards", () => {
    const t = launched();
    const w = newWatch(MINT, 20_000, 4e-8);
    evaluate(w, t.ingest(tx(300, [buy("Trader2", 1)], 5e-8), 30_000)[0], 30_000);
    const fired = evaluate(w, t.ingest(tx(301, [sell("Trader2", 1, 0.2)], 3e-8), 35_000)[0], 35_000);
    const crash = fired.find((a) => a.rule === "crash")!;
    expect(crash).toBeDefined();
    const l = t.ingest(tx(302, [sell("Trader1", 0.5, 0.05)], 0.6e-8), 60_000)[0].launch;
    followUp(w, l, 60_000);
    expect(crash.avoidedPct).toBeCloseTo(80, 0);
  });
});
