/**
 * `npm run doctor` - checks which Solami products your key can reach, so a 403 in the
 * middle of a demo is never a surprise.
 */
import { loadConfig } from "../config.js";
import { GrpcFeed } from "../solami/grpc.js";

const cfg = loadConfig();
type Row = [product: string, ok: boolean, detail: string, needFor: string];
const rows: Row[] = [];

async function check(product: string, needFor: string, fn: () => Promise<string>): Promise<void> {
  try {
    rows.push([product, true, await fn(), needFor]);
  } catch (e) {
    rows.push([product, false, (e as Error).message.slice(0, 90), needFor]);
  }
}

async function httpJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 80)}`);
  return JSON.parse(text);
}

await check("Yellowstone gRPC", "radar + tripwires (required)", async () => {
  const feed = new GrpcFeed(cfg.grpcUrl, cfg.grpcKey);
  let txs = 0;
  feed.on("tx", () => txs++);
  const errors: string[] = [];
  feed.on("error", (e) => errors.push(e.message));
  await feed.start();
  await new Promise((r) => setTimeout(r, 5000));
  feed.stop();
  if (!txs) throw new Error(errors[0] ?? "connected but no transactions in 5s");
  return `${txs} launchpad txs in 5s, slot ${feed.status.lastSlot}`;
});

await check("Blur (DataApi)", "Blur intel enrichment (optional)", async () => {
  const r = (await httpJson(`${cfg.apiUrl}/data/token/launches?chain=solana&limit=1`, { headers: { "x-api-key": cfg.dataKey } })) as { symbol: string }[];
  return `latest launch: ${r[0]?.symbol ?? "?"}`;
});

await check("RPC", "exits: balances, simulate, send (live exits)", async () => {
  const r = (await httpJson(`${cfg.rpcUrl}?api_key=${cfg.rpcKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot" }),
  })) as { result?: number; error?: { message: string } };
  if (r.error) throw new Error(r.error.message);
  return `slot ${r.result}`;
});

await check("Beam tip accounts", "live exits", async () => {
  const r = (await httpJson(`${cfg.apiUrl}/onchain/tip-addresses`)) as string[];
  return `${r.length} tip accounts`;
});

await check("Leader tracking", "health: slots behind", async () => {
  const r = (await httpJson(`${cfg.apiUrl}/leader-tracking/current`)) as { slot: number };
  return `chain slot ${r.slot}`;
});

console.log("\nSolami access check\n");
for (const [p, ok, d, need] of rows) console.log(`${ok ? "✔" : "✘"} ${p.padEnd(18)} ${d.padEnd(60)} ${ok ? "" : `← needed for ${need}`}`);
const fatal = rows.find((r) => r[0] === "Yellowstone gRPC" && !r[1]);
console.log(fatal ? "\nTripwire needs gRPC access to run." : "\nReady: npm start");
process.exit(fatal ? 1 : 0);
