/** Tiny HTTP server: static dashboard, Server-Sent Events stream, and a JSON API. */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { App, AppEvents } from "./app.js";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const STREAMED: (keyof AppEvents)[] = ["launch", "launch_removed", "alert", "alert_update", "watch", "watch_removed", "exit", "health"];

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 10_000) throw new Error("body too large");
  }
  return data ? (JSON.parse(data) as Record<string, unknown>) : {};
}

export function createServer(app: App): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname;
    try {
      if (p === "/api/stream" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send("snapshot", app.snapshot());
        const handlers = STREAMED.map((ev) => {
          const h = (data: unknown) => send(ev, data);
          app.on(ev, h as never);
          return [ev, h] as const;
        });
        req.on("close", () => handlers.forEach(([ev, h]) => app.off(ev, h as never)));
        return;
      }
      if (p === "/api/snapshot" && req.method === "GET") return json(res, 200, app.snapshot());

      const launchMatch = p.match(/^\/api\/launch\/([^/]+)$/);
      if (launchMatch && req.method === "GET") {
        const d = app.launchDetail(launchMatch[1]);
        return d ? json(res, 200, d) : json(res, 404, { error: "not tracked" });
      }

      if (p === "/api/watch" && req.method === "POST") {
        const body = await readBody(req);
        const mint = String(body.mint ?? "").trim();
        const devWallet = body.devWallet ? String(body.devWallet).trim() : undefined;
        if (!BASE58.test(mint)) return json(res, 400, { error: "mint must be a base58 address" });
        if (devWallet && !BASE58.test(devWallet)) return json(res, 400, { error: "devWallet must be a base58 address" });
        const w = app.arm(mint, { source: "manual", autoExit: body.autoExit === true, devWallet });
        return json(res, 200, app.watchView(w));
      }
      const watchMatch = p.match(/^\/api\/watch\/([^/]+)$/);
      if (watchMatch && req.method === "DELETE") {
        app.disarm(watchMatch[1]);
        return json(res, 200, { ok: true });
      }
      const exitMatch = p.match(/^\/api\/exit\/([^/]+)$/);
      if (exitMatch && req.method === "POST") {
        if (!BASE58.test(exitMatch[1])) return json(res, 400, { error: "bad mint" });
        return json(res, 200, await app.manualExit(exitMatch[1]));
      }
      if (p.startsWith("/api/")) return json(res, 404, { error: "not found" });

      // Static files.
      const file = path.resolve(WEB_ROOT, "." + (p === "/" ? "/index.html" : p));
      if (!file.startsWith(WEB_ROOT)) return json(res, 403, { error: "forbidden" });
      const body = await fs.readFile(file).catch(() => undefined);
      if (!body) return json(res, 404, { error: "not found" });
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
  });
}
