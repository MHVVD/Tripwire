/**
 * Turns one Yellowstone gRPC transaction update into the facts Tripwire cares about:
 * launches, migrations, trades and plain token movements per wallet, prices, and
 * liquidity withdrawals.
 *
 * pump.fun bonding-curve activity is read from pump's own anchor events (CreateEvent,
 * TradeEvent), which name the real trader and carry the curve's reserves - so a dev
 * selling through a relayer or a trading terminal is still the dev. Everything else
 * (PumpSwap and other AMMs, transfers) is derived from pre/post balances: a pool is the
 * non-signer owner whose token and SOL/WSOL balances move in opposite directions, and
 * whoever is on the other side of it traded.
 */
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMPSWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const WSOL = "So11111111111111111111111111111111111111112";

/** Standard pump.fun launch: 1B tokens, 6 decimals, 793.1M sellable on the curve. */
export const PUMP_SUPPLY_RAW = 1_000_000_000_000_000;
export const PUMP_DECIMALS = 6;
export const PUMP_INITIAL_REAL_TOKENS = 793_100_000_000_000;

const CREATE_EVENT = "1b72a94ddeeb6376";
const TRADE_EVENT = "bddb7fd34ee661ee";

export type FlowKind = "buy" | "sell" | "transfer_in" | "transfer_out";

export interface Flow {
  mint: string;
  owner: string;
  /** Raw token amount change for this owner (positive = received). */
  tokenDelta: number;
  /** SOL paid (negative) or received (positive) for this flow, in lamports. 0 for transfers. */
  solDelta: number;
  kind: FlowKind;
  /** True when the owner signed the transaction. */
  signer: boolean;
}

export interface LaunchInfo {
  mint: string;
  /** The wallet that created the token (signed the create). */
  creator: string;
  /** The creator recorded on the curve (fee recipient); may differ for relayed launches. */
  curveCreator: string;
  name: string;
  symbol: string;
  uri: string;
  /** Bonding-curve PDA. */
  curve: string;
  /** Owners that hold supply as infrastructure (curve, Mayhem vault), never holders. */
  vaults: string[];
  supplyRaw: number;
  initialRealTokens: number;
  mayhem: boolean;
  /** Quote currency of the curve. Only SOL-quoted curves get SOL prices. */
  quoteMint: string;
}

export interface CurveState {
  virtualSol: number;
  virtualTokens: number;
  realSol: number;
  realTokens: number;
}

export interface LiquidityRemoval {
  mint: string;
  pool: string;
  /** Share of the pool's token side that left, 0-100. */
  pctOfPool: number;
  solOut: number;
  recipients: string[];
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
  /** Spot price in SOL per whole token, keyed by mint. */
  prices: Record<string, number>;
  /** pump.fun bonding-curve reserves after this tx, keyed by mint. */
  curves: Record<string, CurveState>;
  liquidityRemovals: LiquidityRemoval[];
  /** Owners that acted as pools/curves in this tx; never treated as holders. */
  poolOwners: string[];
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

// ---- pump.fun anchor events -------------------------------------------------

export interface PumpCreateEvent {
  name: string;
  symbol: string;
  uri: string;
  mint: string;
  curve: string;
  user: string;
  creator: string;
  virtualTokens: number;
  virtualSol: number;
  realTokens: number;
  supply: number;
  mayhem: boolean;
}

export interface PumpTradeEvent {
  mint: string;
  solAmount: number;
  tokenAmount: number;
  isBuy: boolean;
  user: string;
  virtualSol: number;
  virtualTokens: number;
  realSol: number;
  realTokens: number;
}

const curveCache = new Map<string, string>();
const PUMP_KEY = new PublicKey(PUMP_PROGRAM);

/** The pump.fun bonding-curve PDA for a mint: seeds ["bonding-curve", mint]. */
export function bondingCurveOf(mint: string): string {
  let c = curveCache.get(mint);
  if (!c) {
    c = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP_KEY)[0].toBase58();
    if (curveCache.size > 50_000) curveCache.clear();
    curveCache.set(mint, c);
  }
  return c;
}

const u64 = (buf: Buffer, o: number) => Number(buf.readBigUInt64LE(o));
const key = (buf: Buffer, o: number) => bs58.encode(buf.subarray(o, o + 32));

function readString(buf: Buffer, o: number): [string, number] {
  const len = buf.readUInt32LE(o);
  if (len > 1000) throw new Error("bad string");
  return [buf.subarray(o + 4, o + 4 + len).toString("utf8"), o + 4 + len];
}

