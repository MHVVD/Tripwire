/**
 * Exits: sell a position when a critical tripwire fires.
 *
 * paper: quote the sale on Jupiter (and simulate it on Solami RPC when a wallet is
 *        configured) - nothing is signed or sent.
 * live:  build the swap from Jupiter's instructions, add a Beam tip, sign with the
 *        configured wallet and land it through Beam. Capped by EXIT_MAX_SOL.
 */
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { Beam } from "../solami/beam.js";
import { WSOL } from "./decode.js";

export interface ExitRecord {
  id: string;
  t: number;
  mint: string;
  symbol: string;
  mode: "paper" | "live";
  trigger: string;
  status: "quoting" | "simulated" | "sending" | "landed" | "failed";
  tokens: number;
  expectedSol?: number;
  signature?: string;
  sendMs?: number;
  landMs?: number;
  slotDelta?: number;
  beam?: { region?: string; landedViaJito?: boolean; tipLamports?: number; heldMs?: number };
  error?: string;
}

export interface ExitOptions {
  mode: "paper" | "live";
  wallet?: Keypair;
  maxSol: number;
  slippageBps: number;
  tipLamports: number;
  priorityMicroLamports: number;
  jupiterApi: string;
  /** Paper position size, in SOL, used when there is no real balance to sell. */
  paperSizeSol: number;
}

export function parseSecretKey(s: string | undefined): Keypair | undefined {
  if (!s) return undefined;
  const t = s.trim();
  const bytes = t.startsWith("[") ? Uint8Array.from(JSON.parse(t) as number[]) : bs58.decode(t);
  return Keypair.fromSecretKey(bytes);
}

interface JupIx {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

const toIx = (ix: JupIx) =>
  new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, "base64"),
  });

let seq = 0;

export class Exiter {
  constructor(
    private readonly beam: Beam,
    private readonly opts: ExitOptions,
    private readonly onUpdate: (r: ExitRecord) => void,
  ) {}

  get walletAddress(): string | undefined {
    return this.opts.wallet?.publicKey.toBase58();
  }

  private async tokenBalance(mint: string): Promise<{ raw: bigint; decimals: number } | undefined> {
    const owner = this.opts.wallet?.publicKey;
    if (!owner) return undefined;
    const res = await this.beam.connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
    // Jupiter sells from one account (the ATA); take the largest rather than the sum.
    let raw = 0n;
    let decimals = 6;
    for (const a of res.value) {
      const info = a.account.data.parsed.info.tokenAmount as { amount: string; decimals: number };
      if (BigInt(info.amount) > raw) raw = BigInt(info.amount);
      decimals = info.decimals;
    }
    return { raw, decimals };
  }

