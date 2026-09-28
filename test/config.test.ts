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