export function parsePumpEvents(logs: string[]): { creates: PumpCreateEvent[]; trades: PumpTradeEvent[] } {
  const creates: PumpCreateEvent[] = [];
  const trades: PumpTradeEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith("Program data: ")) continue;
    const buf = Buffer.from(line.slice(14), "base64");
    if (buf.length < 16) continue;
    const disc = buf.subarray(0, 8).toString("hex");
    try {
      if (disc === CREATE_EVENT) {
        const [name, o1] = readString(buf, 8);
        const [symbol, o2] = readString(buf, o1);
        const [uri, o] = readString(buf, o2);
        const base = o + 128 + 8; // mint, curve, user, creator, timestamp
        creates.push({
          name,
          symbol,
          uri,
          mint: key(buf, o),
          curve: key(buf, o + 32),
          user: key(buf, o + 64),
          creator: key(buf, o + 96),
          virtualTokens: u64(buf, base),
          virtualSol: u64(buf, base + 8),
          realTokens: u64(buf, base + 16),
          supply: u64(buf, base + 24),
          mayhem: buf.length > base + 64 ? buf[base + 64] === 1 : false,
        });
      } else if (disc === TRADE_EVENT && buf.length >= 8 + 32 + 17 + 32 + 40) {
        const o = 8 + 32 + 17 + 32 + 8; // after mint, amounts, is_buy, user, timestamp
        trades.push({
          mint: key(buf, 8),
          solAmount: u64(buf, 40),
          tokenAmount: u64(buf, 48),
          isBuy: buf[56] === 1,
          user: key(buf, 57),
          virtualSol: u64(buf, o),
          virtualTokens: u64(buf, o + 8),
          realSol: u64(buf, o + 16),
          realTokens: u64(buf, o + 24),
        });
      }
    } catch {
      // A truncated or unfamiliar event is skipped; balances still cover the tx.
    }
  }
  return { creates, trades };
}

/** @deprecated kept for tests: name/symbol/uri of the first CreateEvent. */
export function decodeCreateEvent(logs: string[]): { name: string; symbol: string; uri: string } | undefined {
  const c = parsePumpEvents(logs).creates[0];
  return c ? { name: c.name, symbol: c.symbol, uri: c.uri } : undefined;
}

// ---- transaction decoding ---------------------------------------------------

interface OwnerMint {
  owner: string;
  mint: string;
  delta: number;
  post: number;
  accounts: number;
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
  const logs = meta.logMessages ?? [];

  const decoded: DecodedTx = {
    signature: toB58(t.signature),
    slot: Number(update.transaction!.slot),
    signers,
    feeLamports: Number(meta.fee),
    failed: meta.err != null,
    flows: [],
    prices: {},
    curves: {},
    liquidityRemovals: [],
    poolOwners: [],
  };
  if (decoded.failed) return decoded;

  const lamportDelta = (owner: string): number => {
    const i = keys.indexOf(owner);
    return i < 0 ? 0 : Number(meta.postBalances[i] ?? 0) - Number(meta.preBalances[i] ?? 0);
  };

  // Token deltas per (owner, mint).
  const om = new Map<string, OwnerMint>();
  const bump = (b: RawTokenBalance, sign: 1 | -1) => {
    const k = `${b.owner}|${b.mint}`;
    const amt = Number(b.uiTokenAmount?.amount ?? 0);
    const cur = om.get(k) ?? { owner: b.owner, mint: b.mint, delta: 0, post: 0, accounts: 0 };
    cur.delta += sign * amt;
    if (sign === 1) {
      cur.post += amt;
      cur.accounts++;
    }
    om.set(k, cur);
  };
  meta.preTokenBalances.forEach((b) => bump(b, -1));
  meta.postTokenBalances.forEach((b) => bump(b, 1));
  const entries = [...om.values()];
  const wsolOf = (owner: string) => om.get(`${owner}|${WSOL}`);

  const touchesPump = keys.includes(PUMP_PROGRAM);
  const { creates, trades } = touchesPump ? parsePumpEvents(logs) : { creates: [], trades: [] };

  // Launch.
  const create = creates[0];
  if (create) {
    const minted = entries.filter((e) => e.mint === create.mint && e.post > 0);
    const supplyRaw = minted.reduce((s, e) => s + e.post, 0) || create.supply;
    // Anything but the curve holding a big block at birth is infrastructure (the Mayhem
    // vault holds a whole extra 1B), not a holder.
    const vaults = [create.curve, ...minted.filter((e) => e.owner !== create.curve && !signerSet.has(e.owner) && e.post >= supplyRaw * 0.4).map((e) => e.owner)];
    decoded.launch = {
      mint: create.mint,
      creator: create.user,
      curveCreator: create.creator,
      name: create.name,
      symbol: create.symbol,
      uri: create.uri,
      curve: create.curve,
      vaults,
      supplyRaw,
      initialRealTokens: create.realTokens || PUMP_INITIAL_REAL_TOKENS,
      mayhem: create.mayhem || vaults.length > 1,
      quoteMint: entries.find((e) => e.owner === create.curve && e.mint !== create.mint)?.mint ?? WSOL,
    };
  }

  if (touchesPump && logs.some((l) => /^Program log: Instruction: Migrate(V\d+)?$/.test(l))) {
    const moved = entries.filter((e) => e.mint !== WSOL && e.delta < 0).sort((a, b) => a.delta - b.delta)[0];
    if (moved) decoded.migratedMint = moved.mint;
  }

