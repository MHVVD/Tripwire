/**
 * Beam: Solami's stake-weighted transaction landing. Over HTTP there is no separate
 * endpoint - a normal `sendTransaction` to the Solami RPC that carries a transfer to
 * one of the Beam tip accounts is routed through Beam.
 */
import { Connection, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";

export interface BeamStatus {
  sent: number;
  landed: number;
  failed: number;
  avgLandMs: number;
}

export interface BeamTxInfo {
  is_landed: boolean;
  landed_via_jito: boolean;
  rebroadcasted: boolean;
  region: string;
  tip_lamports: number;
  first_seen_ms: number;
  forwarded_ms: number;
}

export class Beam {
  readonly status: BeamStatus = { sent: 0, landed: 0, failed: 0, avgLandMs: 0 };
  private tips: string[] = [];
  private tipsAt = 0;
  private landTotal = 0;

  constructor(
    readonly connection: Connection,
    private readonly apiUrl: string,
  ) {}

  async tipAccounts(): Promise<string[]> {
    if (this.tips.length && Date.now() - this.tipsAt < 10 * 60_000) return this.tips;
    const res = await fetch(`${this.apiUrl}/onchain/tip-addresses`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`tip-addresses ${res.status}`);
    this.tips = (await res.json()) as string[];
    this.tipsAt = Date.now();
    return this.tips;
  }

  async tipInstruction(from: PublicKey, lamports: number): Promise<TransactionInstruction> {
    const tips = await this.tipAccounts();
    const to = new PublicKey(tips[Math.floor(Math.random() * tips.length)]);
    return SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports });
  }

  /** Send a signed, tipped transaction and wait for it to land. */
  async sendAndConfirm(raw: Uint8Array, timeoutMs = 30_000): Promise<{ signature: string; landMs: number; slot?: number }> {
    const t0 = Date.now();
    const signature = await this.connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    this.status.sent++;
    while (Date.now() - t0 < timeoutMs) {
      const { value } = await this.connection.getSignatureStatuses([signature]);
      const s = value[0];
      if (s?.err) {
        this.status.failed++;
        throw Object.assign(new Error(`transaction failed: ${JSON.stringify(s.err)}`), { signature });
      }
      if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
        const landMs = Date.now() - t0;
        this.status.landed++;
        this.landTotal += landMs;
        this.status.avgLandMs = Math.round(this.landTotal / this.status.landed);
        return { signature, landMs, slot: s.slot };
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    this.status.failed++;
    throw Object.assign(new Error("not confirmed within timeout"), { signature });
  }

  /** Beam's own record of a send: region, Jito path, tip, time held. */
  async lookup(signature: string): Promise<BeamTxInfo | undefined> {
    const res = await fetch(`${this.apiUrl}/swqos/tx/${signature}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return undefined;
    return (await res.json()) as BeamTxInfo;
  }
}
