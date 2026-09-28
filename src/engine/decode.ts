/**
 * Turns one Yellowstone gRPC transaction update into the handful of facts Tripwire
 * cares about: who gained or lost how much of which token, for how much SOL, and
 * whether the transaction launched or graduated a token.
 *
 * Everything here is derived from pre/post balances in the transaction meta, so it
 * works for any DEX or router without per-program instruction parsing. The only
 * program-specific parts are pump.fun's create event (for name/symbol) and its
 * bonding-curve price.
 */
import bs58 from "bs58";

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMPSWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const WSOL = "So11111111111111111111111111111111111111112";

/** pump.fun: 1B tokens, 6 decimals. 206.9M of the curve's balance is reserved for migration. */
export const PUMP_SUPPLY_RAW = 1_000_000_000_000_000;
export const PUMP_DECIMALS = 6;
const PUMP_MIGRATION_RESERVE_RAW = 206_900_000_000_000;
const PUMP_VIRTUAL_TOKEN_OFFSET_RAW = 279_900_000_000_000; // virtual - real token reserves at launch
const PUMP_VIRTUAL_SOL_LAMPORTS = 30_000_000_000;
const PUMP_CURVE_RENT_LAMPORTS = 1_600_000; // approximate rent-exempt balance of the curve account
const CREATE_EVENT_DISCRIMINATOR = "1b72a94ddeeb6376";

export type FlowKind = "buy" | "sell" | "transfer_in" | "transfer_out";

export interface Flow {
  mint: string;
  owner: string;
  /** Raw token amount change for this owner (positive = received). */
  tokenDelta: number;
  /** Lamport change for this owner, fees added back for the payer, WSOL counted as SOL. */
  solDelta: number;
  kind: FlowKind;
  /** True when the owner signed the transaction (a wallet acting, not a pool or recipient). */
  signer: boolean;
}

export interface LaunchInfo {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  /** Owner of the bonding-curve token account (the curve PDA). */
  curve?: string;
}

export interface DecodedTx {
  signature: string;
  slot: number;
  signers: string[];
  feeLamports: number;
  failed: boolean;
  launch?: LaunchInfo;
  /** A pump.fun token migrated to an AMM in this transaction. */
  migratedMint?: string;
  flows: Flow[];
  /** Spot price in SOL per whole token, keyed by mint, when a pool/curve in the tx lets us read one. */
  prices: Record<string, number>;
  /** pump.fun bonding-curve progress 0-100, keyed by mint. */
  curveProgress: Record<string, number>;
}

type Bytes = Uint8Array | { type: "Buffer"; data: number[] } | string;

function toB58(v: Bytes): string {
  if (typeof v === "string") return v;
  if (v instanceof Uint8Array) return bs58.encode(v);
  return bs58.encode(Uint8Array.from(v.data));
}

interface RawTokenBalance {
  accountIndex: number;
  mint: string;
  owner: string;
  uiTokenAmount?: { amount: string; decimals: number };
}

/** Minimal structural view of a Yellowstone SubscribeUpdate carrying a transaction. */
export interface RawTxUpdate {
  transaction?: {
    slot: string | number;
    transaction?: {
      signature: Bytes;
      transaction?: {
        message?: {
          header?: { numRequiredSignatures: number };
          accountKeys: Bytes[];
        };
      };
      meta?: {
        err?: unknown;
        fee: string | number;
        preBalances: (string | number)[];
        postBalances: (string | number)[];
        preTokenBalances: RawTokenBalance[];
        postTokenBalances: RawTokenBalance[];
        logMessages: string[];
        loadedWritableAddresses?: Bytes[];
        loadedReadonlyAddresses?: Bytes[];
      };
    };
  };
}

function readBorshString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  const start = offset + 4;
  return [buf.subarray(start, start + len).toString("utf8"), start + len];
}

