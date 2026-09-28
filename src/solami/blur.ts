/**
 * Solami Blur REST client (decoded market data). Used to deepen what the gRPC stream
 * tells us: Blur's own intel cohorts, mint security, the dev's launch history, and a
 * funding-cluster check on the first buyers.
 *
 * Blur's convention: fractional values arrive as decimal strings, integers as numbers.
 */
import type { ExternalIntel } from "../engine/scorer.js";

export interface BlurStatus {
  enabled: boolean;
  ok: boolean;
  calls: number;
  errors: number;
  avgMs: number;
  lastError?: string;
}

export class BlurError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const dec = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
};

export class BlurClient {
  readonly status: BlurStatus;
  private totalMs = 0;
  private inflight = 0;
  private queue: (() => void)[] = [];

  constructor(
    private readonly baseUrl: string,
    private readonly key: string,
    enabled: boolean,
    private readonly maxConcurrent = 6,
  ) {
    this.status = { enabled, ok: enabled, calls: 0, errors: 0, avgMs: 0 };
  }

  private async slot(): Promise<void> {
    if (this.inflight < this.maxConcurrent) {
      this.inflight++;
      return;
    }
    await new Promise<void>((r) => this.queue.push(r));
    this.inflight++;
  }

  private release(): void {
    this.inflight--;
    this.queue.shift()?.();
  }

  async get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    if (!this.status.enabled) throw new BlurError("Blur disabled", 0);
    const qs = new URLSearchParams({ chain: "solana" });
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
    const url = `${this.baseUrl}${path}?${qs}`;
    await this.slot();
    try {
      for (let attempt = 0; ; attempt++) {
        const t0 = Date.now();
        const res = await fetch(url, { headers: { "x-api-key": this.key }, signal: AbortSignal.timeout(10_000) });
        this.status.calls++;
        this.totalMs += Date.now() - t0;
        this.status.avgMs = Math.round(this.totalMs / this.status.calls);
        if (res.ok) {
          this.status.ok = true;
          return (await res.json()) as T;
        }
        const body = await res.text();
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < 2) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        this.status.errors++;
        this.status.lastError = `${res.status} ${path}: ${body.slice(0, 160)}`;
        if (res.status === 401 || res.status === 403) {
          // The key cannot use Blur; stop hammering it and say so in the health panel.
          this.status.enabled = false;
          this.status.ok = false;
        }
        throw new BlurError(this.status.lastError, res.status);
      }
    } finally {
      this.release();
    }
  }

  /** Blur's view of a token: intel cohorts, security, dev history, first-buyer funding. */
  async enrich(mint: string, creatorHint?: string): Promise<ExternalIntel> {
    const [intel, security, dev, buyers] = await Promise.allSettled([
      this.get<IntelResponse>("/data/token/intel", { address: mint }),
      this.get<SecurityResponse>("/data/token/security", { address: mint }),
      this.get<DevResponse>("/data/token/dev", { address: mint, limit: 1 }),
      this.get<FirstBuyer[]>("/data/token/first-buyers", { address: mint, limit: 40 }),
    ]);
    const out: ExternalIntel = { source: "blur" };
    let creator = creatorHint;
    if (intel.status === "fulfilled") {
      const i = intel.value;
      out.intelScore = i.score;
      out.rugged = i.rugged;
      out.intelFlags = i.flags ?? [];
      out.bundlerHeldPct = dec(i.bundlers?.held_pct);
      out.sniperHeldPct = dec(i.snipers?.held_pct);
      out.insiderHeldPct = dec(i.insiders?.held_pct);
      creator ||= i.dev?.list?.[0]?.wallet;
    }
    if (security.status === "fulfilled") {
      const s = security.value;
      out.mintAuthority = s.mint_authority;
      out.freezeAuthority = s.freeze_authority;
      out.top10Pct = dec(s.top10_pct);
      creator ||= s.creator || undefined;
    }
    if (dev.status === "fulfilled") {
      out.devTokensLaunched = dev.value.tokens_launched;
      out.devMigrated = dev.value.migrated;
      creator ||= dev.value.creator || undefined;
    }
    if (buyers.status === "fulfilled" && buyers.value.length >= 3) {
      const wallets = buyers.value.map((b) => b.wallet).filter((w) => w && w !== creator);
      try {
        const c = await this.get<ClusterResponse>("/data/wallet/cluster", { address: wallets.join(",") });
        const top = c.clusters?.[0];
        out.fundingClusterPct = dec(top?.pct_of_requested) ?? 0;
        out.fundedByDev = !!creator && (c.clusters ?? []).some((k) => k.funder === creator && k.funded >= 2);
      } catch {
        // Cluster lookups are best-effort; the rest of the intel still stands.
      }
    }
    if (intel.status === "rejected" && security.status === "rejected" && dev.status === "rejected") {
      throw intel.reason;
    }
    return out;
  }

  /** Creator and symbol for a mint Tripwire did not see launch. */
  async creation(mint: string): Promise<{ creator?: string; name?: string; symbol?: string } | undefined> {
    try {
      const r = await this.get<{ creator?: string; name?: string; symbol?: string }>("/data/token/creation", { address: mint });
      return r;
    } catch {
      return undefined;
    }
  }
}

interface Cohort {
  wallets: number;
  held_pct: string;
  initial_pct: string;
  list?: { wallet: string }[];
}
interface IntelResponse {
  mint: string;
  score: number;
  rugged: boolean;
  flags?: { name: string; level: string; detail: string }[];
  dev?: Cohort;
  snipers?: Cohort;
  bundlers?: Cohort;
  insiders?: Cohort;
}
interface SecurityResponse {
  mint_authority: string | null;
  freeze_authority: string | null;
  top10_pct?: string;
  creator?: string;
}
interface DevResponse {
  creator: string;
  tokens_launched: number;
  migrated: number;
}
interface FirstBuyer {
  wallet: string;
}
interface ClusterResponse {
  requested: number;
  resolved: number;
  clusters?: { funder: string; funded: number; pct_of_requested: string }[];
}
