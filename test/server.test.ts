import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server.js";
import type { App } from "../src/app.js";

const MINT = "8UmG7vkF2DcX5U5uCyjPuVWPgLPL85fcC7y28aB2pump";
const armed: unknown[] = [];
const fakeApp = Object.assign(new EventEmitter(), {
  snapshot: () => ({ ok: true }),
  arm: (mint: string, opts: unknown) => (armed.push({ mint, opts }), { mint }),
  watchView: (w: unknown) => w,
  disarm: () => undefined,
  manualExit: async () => ({ status: "simulated" }),
  launchDetail: () => undefined,
}) as unknown as App;

function serve(token?: string) {
  const s = createServer(fakeApp, { token });
  return new Promise<{ url: string; close: () => void }>((r) =>
    s.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() })),
  );
}

describe("server security", () => {
  let open: { url: string; close: () => void };
  let locked: { url: string; close: () => void };
  beforeAll(async () => {
    open = await serve();
    locked = await serve("s3cret");
  });
  afterAll(() => {
    open.close();
    locked.close();
  });

  it("refuses cross-site requests (CSRF) to trigger exits", async () => {
    const r = await fetch(`${open.url}/api/exit/${MINT}`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(403);
  });

  it("refuses simple (non-JSON) POSTs that browsers send without preflight", async () => {
    const r = await fetch(`${open.url}/api/watch`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ mint: MINT, autoExit: true }) });
    expect(r.status).toBe(415);
    expect(armed).toHaveLength(0);
  });

  it("accepts same-origin JSON and leaves autoExit untouched when omitted", async () => {
    const r = await fetch(`${open.url}/api/watch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mint: MINT }) });
    expect(r.status).toBe(200);
    expect((armed[0] as { opts: { autoExit?: boolean } }).opts.autoExit).toBeUndefined();
  });

  it("returns 400 on malformed JSON and bad mints", async () => {
    const bad = await fetch(`${open.url}/api/watch`, { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    expect(bad.status).toBe(400);
    const del = await fetch(`${open.url}/api/watch/not-a-mint`, { method: "DELETE" });
    expect(del.status).toBe(400);
  });

  it("requires the token when one is configured", async () => {
    expect((await fetch(`${locked.url}/api/snapshot`)).status).toBe(401);
    expect((await fetch(`${locked.url}/api/snapshot`, { headers: { "x-tripwire-token": "s3cret" } })).status).toBe(200);
    expect((await fetch(`${locked.url}/api/snapshot?token=s3cret`)).status).toBe(200);
  });

  it("does not serve files outside web/", async () => {
    expect((await fetch(`${open.url}/%2e%2e/.env`)).status).toBe(404);
  });
});
