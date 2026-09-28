import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("config", () => {
  it("requires a key and derives regional endpoints", () => {
    expect(() => loadConfig({})).toThrow(/SOLAMI_API_KEY/);
    const c = loadConfig({ SOLAMI_API_KEY: "k", SOLAMI_REGION: "fra" });
    expect(c.grpcUrl).toBe("https://fra.grpc.solami.dev");
    expect(c.rpcUrl).toBe("https://fra.rpc.solami.dev/sol");
    expect(c.EXIT_MODE).toBe("paper");
    expect(c.dataKey).toBe("k");
  });
});

describe("config safety", () => {
  it("rejects malformed numbers instead of silently disabling the sell cap", () => {
    expect(() => loadConfig({ SOLAMI_API_KEY: "k", EXIT_MAX_SOL: "0,5" })).toThrow(/EXIT_MAX_SOL/);
    expect(() => loadConfig({ SOLAMI_API_KEY: "k", BEAM_TIP_LAMPORTS: "10" })).toThrow(/BEAM_TIP_LAMPORTS/);
  });
  it("auto-exits auto-watches by default only in paper mode", () => {
    expect(loadConfig({ SOLAMI_API_KEY: "k" }).AUTO_WATCH_AUTO_EXIT).toBe(true);
    expect(loadConfig({ SOLAMI_API_KEY: "k", EXIT_MODE: "live" }).AUTO_WATCH_AUTO_EXIT).toBe(false);
  });
});
