import "dotenv/config";
import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase())));
const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)));

const schema = z.object({
  SOLAMI_API_KEY: z.string().min(1, "SOLAMI_API_KEY is required - get one at https://solami.dev"),
  /** Separate keys if your gRPC and Data API permissions live on different keys. */
  SOLAMI_GRPC_KEY: z.string().optional(),
  SOLAMI_DATA_KEY: z.string().optional(),
  SOLAMI_RPC_KEY: z.string().optional(),
  SOLAMI_REGION: z.enum(["", "nyc", "fra", "ams"]).optional().default(""),

  PORT: num(8787),
  HOST: z.string().optional().default("127.0.0.1"),

  /** Follow every pump.fun / PumpSwap launch and score it live. */
  RADAR: bool(true),
  /** Automatically arm tripwires on launches that show traction. */
  AUTO_WATCH: bool(true),
  AUTO_WATCH_MIN_PROGRESS: num(15),
  AUTO_WATCH_MIN_BUYERS: num(15),
  AUTO_WATCH_MAX: num(40),
  /** Enrich launches that show traction with Blur REST intel (needs DataApi). */
  BLUR_ENRICH: bool(true),

  /** Exits. paper = simulate and log; live = sign and send through Beam. */
  EXIT_MODE: z.enum(["paper", "live"]).optional().default("paper"),
  WALLET_SECRET_KEY: z.string().optional(),
  EXIT_MAX_SOL: num(0.5),
  EXIT_SLIPPAGE_BPS: num(1500),
  BEAM_TIP_LAMPORTS: num(100_000),
  PRIORITY_FEE_MICROLAMPORTS: num(200_000),
  JUPITER_API: z.string().optional().default("https://lite-api.jup.ag/swap/v1"),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.string().optional(),
});

export type Config = z.infer<typeof schema> & {
  grpcKey: string;
  dataKey: string;
  rpcKey: string;
  grpcUrl: string;
  rpcUrl: string;
  apiUrl: string;
  wsUrl: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${msg}\nCopy .env.example to .env and fill it in.`);
  }
  const c = parsed.data;
  const r = c.SOLAMI_REGION ? `${c.SOLAMI_REGION}.` : "";
  return {
    ...c,
    grpcKey: c.SOLAMI_GRPC_KEY || c.SOLAMI_API_KEY,
    dataKey: c.SOLAMI_DATA_KEY || c.SOLAMI_API_KEY,
    rpcKey: c.SOLAMI_RPC_KEY || c.SOLAMI_API_KEY,
    grpcUrl: `https://${r}grpc.solami.dev`,
    rpcUrl: `https://${r}rpc.solami.dev/sol`,
    apiUrl: `https://${r}api.solami.dev`,
    wsUrl: `wss://${r}ws.solami.dev`,
  };
}
