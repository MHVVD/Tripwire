import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { decodeTx, decodeCreateEvent, type RawTxUpdate } from "../src/engine/decode.js";

const fixtures = JSON.parse(fs.readFileSync(new URL("./fixtures/pump-mainnet.json", import.meta.url), "utf8")) as RawTxUpdate[];
const decoded = fixtures.map((f) => decodeTx(f)!);

describe("decodeTx on captured mainnet pump.fun transactions", () => {
  it("decodes every transaction", () => {
    expect(decoded.every((d) => d && d.signature.length > 60)).toBe(true);
  });

  it("finds launches with name, symbol, creator and curve", () => {
    const launches = decoded.filter((d) => d.launch).map((d) => d.launch!);
    expect(launches.length).toBeGreaterThanOrEqual(2);
    const ghost = launches.find((l) => l.symbol === "GHOST")!;
    expect(ghost.mint).toBe("8UmG7vkF2DcX5U5uCyjPuVWPgLPL85fcC7y28aB2pump");
    expect(ghost.creator).toBe("5AWp2LXwxP55EXmrZrDp7GwXUav7KxGucdr9Y1PLYUhJ");
    expect(ghost.curve).toBe("AJsXTqqrfdLfHs1VF227H8GZmVHzLh9yYapk6daDn4Br");
  });

  it("classifies the dev's launch buy and prices it at the curve's opening price", () => {
    const tx = decoded.find((d) => d.launch?.symbol === "GHOST")!;
    const devBuy = tx.flows.find((f) => f.owner === tx.launch!.creator)!;
    expect(devBuy.kind).toBe("buy");
    expect(devBuy.tokenDelta).toBe(3529685843060);
    // Fresh curve: 30 SOL / 1.073B tokens = 2.796e-8 SOL per token.
    expect(tx.prices[tx.launch!.mint]).toBeGreaterThan(2.79e-8);
    expect(tx.prices[tx.launch!.mint]).toBeLessThan(2.83e-8);
  });

  it("detects migrations", () => {
    expect(decoded.some((d) => d.migratedMint === "4VZJqYy4VqGw6SN93ki8yDCdzLeLueVRFFFLaW8Apump")).toBe(true);
  });

  it("gets buys and sells with sensible signs", () => {
    const flows = decoded.flatMap((d) => d.flows.filter((f) => f.signer));
    const buys = flows.filter((f) => f.kind === "buy");
    const sells = flows.filter((f) => f.kind === "sell");
    expect(buys.length).toBeGreaterThan(3);
    expect(sells.length).toBeGreaterThan(3);
    expect(buys.every((f) => f.tokenDelta > 0 && f.solDelta < 0)).toBe(true);
    expect(sells.every((f) => f.tokenDelta < 0 && f.solDelta > 0)).toBe(true);
  });

  it("curve progress stays within 0-100", () => {
    for (const d of decoded) for (const p of Object.values(d.curveProgress)) expect(p).toBeGreaterThanOrEqual(0), expect(p).toBeLessThanOrEqual(100);
  });

  it("ignores logs without a create event", () => {
    expect(decodeCreateEvent(["Program log: Instruction: Buy"])).toBeUndefined();
  });
});
