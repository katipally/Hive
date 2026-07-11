import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChannelAdapter, InboundMessage, ReplySink } from "../types.js";
import { extractAttributedText } from "./attributed-body.js";
import { sendIMessage } from "./send.js";

const CHAT_DB = join(homedir(), "Library", "Messages", "chat.db");
// seconds between the Unix epoch (1970) and the Apple/CoreData epoch (2001)
const APPLE_EPOCH_MS = 978_307_200_000;
const POLL_MS = 2000;

interface Row {
  ROWID: number;
  text: string | null;
  attributedBody: Buffer | null;
  date: number;
  handle: string | null;
}

// iMessage: poll ~/Library/Messages/chat.db read-only for inbound messages.
// Requires Full Disk Access for the process. Send via AppleScript.
export class IMessageChannel implements ChannelAdapter {
  readonly kind = "imessage" as const;
  private db: Database.Database | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ok = false;
  private detail = "";

  constructor(
    private cursor: number,
    private readonly onCursor: (rowid: number) => void,
    // Point at a dedicated macOS user's Messages DB to run a "bot" Apple ID
    // (hive@icloud.com) instead of your personal account. Defaults to this user's.
    private readonly dbPath: string = CHAT_DB,
  ) {}

  async start(onMessage: (msg: InboundMessage, sink: ReplySink) => void): Promise<void> {
    try {
      this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
      // if cursor is 0, start from the current max so we don't replay history
      if (this.cursor === 0) {
        const row = this.db.prepare("SELECT MAX(ROWID) m FROM message").get() as { m: number | null };
        this.cursor = row.m ?? 0;
        this.onCursor(this.cursor);
      }
      this.ok = true;
    } catch (e) {
      this.ok = false;
      this.detail = (e as Error).message;
      console.error(
        `\n[imessage] cannot open chat.db — grant Full Disk Access to your terminal/node:\n` +
          `  System Settings → Privacy & Security → Full Disk Access → add Terminal (or your IDE).\n  (${this.detail})\n`,
      );
      return;
    }

    const poll = () => {
      const rows = this.db!.prepare(
        `SELECT m.ROWID, m.text, m.attributedBody, m.date, h.id AS handle
         FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID
         WHERE m.ROWID > ? AND m.is_from_me = 0
         ORDER BY m.ROWID ASC LIMIT 50`,
      ).all(this.cursor) as Row[];
      for (const r of rows) {
        this.cursor = r.ROWID;
        const text = r.text ?? (r.attributedBody ? extractAttributedText(r.attributedBody) : null);
        if (!text || !r.handle) continue;
        const sink: ReplySink = {
          delta: () => {},
          done: (t) => void sendIMessage(r.handle!, t).catch((e) => console.error("[imessage send]", e.message)),
          notice: (t) => void sendIMessage(r.handle!, t).catch(() => {}),
        };
        onMessage(
          {
            channel: "imessage",
            externalId: r.handle,
            displayName: null,
            text,
            ts: Math.round(r.date / 1e6 + APPLE_EPOCH_MS),
          },
          sink,
        );
      }
      if (rows.length) this.onCursor(this.cursor);
    };
    this.timer = setInterval(poll, POLL_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.db?.close();
    this.ok = false;
  }

  async send(externalId: string, text: string): Promise<void> {
    await sendIMessage(externalId, text);
  }

  health() {
    return { ok: this.ok, detail: this.detail || undefined };
  }
}
