import type { ChannelKind } from "@hive/shared";

export interface InboundMessage {
  channel: ChannelKind;
  externalId: string;
  displayName: string | null;
  text: string;
  ts: number;
  // web only: which conversation thread this belongs to (multiple per profile).
  // Channels omit it → one continuous "main" thread.
  sessionTag?: string;
}

// Where a reply is written. Streaming channels use delta(); others buffer to done().
export interface ReplySink {
  delta(text: string): void;
  done(fullText: string): void | Promise<void>;
  // out-of-band notice (pairing prompts, errors) — not part of the conversation
  notice(text: string): void | Promise<void>;
  // discard whatever's been streamed so far this turn (used to drop tool-call narration
  // so the user sees one clean reply). No-op on non-streaming channels.
  reset?(): void;
}

export interface ChannelAdapter {
  readonly kind: ChannelKind;
  start(onMessage: (msg: InboundMessage, sink: ReplySink) => void): Promise<void>;
  stop(): Promise<void>;
  // whole-message send (nudges, non-streaming replies)
  send(externalId: string, text: string): Promise<void>;
  health(): { ok: boolean; detail?: string };
}