  // pump.fun curve trades from events. The trader is the event's user, whoever paid.
  const explained = new Map<string, number>(); // owner|mint -> token delta covered by events
  const eventMints = new Set<string>();
  for (const tr of trades) {
    eventMints.add(tr.mint);
    const tokenDelta = tr.isBuy ? tr.tokenAmount : -tr.tokenAmount;
    decoded.flows.push({
      mint: tr.mint,
      owner: tr.user,
      tokenDelta,
      solDelta: tr.isBuy ? -tr.solAmount : tr.solAmount,
      kind: tr.isBuy ? "buy" : "sell",
      signer: signerSet.has(tr.user),
    });
    const k = `${tr.user}|${tr.mint}`;
    explained.set(k, (explained.get(k) ?? 0) + tokenDelta);
    if (tr.virtualTokens > 0) {
      decoded.prices[tr.mint] = tr.virtualSol / 1e9 / (tr.virtualTokens / 10 ** PUMP_DECIMALS);
      decoded.curves[tr.mint] = { virtualSol: tr.virtualSol, virtualTokens: tr.virtualTokens, realSol: tr.realSol, realTokens: tr.realTokens };
    }
  }
  if (decoded.launch && decoded.launch.quoteMint !== WSOL) {
    // Curve priced in another token: our SOL-denominated price would be meaningless.
    delete decoded.prices[decoded.launch.mint];
    delete decoded.curves[decoded.launch.mint];
  } else if (create && !decoded.prices[create.mint] && create.virtualTokens > 0) {
    decoded.prices[create.mint] = create.virtualSol / 1e9 / (create.virtualTokens / 10 ** PUMP_DECIMALS);
  }

  // Pools: non-signer owners whose token and SOL/WSOL balances move in opposite
  // directions (a swap) - or both out (a withdrawal).
  const pools = new Map<string, { owner: string; tok: OwnerMint; sol: number; solPost: number }>();
  for (const e of entries) {
    if (e.mint === WSOL || e.delta === 0 || signerSet.has(e.owner) || eventMints.has(e.mint)) continue;
    const w = wsolOf(e.owner);
    const sol = w && w.accounts === 1 ? w.delta : lamportDelta(e.owner);
    const solPost = w && w.accounts === 1 ? w.post : 0;
    if (sol === 0) continue;
    const cur = pools.get(e.mint);
    if (!cur || Math.abs(e.delta) > Math.abs(cur.tok.delta)) pools.set(e.mint, { owner: e.owner, tok: e, sol, solPost });
  }

  const excluded = new Set<string>([...(decoded.launch?.vaults ?? [])]);
  for (const m of eventMints) {
    try {
      excluded.add(bondingCurveOf(m));
    } catch {
      // not a valid key; nothing to exclude
    }
  }
  for (const p of pools.values()) excluded.add(p.owner);

  for (const [mint, p] of pools) {
    if (p.tok.delta < 0 && p.sol < 0) {
      // A migration empties the curve into the new pool; that is graduation, not a rug.
      if (decoded.migratedMint === mint) continue;
      // Both sides left the pool: liquidity withdrawn.
      const before = p.tok.post - p.tok.delta;
      decoded.liquidityRemovals.push({
        mint,
        pool: p.owner,
        pctOfPool: before > 0 ? (-p.tok.delta / before) * 100 : 0,
        solOut: -p.sol,
        recipients: entries.filter((e) => e.mint === mint && e.delta > 0 && e.owner !== p.owner).map((e) => e.owner),
      });
    } else if (Math.sign(p.tok.delta) !== Math.sign(p.sol) && p.solPost > 0 && p.tok.post > 0) {
      const decimals = meta.postTokenBalances.find((b) => b.mint === mint)?.uiTokenAmount?.decimals ?? 6;
      decoded.prices[mint] = p.solPost / 1e9 / (p.tok.post / 10 ** decimals);
    }
  }

  // Everyone else's token movements.
  for (const e of entries) {
    if (e.mint === WSOL || excluded.has(e.owner)) continue;
    const delta = e.delta - (explained.get(`${e.owner}|${e.mint}`) ?? 0);
    if (delta === 0) continue;
    const pool = pools.get(e.mint);
    const swapped = pool && pool.owner !== e.owner && Math.sign(pool.tok.delta) === -Math.sign(delta) && Math.sign(pool.sol) !== Math.sign(pool.tok.delta);
    // Fee recipients receive a sliver on the same side as the trader; they did not trade.
    if (swapped && pool && Math.abs(delta) >= Math.abs(pool.tok.delta) * 0.01) {
      // SOL side attributed pro rata to this trader's share of the pool's token change.
      const share = Math.min(1, Math.abs(delta) / Math.abs(pool.tok.delta));
      decoded.flows.push({ mint: e.mint, owner: e.owner, tokenDelta: delta, solDelta: -pool.sol * share, kind: delta > 0 ? "buy" : "sell", signer: signerSet.has(e.owner) });
    } else {
      decoded.flows.push({ mint: e.mint, owner: e.owner, tokenDelta: delta, solDelta: 0, kind: delta > 0 ? "transfer_in" : "transfer_out", signer: signerSet.has(e.owner) });
    }
  }

  decoded.poolOwners = [...excluded];
  return decoded;
}
