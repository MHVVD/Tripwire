import { loadConfig } from "./config.js";
import { App } from "./app.js";
import { createServer } from "./server.js";

const cfg = loadConfig();
const app = new App(cfg);
await app.start();
const server = createServer(app);
server.listen(cfg.PORT, cfg.HOST, () => {
  console.log(`Tripwire running on http://${cfg.HOST}:${cfg.PORT}  (exits: ${cfg.EXIT_MODE}, auto-watch: ${cfg.AUTO_WATCH ? "on" : "off"})`);
});

const shutdown = () => {
  app.stop();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
