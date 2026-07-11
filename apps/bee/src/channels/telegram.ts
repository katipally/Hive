import { Bot } from "grammy";
import { SLASH_COMMANDS } from "@hive/shared";
import type { ChannelAdapter, InboundMessage, ReplySink } from "./types.js";
import { splitMessage, toTelegram, TELEGRAM_LIMIT } from "./format.js";

// Telegram's native "/" menu: names must be lowercase a-z0-9_ with no spaces, so drop
// multi-word commands (e.g. "privacy set") — they still work when typed.
const TELEGRAM_MENU = SLASH_COMMANDS.filter((c) => /^[a-z0-9_]{1,32}$/.test(c.name)).map((c) => ({
  command: c.name,
  description: c.description.slice(0, 256),
}));

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
      void ctx.replyWithChatAction("typing").catch(() => {}); // CH-6: show the bee is working
      const send = (text: string) => this.emit((s) => ctx.reply(s), text);
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
    void bot.api.setMyCommands(TELEGRAM_MENU).catch(() => {}); // populate the native "/" menu
    // fire-and-forget long polling — a bad token must not crash the runtime.
    // drop_pending_updates: don't replay a backlog of messages after a restart/reconnect.
    bot.start({ drop_pending_updates: true, onStart: () => { this.ok = true; } }).catch((e) => {
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
    await this.emit((s) => this.bot!.api.sendMessage(externalId, s), text);
  }

  // Format for Telegram (strip markdown) then deliver in <=4096-char chunks, in order.
  private async emit(sendOne: (part: string) => Promise<unknown>, text: string): Promise<void> {
    for (const part of splitMessage(toTelegram(text), TELEGRAM_LIMIT)) {
      await sendOne(part).catch((e) => console.error(`[telegram] send failed: ${(e as Error).message}`));
    }
  }

  health() {
    return { ok: this.ok, detail: this.detail || undefined };
  }
}
