import { randomBytes } from "node:crypto";
import { loadConfig } from "./config.js";
import { App } from "./app.js";
import { createServer } from "./server.js";

const cfg = loadConfig();
const app = new App(cfg);
await app.start();
// On loopback the browser is the only client; anywhere else the API needs a token.
const loopback = ["127.0.0.1", "localhost", "::1"].includes(cfg.HOST);
const token = cfg.TRIPWIRE_TOKEN || (loopback ? undefined : randomBytes(16).toString("hex"));
const server = createServer(app, { token });
server.listen(cfg.PORT, cfg.HOST, () => {
  const host = loopback ? cfg.HOST : "<this-host>";
  console.log(`Tripwire running on http://${host}:${cfg.PORT}/${token ? `?token=${token}` : ""}`);
  console.log(`  exits: ${cfg.EXIT_MODE} · auto-watch: ${cfg.AUTO_WATCH ? `on (auto-exit ${cfg.AUTO_WATCH_AUTO_EXIT ? "on" : "off"})` : "off"}`);
});

const shutdown = () => {
  app.stop();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
