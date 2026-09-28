/** Optional push alerts to Telegram and/or a Discord webhook. */
import type { Config } from "./config.js";
import type { Alert } from "./engine/tripwires.js";
import type { Launch } from "./engine/tracker.js";
import type { ExitRecord } from "./engine/exit.js";

export class Notifier {
  constructor(private readonly cfg: Config) {}

  private async send(text: string): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    const { TELEGRAM_BOT_TOKEN: tg, TELEGRAM_CHAT_ID: chat, DISCORD_WEBHOOK_URL: discord } = this.cfg;
    if (tg && chat) {
      jobs.push(
        fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
        }),
      );
    }
    if (discord) {
      jobs.push(fetch(discord, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text }) }));
    }
    const results = await Promise.allSettled(jobs);
    for (const r of results) if (r.status === "rejected") console.warn(`[notify] ${(r.reason as Error).message}`);
  }

  alert(a: Alert, l: Launch): Promise<void> {
    if (a.severity !== "critical") return Promise.resolve();
    return this.send(
      `🚨 ${a.symbol}: ${a.title}\n${a.detail}\nrisk ${l.risk.score}/100\nhttps://solscan.io/tx/${a.signature}\nhttps://pump.fun/coin/${a.mint}`,
    );
  }

  exit(r: ExitRecord): Promise<void> {
    const sol = r.expectedSol !== undefined ? `${r.expectedSol.toFixed(4)} SOL` : "?";
    const link = r.signature ? `\nhttps://solscan.io/tx/${r.signature}` : "";
    return this.send(`↩️ exit ${r.symbol} [${r.mode}] ${r.status}: ${r.tokens.toFixed(0)} tokens → ${sol}${r.landMs ? ` landed in ${r.landMs}ms via Beam` : ""}${r.error ? `\n${r.error}` : ""}${link}`);
  }
}