/** Decodes pump.fun's anchor CreateEvent (name, symbol, uri) from "Program data:" logs. */
export function decodeCreateEvent(logs: string[]): { name: string; symbol: string; uri: string } | undefined {
  for (const line of logs) {
    if (!line.startsWith("Program data: ")) continue;
    const buf = Buffer.from(line.slice(14), "base64");
    if (buf.length < 20 || buf.subarray(0, 8).toString("hex") !== CREATE_EVENT_DISCRIMINATOR) continue;
    try {
      const [name, o1] = readBorshString(buf, 8);
      const [symbol, o2] = readBorshString(buf, o1);
      const [uri] = readBorshString(buf, o2);
      return { name, symbol, uri };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function hasLog(logs: string[], re: RegExp): boolean {
  return logs.some((l) => re.test(l));
}

export function decodeTx(update: RawTxUpdate): DecodedTx | undefined {
  const t = update.transaction?.transaction;
  const msg = t?.transaction?.message;
  const meta = t?.meta;
  if (!t || !msg || !meta) return undefined;

  const keys = [
    ...msg.accountKeys.map(toB58),
    ...(meta.loadedWritableAddresses ?? []).map(toB58),
    ...(meta.loadedReadonlyAddresses ?? []).map(toB58),
  ];
  const nSigners = msg.header?.numRequiredSignatures ?? 1;
  const signers = keys.slice(0, nSigners);
  const signerSet = new Set(signers);
  const fee = Number(meta.fee);
  const logs = meta.logMessages ?? [];

  const lamportDelta = (key: string): number => {
    const i = keys.indexOf(key);
    if (i < 0) return 0;
    const d = Number(meta.postBalances[i] ?? 0) - Number(meta.preBalances[i] ?? 0);
    return i === 0 ? d + fee : d;
  };

  // Token deltas per (owner, mint), from token-account balances.
  const tokenDeltas = new Map<string, { owner: string; mint: string; delta: number; post: number }>();
  const bump = (b: RawTokenBalance, sign: 1 | -1) => {
    const k = `${b.owner}|${b.mint}`;
    const amt = Number(b.uiTokenAmount?.amount ?? 0);
    const cur = tokenDeltas.get(k) ?? { owner: b.owner, mint: b.mint, delta: 0, post: 0 };
    cur.delta += sign * amt;
    if (sign === 1) cur.post += amt;
    tokenDeltas.set(k, cur);
  };
  meta.preTokenBalances.forEach((b) => bump(b, -1));
  meta.postTokenBalances.forEach((b) => bump(b, 1));

  const wsolDelta = new Map<string, number>();
  for (const d of tokenDeltas.values()) if (d.mint === WSOL) wsolDelta.set(d.owner, d.delta);

  const flows: Flow[] = [];
  for (const d of tokenDeltas.values()) {
    if (d.mint === WSOL || d.delta === 0) continue;
    const signer = signerSet.has(d.owner);
    const solDelta = lamportDelta(d.owner) + (wsolDelta.get(d.owner) ?? 0);
    let kind: FlowKind;
    if (d.delta > 0) kind = signer && solDelta < 0 ? "buy" : "transfer_in";
    else kind = signer && solDelta > 0 ? "sell" : "transfer_out";
    flows.push({ mint: d.mint, owner: d.owner, tokenDelta: d.delta, solDelta, kind, signer });
  }

  const decoded: DecodedTx = {
    signature: toB58(t.signature),
    slot: Number(update.transaction!.slot),
    signers,
    feeLamports: fee,
    failed: meta.err != null,
    flows,
    prices: {},
    curveProgress: {},
  };

  const touchesPump = keys.includes(PUMP_PROGRAM);

  if (touchesPump && hasLog(logs, /^Program log: Instruction: Create(V2)?$/)) {
    const ev = decodeCreateEvent(logs);
    // The new mint is the pump-suffixed signer, or failing that the non-WSOL mint whose
    // supply appears from nothing in this tx.
    const minted = [...tokenDeltas.values()].filter((d) => d.mint !== WSOL && d.delta > 0);
    const mint = signers.find((s) => minted.some((m) => m.mint === s)) ?? minted[0]?.mint;
    if (mint) {
      const curveHolder = minted
        .filter((m) => m.mint === mint && !signerSet.has(m.owner))
        .sort((a, b) => b.post - a.post)[0];
      decoded.launch = {
        mint,
        creator: signers[0],
        name: ev?.name ?? "",
        symbol: ev?.symbol ?? "",
        uri: ev?.uri ?? "",
        curve: curveHolder?.owner,
      };
    }
  }

  if (touchesPump && hasLog(logs, /^Program log: Instruction: Migrate/)) {
    const moved = [...tokenDeltas.values()].find((d) => d.mint !== WSOL && d.delta < 0);
    if (moved) decoded.migratedMint = moved.mint;
  }

  // Prices. pump.fun curve: the curve PDA holds the tokens in an ATA and the SOL natively.
  if (touchesPump) {
    for (const d of tokenDeltas.values()) {
      if (d.mint === WSOL || signerSet.has(d.owner)) continue;
      const idx = keys.indexOf(d.owner);
      if (idx < 0 || d.post <= PUMP_MIGRATION_RESERVE_RAW) continue;
      const curveLamports = Number(meta.postBalances[idx] ?? 0);
      const realTokens = d.post - PUMP_MIGRATION_RESERVE_RAW;
      const realSol = Math.max(0, curveLamports - PUMP_CURVE_RENT_LAMPORTS);
      const vTokens = realTokens + PUMP_VIRTUAL_TOKEN_OFFSET_RAW;
      const vSol = realSol + PUMP_VIRTUAL_SOL_LAMPORTS;
      // SOL per whole token.
      decoded.prices[d.mint] = vSol / 1e9 / (vTokens / 10 ** PUMP_DECIMALS);
      const sold = PUMP_SUPPLY_RAW - d.post;
      const sellable = PUMP_SUPPLY_RAW - PUMP_MIGRATION_RESERVE_RAW;
      decoded.curveProgress[d.mint] = Math.min(100, Math.max(0, (sold / sellable) * 100));
    }
  }

  // AMM pools: the non-signer owner holding the most of a token alongside WSOL is the
  // pool's vault pair. Smaller holders (routers, fee accounts) would give junk prices.
  const best = new Map<string, { tok: number; sol: number }>();
  const postByOwner = new Map<string, RawTokenBalance[]>();
  for (const b of meta.postTokenBalances) {
    const arr = postByOwner.get(b.owner) ?? [];
    arr.push(b);
    postByOwner.set(b.owner, arr);
  }
  for (const [owner, bals] of postByOwner) {
    if (signerSet.has(owner)) continue;
    const w = bals.find((b) => b.mint === WSOL);
    if (!w) continue;
    const sol = Number(w.uiTokenAmount?.amount ?? 0) / 1e9;
    for (const b of bals) {
      if (b.mint === WSOL || decoded.prices[b.mint] !== undefined) continue;
      const tok = Number(b.uiTokenAmount?.amount ?? 0) / 10 ** (b.uiTokenAmount?.decimals ?? 0);
      const cur = best.get(b.mint);
      if (tok > 0 && sol > 0.01 && (!cur || tok > cur.tok)) best.set(b.mint, { tok, sol });
    }
  }
  for (const [mint, v] of best) decoded.prices[mint] = v.sol / v.tok;

  return decoded;
}
