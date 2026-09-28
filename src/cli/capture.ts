/**
 * `npm run capture` - records interesting raw gRPC transactions to test/fixtures so the
 * decoder can be regression-tested against real mainnet data.
 */
import fs from "node:fs";
import bs58 from "bs58";
import { loadConfig } from "../config.js";
import yellowstone from "@triton-one/yellowstone-grpc";
import { PUMP_PROGRAM, PUMPSWAP_PROGRAM } from "../engine/decode.js";

const cfg = loadConfig();
const mod = yellowstone as unknown as { default?: typeof yellowstone.default } & typeof yellowstone;
const Client = (typeof mod === "function" ? mod : mod.default) as typeof yellowstone.default;
const seconds = Number(process.argv[2] ?? 90);
const out = process.argv[3] ?? "test/fixtures/mainnet-mixed.json";

const buckets: Record<string, unknown[]> = { create: [], mayhemCreate: [], relayed: [], pumpswap: [], migrate: [], other: [] };
const caps: Record<string, number> = { create: 6, mayhemCreate: 4, relayed: 10, pumpswap: 40, migrate: 3, other: 20 };
const TRADE = "vdt/007mYe4"; // base64 prefix of the TradeEvent discriminator bddb7fd34ee661ee

const client = new Client(cfg.grpcUrl, cfg.grpcKey, undefined);
await client.connect();
const stream = await client.subscribe();
const plain = (d: unknown) =>
  JSON.parse(JSON.stringify(d, (_k, v) => (v && typeof v === "object" && v.type === "Buffer" ? bs58.encode(Buffer.from(v.data)) : v instanceof Uint8Array ? bs58.encode(v) : v)));
stream.on("data", (d: { transaction?: { transaction?: { meta?: { logMessages: string[] }; transaction?: { message?: { accountKeys: Uint8Array[] } } } } }) => {
  const t = d.transaction?.transaction;
  if (!t?.meta) return;
  const logs = t.meta.logMessages;
  const keys = (t.transaction?.message?.accountKeys ?? []).map((k) => bs58.encode(k));
  let bucket = "other";
  if (logs.some((l) => /Instruction: Migrate/.test(l))) bucket = "migrate";
  else if (logs.some((l) => /^Program log: Instruction: Create(V2)?$/.test(l))) {
    const json = JSON.stringify(plain(d));
    bucket = json.includes('"amount":"2000000000000000"') || /"amount":"1[0-9]{15}"/.test(json) ? "mayhemCreate" : "create";
  } else if (keys.includes(PUMPSWAP_PROGRAM)) bucket = "pumpswap";
  else if (logs.some((l) => l.startsWith(`Program data: ${TRADE}`))) {
    // Relayed: the trade's user differs from the fee payer.
    const ev = logs.find((l) => l.startsWith(`Program data: ${TRADE}`))!;
    const buf = Buffer.from(ev.slice(14), "base64");
    const user = bs58.encode(buf.subarray(8 + 32 + 17, 8 + 32 + 17 + 32));
    if (user !== keys[0]) bucket = "relayed";
  }
  if (buckets[bucket].length < caps[bucket]) buckets[bucket].push(plain(d));
});
stream.write({
  accounts: {}, slots: {}, transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {}, accountsDataSlice: [],
  transactions: { t: { vote: false, failed: false, accountInclude: [PUMP_PROGRAM, PUMPSWAP_PROGRAM], accountExclude: [], accountRequired: [] } },
  commitment: 0,
});
setTimeout(() => {
  const all = Object.values(buckets).flat();
  fs.writeFileSync(out, JSON.stringify(all));
  console.log(Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])), `→ ${out}`);
  process.exit(0);
}, seconds * 1000);
