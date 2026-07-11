import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "./config.js";

export interface Msg {
  id: number;
  role: "user" | "bee" | "notice" | "nudge";
  text: string;
}

let counter = Date.now();
const msgsKey = (beeId: string, sessionId: string) => `bee_msgs_${beeId}_${sessionId}`;

function loadMsgs(beeId: string, sessionId: string): Msg[] {
  try {
    const raw = localStorage.getItem(msgsKey(beeId, sessionId));
    return raw ? (JSON.parse(raw) as Msg[]) : [];
  } catch {
    return [];
  }
}

// All the bee's chat state in one place: the WebSocket, the message log
// (persisted per bee so a refresh or bee-switch keeps history), and a
// registerable onDone callback the voice engine uses to speak the reply.
export function useBeeChat(beeId: string, sessionId: string, opts?: { onPaired?: (name: string) => void; onError?: (msg: string) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [connected, setConnected] = useState(false);
  const [thinking, setThinking] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const streamingRef = useRef(false);
  const onDoneRef = useRef<((text: string) => void) | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const setOnDone = useCallback((fn: ((text: string) => void) | null) => { onDoneRef.current = fn; }, []);

  useEffect(() => {
    if (!beeId || !sessionId) return;
    setMsgs(loadMsgs(beeId, sessionId)); // instant paint from local cache…

    // …then reconcile with the server transcript (source of truth across devices).
    const uid = uidFor(beeId);
    let live = false;
    fetch(`${API_BASE}/history?bee=${beeId}&uid=${uid}&session=${sessionId}`)
      .then((r) => r.json())
      .then((turns: { role: string; content: string }[]) => {
        if (live || !Array.isArray(turns) || !turns.length) return;
        // history now includes out-of-band messages (nudge/notice) — roles map 1:1
        setMsgs(turns.map((t) => ({ id: counter++, role: t.role as Msg["role"], text: t.content })));
      })
      .catch(() => { /* offline — keep the local cache */ });

    // Auto-reconnecting socket: a dev reload or network blip must never leave the
    // chat permanently "offline" (it used to, with no retry). Backoff, then resume.
    let closed = false;
    let backoff = 500;
    let ws: WebSocket;

    const onMessage = (e: MessageEvent) => {
      live = true; // a live turn started — don't let a late history fetch clobber it
      const m = JSON.parse(e.data) as { type: string; text: string };
      setMsgs((prev) => {
        if (m.type === "delta") {
          setThinking(false);
          const last = prev[prev.length - 1];
          if (streamingRef.current && last?.role === "bee") {
            return [...prev.slice(0, -1), { ...last, text: last.text + m.text }];
          }
          streamingRef.current = true;
          return [...prev, { id: counter++, role: "bee", text: m.text }];
        }
        if (m.type === "done") {
          streamingRef.current = false;
          setThinking(false);
          const last = prev[prev.length - 1];
          if (last?.role === "bee") onDoneRef.current?.(last.text);
          return prev;
        }
        if (m.type === "notice") {
          setThinking(false);
          const linked = m.text.match(/Linked!\s*Hi\s+(.+?)\s*—/);
          if (linked) optsRef.current?.onPaired?.(linked[1]!);
          return [...prev, { id: counter++, role: "notice", text: m.text }];
        }
        if (m.type === "nudge") return [...prev, { id: counter++, role: "nudge", text: m.text }];
        return prev;
      });
    };

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws/chat?bee=${beeId}&uid=${uid}&session=${sessionId}`);
      wsRef.current = ws;
      streamingRef.current = false;
      ws.onopen = () => { backoff = 500; setConnected(true); };
      ws.onmessage = onMessage;
      ws.onerror = () => { /* let onclose drive the retry; no scary toast */ };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 10_000);
      };
    };
    connect();
    return () => { closed = true; ws?.close(); };
  }, [beeId, sessionId]);

  // Persist the log for this bee whenever it changes (cap to keep storage sane).
  useEffect(() => {
    if (!beeId || !sessionId) return;
    try {
      localStorage.setItem(msgsKey(beeId, sessionId), JSON.stringify(msgs.slice(-200)));
    } catch { /* quota — non-fatal */ }
  }, [beeId, sessionId, msgs]);

  const clear = useCallback(() => {
    if (!beeId || !sessionId) return;
    try { localStorage.removeItem(msgsKey(beeId, sessionId)); } catch { /* noop */ }
    setMsgs([]);
  }, [beeId, sessionId]);

  const send = useCallback((text: string) => {
    const t = text.trim();
    const ws = wsRef.current;
    if (!t) return false;
    if (!ws || ws.readyState !== 1) {
      optsRef.current?.onError?.("Not connected — message not sent");
      return false;
    }
    setMsgs((p) => [...p, { id: counter++, role: "user", text: t }]);
    setThinking(true);
    ws.send(JSON.stringify({ type: "msg", text: t }));
    return true;
  }, []);

  return { msgs, connected, thinking, send, setOnDone, clear };
}

// Each bee instance is a distinct person: give it its own web identity so
// bee-1 pairs to one member+code and bee-2 to another, independently.
// Hosted demo: instead of a random per-browser uid, chat AS a seeded member.
// The bee pre-links `web-alice` / `web-bob` / `web-cara`, so picking an identity
// here lands you straight in that member's world — no code to paste.
export const DEMO: boolean = (import.meta.env as Record<string, string | undefined>).VITE_DEMO === "1";
export const DEMO_NAMES = ["Alice", "Bob", "Cara"];
export function demoIdentity(): string {
  return localStorage.getItem("demo_identity") || "alice";
}
export function setDemoIdentity(name: string): void {
  localStorage.setItem("demo_identity", name.toLowerCase());
  // drop cached transcripts so the new identity starts from server truth, not the last one's
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith("bee_msgs_")) localStorage.removeItem(k);
  }
  location.reload();
}

export function uidFor(beeId: string): string {
  if (DEMO) return `web-${demoIdentity()}`;
  const k = `bee_uid_${beeId}`;
  let v = localStorage.getItem(k);
  if (!v) {
    v = `web_${beeId.slice(-6)}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(k, v);
  }
  return v;
}
