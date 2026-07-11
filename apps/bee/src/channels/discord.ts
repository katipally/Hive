import { Client, GatewayIntentBits, Partials, ChannelType } from "discord.js";
import type { ChannelAdapter, InboundMessage, ReplySink } from "./types.js";
import { splitMessage, toDiscord, DISCORD_LIMIT } from "./format.js";

// Discord via discord.js v14. DM-only for v1. Requires the Message Content
// privileged intent enabled in the Discord developer portal.
export class DiscordChannel implements ChannelAdapter {
  readonly kind = "discord" as const;
  private client: Client | null = null;
  private ok = false;

  constructor(private readonly botToken: string) {}

  async start(onMessage: (msg: InboundMessage, sink: ReplySink) => void): Promise<void> {
    const client = new Client({
      intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
      partials: [Partials.Channel, Partials.Message],
    });
    this.client = client;
    client.on("messageCreate", (msg) => {
      if (msg.author.bot) return;
      if (msg.channel.type !== ChannelType.DM) return; // DM-only v1
      if (msg.channel.isSendable()) void msg.channel.sendTyping().catch(() => {}); // CH-6
      const send = (text: string) => this.emit((s) => msg.channel.send(s), text);
      const sink: ReplySink = { delta: () => {}, done: (t) => send(t), notice: (t) => send(t) };
      onMessage(
        {
          channel: "discord",
          externalId: msg.author.id,
          displayName: msg.author.username,
          text: msg.content,
          ts: Date.now(),
        },
        sink,
      );
    });
    client.once("clientReady", () => (this.ok = true));
    // a bad token must not crash the runtime
    try {
      await client.login(this.botToken);
    } catch (e) {
      this.ok = false;
      console.error(`[discord] failed to start (check the bot token): ${(e as Error).message}`);
    }
  }

  async stop(): Promise<void> {
    await this.client?.destroy();
    this.ok = false;
  }

  async send(externalId: string, text: string): Promise<void> {
    if (!this.client) throw new Error("discord not started");
    const user = await this.client.users.fetch(externalId);
    await this.emit((s) => user.send(s), text);
  }

  // Format for Discord (expand markdown links) then deliver in <=2000-char chunks, in order.
  private async emit(sendOne: (part: string) => Promise<unknown>, text: string): Promise<void> {
    for (const part of splitMessage(toDiscord(text), DISCORD_LIMIT)) {
      await sendOne(part).catch((e) => console.error(`[discord] send failed: ${(e as Error).message}`));
    }
  }

  health() {
    return { ok: this.ok };
  }
}
