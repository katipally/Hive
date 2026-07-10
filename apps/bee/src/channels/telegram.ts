import { Bot } from "grammy";
import type { ChannelAdapter, InboundMessage, ReplySink } from "./types.js";

// Telegram via grammY bot (long polling). One bot token per bee instance.
export class TelegramChannel implements ChannelAdapter {
  readonly kind = "telegram" as const;
  private bot: Bot | null = null;
  private ok = false;

  constructor(private readonly botToken: string) {}

  async start(onMessage: (msg: InboundMessage, sink: ReplySink) => void): Promise<void> {
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
    await this.bot?.stop();
    this.ok = false;
  }

  async send(externalId: string, text: string): Promise<void> {
    if (!this.bot) throw new Error("telegram not started");
    await this.bot.api.sendMessage(externalId, text);
  }

  health() {
    return { ok: this.ok };
  }
}
