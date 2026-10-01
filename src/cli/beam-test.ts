/**
 * `npm run beam-test -- <mint> [sol]` - proves the exit path end to end on mainnet:
 * buys a tiny position (default 0.003 SOL) through Jupiter + Beam, then sells all of it
 * with Tripwire's real exit code, landed through Beam, and prints Beam's own record.
 *
 * Without arguments it generates a burner wallet and prints its address to fund.
 */
import fs from "node:fs";
import bs58 from "bs58";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { loadConfig } from "../config.js";
import { Beam } from "../solami/beam.js";
import { Exiter, parseSecretKey, type ExitRecord } from "../engine/exit.js";

const cfg = loadConfig();
let wallet = parseSecretKey(cfg.WALLET_SECRET_KEY);
if (!wallet) {
  wallet = Keypair.generate();
  fs.appendFileSync(".env", `\nWALLET_SECRET_KEY=${bs58.encode(wallet.secretKey)}\n`);
  console.log(`Generated a burner wallet and saved its key to .env:\n  ${wallet.publicKey.toBase58()}\nSend it ~0.02 SOL, then run: npm run beam-test -- <mint>`);
  process.exit(0);
}

const conn = new Connection(`${cfg.rpcUrl}?api_key=${cfg.rpcKey}`, "confirmed");
const balance = await conn.getBalance(wallet.publicKey);
console.log(`wallet ${wallet.publicKey.toBase58()} · ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
const mint = process.argv[2];
if (!mint) {
  console.log("usage: npm run beam-test -- <token mint> [sol]");
  process.exit(1);
}
const sol = Number(process.argv[3] ?? 0.003);
if (balance < (sol + 0.004) * LAMPORTS_PER_SOL) throw new Error("not enough SOL for the test plus fees and tips");

const beam = new Beam(conn, cfg.apiUrl);
const records: ExitRecord[] = [];
const exiter = new Exiter(
  beam,
  {
    mode: "live",
    wallet,
    maxSol: Math.max(sol * 2, 0.01),
    slippageBps: cfg.EXIT_SLIPPAGE_BPS,
    tipLamports: cfg.BEAM_TIP_LAMPORTS,
    priorityMicroLamports: cfg.PRIORITY_FEE_MICROLAMPORTS,
    jupiterApi: cfg.JUPITER_API,
    paperSizeSol: sol,
  },
  (r) => records.push(r),
);

console.log(`1/2 buying ${sol} SOL of ${mint} via Beam…`);
const buy = await exiter.buyForTest(mint, Math.round(sol * LAMPORTS_PER_SOL));
console.log(`    landed in ${buy.landMs}ms  https://solscan.io/tx/${buy.signature}`);
await new Promise((r) => setTimeout(r, 2000));

console.log("2/2 exiting through Tripwire's exit path via Beam…");
const exit = await exiter.exit(mint, mint.slice(0, 6), "beam-test", 0);
console.log(JSON.stringify(exit, null, 2));
const info = await beam.lookup(buy.signature);
console.log("Beam record for the buy:", JSON.stringify(info));
process.exit(exit.status === "landed" ? 0 : 1);
