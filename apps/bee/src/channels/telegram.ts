import { Bot } from "grammy";
import type { ChannelAdapter, InboundMessage, ReplySink } from "./types.js";

// Telegram via grammY bot (long polling). One bot token per bee instance.
export class TelegramChannel implements ChannelAdapter {
  readonly kind = "telegram" as const;
  private bot: Bot | null = null;
  private ok = false;
  private detail = "";

  constructor(private readonly botToken: string) {}

  async start(onMessage: (msg: InboundMessage, sink: ReplySink) => void): Promise<void> {
    // A Telegram token is `<digits>:<secret>` (from @BotFather). Catch the common
    // mistake of pasting a Discord token (dot-separated) here — otherwise grammY
    // just spins on 401/404 with no hint why.
    if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(this.botToken)) {
      this.ok = false;
      this.detail = "That doesn't look like a Telegram bot token (should look like 123456789:AA…). Did you paste a Discord token by mistake?";
      console.error(`[telegram] ${this.detail}`);
      return;
    }
    const bot = new Bot(this.botToken);
    this.bot = bot;
    bot.on("message:text", (ctx) => {
      const from = ctx.from;
      if (!from || from.is_bot) return;
      const send = (text: string) => void ctx.reply(text);
      const sink: ReplySink = { delta: () => {}, done: (t) => send(t), notice: (t) => send(t) };
      onMessage(
        {
          channel: "telegram",
          externalId: String(from.id),
          displayName: from.first_name ?? from.username ?? null,
          text: ctx.message.text,
          ts: Date.now(),
        },
        sink,
      );
    });
    bot.catch((e) => console.error("[telegram]", e.message));
    // fire-and-forget long polling — a bad token must not crash the runtime
    bot.start({ onStart: () => { this.ok = true; } }).catch((e) => {
      this.ok = false;
      console.error(`[telegram] failed to start (check the bot token): ${(e as Error).message}`);
    });
  }

  async stop(): Promise<void> {
    // If the bot never came up (e.g. a revoked/invalid token → 401), grammY's
    // stop() itself calls getUpdates and throws. Swallow it so a bad token can't
    // surface as an unhandled rejection on restart/reconfigure.
    try {
      await this.bot?.stop();
    } catch (e) {
      console.error(`[telegram] stop ignored (${(e as Error).message})`);
    }
    this.ok = false;
  }

  async send(externalId: string, text: string): Promise<void> {
    if (!this.bot) throw new Error("telegram not started");
    await this.bot.api.sendMessage(externalId, text);
  }

  health() {
    return { ok: this.ok, detail: this.detail || undefined };
  }
}
