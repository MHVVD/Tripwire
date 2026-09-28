import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { bondingCurveOf, decodeTx, parsePumpEvents, type RawTxUpdate } from "../src/engine/decode.js";

const load = (f: string) => (JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8")) as RawTxUpdate[]).map((u) => decodeTx(u)!);
const pump = load("pump-mainnet.json");
const mixed = load("mainnet-mixed.json");
const all = [...pump, ...mixed];
const bySig = (prefix: string) => all.find((d) => d.signature.startsWith(prefix))!;

describe("pump.fun launches (captured mainnet)", () => {
  it("reads name, symbol, creator, curve and supply from the CreateEvent", () => {
    const ghost = all.find((d) => d.launch?.symbol === "GHOST")!.launch!;
    expect(ghost.mint).toBe("8UmG7vkF2DcX5U5uCyjPuVWPgLPL85fcC7y28aB2pump");
    expect(ghost.creator).toBe("5AWp2LXwxP55EXmrZrDp7GwXUav7KxGucdr9Y1PLYUhJ");
    expect(ghost.curve).toBe("AJsXTqqrfdLfHs1VF227H8GZmVHzLh9yYapk6daDn4Br");
    expect(ghost.supplyRaw).toBe(1e15);
    expect(ghost.mayhem).toBe(false);
  });

  it("derives the bonding-curve PDA that matches every create", () => {
    const launches = all.filter((d) => d.launch).map((d) => d.launch!);
    expect(launches.length).toBeGreaterThanOrEqual(10);
    for (const l of launches) expect(bondingCurveOf(l.mint)).toBe(l.curve);
  });

  it("counts Mayhem-mode launches as 2B supply with the Mayhem vault excluded", () => {
    const mayhem = all.filter((d) => d.launch?.mayhem).map((d) => d.launch!);
    expect(mayhem.length).toBeGreaterThanOrEqual(3);
    for (const l of mayhem) {
      expect(l.supplyRaw).toBeGreaterThan(1.9e15);
      expect(l.vaults.length).toBe(2);
    }
  });

  it("does not SOL-price curves quoted in another token", () => {
    const los = all.find((d) => d.launch?.symbol === "LOS")!;
    expect(los.launch!.quoteMint).not.toBe("So11111111111111111111111111111111111111112");
    expect(los.prices[los.launch!.mint]).toBeUndefined();
  });

  it("prices a launch at the curve's opening price", () => {
    const tx = all.find((d) => d.launch?.symbol === "GHOST")!;
    expect(tx.prices[tx.launch!.mint]).toBeGreaterThan(2.79e-8);
    expect(tx.prices[tx.launch!.mint]).toBeLessThan(2.85e-8);
  });
});

describe("pump.fun trades via TradeEvent", () => {
  it("attributes a relayed trade to the event's user, not the fee payer", () => {
    const events = mixed.flatMap((d) => d.flows.filter((f) => (f.kind === "buy" || f.kind === "sell") && !d.signers.includes(f.owner)));
    expect(events.length).toBeGreaterThan(0);
  });

  it("takes price from the curve's real virtual reserves, even on drained curves", () => {
    // 45WCaJ8g sells into a curve with only ~4.87 SOL of virtual reserves.
    const d = bySig("45WCaJ8g");
    const mint = d.flows.find((f) => f.kind === "sell")!.mint;
    expect(d.prices[mint]).toBeCloseTo(4.53e-9, 10);
  });

  it("never emits the bonding curve as a holder flow", () => {
    for (const d of all) {
      for (const f of d.flows) if (f.mint.endsWith("pump")) expect(f.owner).not.toBe(bondingCurveOf(f.mint));
    }
  });

  it("parses every TradeEvent layout seen on mainnet", () => {
    const n = fixturesLogs().reduce((s, logs) => s + parsePumpEvents(logs).trades.length, 0);
    expect(n).toBeGreaterThan(25);
  });

  it("gets buys and sells with consistent signs", () => {
    const flows = all.flatMap((d) => d.flows);
    for (const f of flows.filter((x) => x.kind === "buy")) expect(f.tokenDelta > 0 && f.solDelta <= 0).toBe(true);
    for (const f of flows.filter((x) => x.kind === "sell")) expect(f.tokenDelta < 0 && f.solDelta >= 0).toBe(true);
  });
});

describe("migrations and AMM", () => {
  it("detects migrations and does not report them as liquidity pulls", () => {
    const migrations = all.filter((d) => d.migratedMint);
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    for (const m of migrations) expect(m.liquidityRemovals.filter((r) => r.mint === m.migratedMint)).toHaveLength(0);
  });

  it("classifies PumpSwap trades by counterparty and ignores fee slivers", () => {
    const swaps = mixed.filter((d) => d.flows.some((f) => f.kind === "buy" || f.kind === "sell") && !d.flows.some((f) => f.mint.endsWith("pump") && d.prices[f.mint] === undefined));
    expect(swaps.length).toBeGreaterThan(10);
    for (const d of mixed) {
      for (const f of d.flows) {
        if (f.kind === "buy" || f.kind === "sell") expect(Math.abs(f.tokenDelta)).toBeGreaterThan(0);
      }
    }
  });
});

function fixturesLogs(): string[][] {
  const raw = [
    ...(JSON.parse(fs.readFileSync(new URL("./fixtures/pump-mainnet.json", import.meta.url), "utf8")) as RawTxUpdate[]),
    ...(JSON.parse(fs.readFileSync(new URL("./fixtures/mainnet-mixed.json", import.meta.url), "utf8")) as RawTxUpdate[]),
  ];
  return raw.map((u) => u.transaction?.transaction?.meta?.logMessages ?? []);
}