  private async quote(mint: string, amountRaw: bigint, outputMint = WSOL): Promise<Record<string, unknown>> {
    const url = `${this.opts.jupiterApi}/quote?inputMint=${mint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=${this.opts.slippageBps}&restrictIntermediateTokens=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`jupiter quote ${res.status}: ${(await res.text()).slice(0, 120)}`);
    return (await res.json()) as Record<string, unknown>;
  }

  private async buildTx(quote: Record<string, unknown>): Promise<{ tx: VersionedTransaction; lastValidBlockHeight: number }> {
    const wallet = this.opts.wallet!;
    const res = await fetch(`${this.opts.jupiterApi}/swap-instructions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteResponse: quote, userPublicKey: wallet.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`jupiter swap-instructions ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const j = (await res.json()) as {
      setupInstructions: JupIx[];
      swapInstruction: JupIx;
      cleanupInstruction?: JupIx;
      addressLookupTableAddresses: string[];
    };
    const conn = this.beam.connection;
    const [tip, { blockhash, lastValidBlockHeight }, alts] = await Promise.all([
      this.beam.tipInstruction(wallet.publicKey, this.opts.tipLamports),
      conn.getLatestBlockhash("confirmed"),
      Promise.all(j.addressLookupTableAddresses.map((a) => conn.getAddressLookupTable(new PublicKey(a)).then((r) => r.value))),
    ]);
    const ixs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.opts.priorityMicroLamports }),
      ...j.setupInstructions.map(toIx),
      toIx(j.swapInstruction),
      ...(j.cleanupInstruction ? [toIx(j.cleanupInstruction)] : []),
      tip,
    ];
    const msg = new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(
      alts.filter((a): a is AddressLookupTableAccount => !!a),
    );
    const tx = new VersionedTransaction(msg);
    tx.sign([wallet]);
    return { tx, lastValidBlockHeight };
  }

  /**
   * Buy `lamports` worth of a token through Jupiter + Beam. Tripwire itself never buys;
   * this exists for `npm run beam-test`, which needs a position to exit from.
   */
  async buyForTest(mint: string, lamports: number): Promise<{ signature: string; landMs: number }> {
    if (!this.opts.wallet) throw new Error("WALLET_SECRET_KEY is not set");
    const quote = await this.quote(WSOL, BigInt(lamports), mint);
    const { tx, lastValidBlockHeight } = await this.buildTx(quote);
    return this.beam.sendAndConfirm(tx.serialize(), lastValidBlockHeight);
  }

  /**
   * Run an exit. `price` is SOL per whole token at trigger time, used to size the
   * paper position and to estimate proceeds if Jupiter cannot quote the token yet.
   */
  async exit(mint: string, symbol: string, trigger: string, price: number, alertSlot?: number): Promise<ExitRecord> {
    const t0 = Date.now();
    const rec: ExitRecord = {
      id: `x${t0.toString(36)}${(seq++).toString(36)}`,
      t: t0,
      mint,
      symbol,
      mode: this.opts.mode,
      trigger,
      status: "quoting",
      tokens: 0,
    };
    const update = (patch: Partial<ExitRecord>) => {
      Object.assign(rec, patch);
      this.onUpdate({ ...rec });
    };
    update({});

    try {
      let raw: bigint;
      let decimals = 6;
      const bal = this.opts.wallet ? await this.tokenBalance(mint).catch(() => undefined) : undefined;
      if (bal && bal.raw > 0n) {
        raw = bal.raw;
        decimals = bal.decimals;
      } else if (this.opts.mode === "live") {
        throw new Error("wallet holds none of this token");
      } else {
        if (!(price > 0)) throw new Error("no price for this token yet - nothing to size a paper exit with");
        raw = BigInt(Math.floor((this.opts.paperSizeSol / price) * 10 ** decimals));
      }
      rec.tokens = Number(raw) / 10 ** decimals;
      const estimate = rec.tokens * price;

      let quote: Record<string, unknown> | undefined;
      try {
        quote = await this.quote(mint, raw);
        update({ expectedSol: Number(quote.outAmount) / 1e9 });
      } catch (e) {
        if (this.opts.mode === "live") throw e;
        update({ expectedSol: estimate, error: `quote unavailable, estimated from price (${(e as Error).message})` });
      }

      if (this.opts.mode === "paper") {
        if (quote && this.opts.wallet && bal && bal.raw > 0n) {
          const { tx } = await this.buildTx(quote);
          const sim = await this.beam.connection.simulateTransaction(tx, { sigVerify: false });
          if (sim.value.err) throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}`);
        }
        update({ status: "simulated", sendMs: Date.now() - t0 });
        return rec;
      }

      const expected = rec.expectedSol ?? estimate;
      if (expected > this.opts.maxSol) throw new Error(`exit worth ${expected.toFixed(3)} SOL exceeds EXIT_MAX_SOL=${this.opts.maxSol}`);
      const { tx, lastValidBlockHeight } = await this.buildTx(quote!);
      update({ status: "sending", sendMs: Date.now() - t0 });
      const landed = await this.beam.sendAndConfirm(tx.serialize(), lastValidBlockHeight);
      update({
        status: "landed",
        signature: landed.signature,
        landMs: landed.landMs,
        slotDelta: landed.slot && alertSlot ? landed.slot - alertSlot : undefined,
      });
      const info = await this.beam.lookup(landed.signature).catch(() => undefined);
      if (info) {
        update({
          beam: {
            region: info.region,
            landedViaJito: info.landed_via_jito,
            tipLamports: info.tip_lamports,
            heldMs: info.forwarded_ms - info.first_seen_ms,
          },
        });
      }
      return rec;
    } catch (e) {
      const err = e as Error & { signature?: string };
      update({ status: "failed", error: err.message, signature: err.signature ?? rec.signature });
      return rec;
    }
  }
}
