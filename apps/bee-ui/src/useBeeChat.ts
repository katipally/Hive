import { useCallback, useEffect, useRef, useState } from "react";

export interface Msg {
  id: number;
  role: "user" | "bee" | "notice" | "nudge";
  text: string;
}

let counter = Date.now();
const msgsKey = (beeId: string) => `bee_msgs_${beeId}`;

function loadMsgs(beeId: string): Msg[] {
  try {
    const raw = localStorage.getItem(msgsKey(beeId));
    return raw ? (JSON.parse(raw) as Msg[]) : [];
  } catch {
    return [];
  }
}

// All the bee's chat state in one place: the WebSocket, the message log
// (persisted per bee so a refresh or bee-switch keeps history), and a
// registerable onDone callback the voice engine uses to speak the reply.
export function useBeeChat(beeId: string, opts?: { onPaired?: (name: string) => void; onError?: (msg: string) => void }) {
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
    if (!beeId) return;
    setMsgs(loadMsgs(beeId)); // instant paint from local cache…

    // …then reconcile with the server transcript (source of truth across devices).
    const uid = uidFor(beeId);
    let live = false;
    fetch(`/api/history?bee=${beeId}&uid=${uid}`)
      .then((r) => r.json())
      .then((turns: { role: "user" | "assistant"; content: string }[]) => {
        if (live || !Array.isArray(turns) || !turns.length) return;
        setMsgs(turns.map((t) => ({ id: counter++, role: t.role === "assistant" ? "bee" : "user", text: t.content })));
      })
      .catch(() => { /* offline — keep the local cache */ });

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/chat?bee=${beeId}&uid=${uidFor(beeId)}`);
    wsRef.current = ws;
    streamingRef.current = false;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => optsRef.current?.onError?.("Connection error");
    ws.onmessage = (e) => {
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
    return () => ws.close();
  }, [beeId]);

  // Persist the log for this bee whenever it changes (cap to keep storage sane).
  useEffect(() => {
    if (!beeId) return;
    try {
      localStorage.setItem(msgsKey(beeId), JSON.stringify(msgs.slice(-200)));
    } catch { /* quota — non-fatal */ }
  }, [beeId, msgs]);

  const clear = useCallback(() => {
    if (!beeId) return;
    try { localStorage.removeItem(msgsKey(beeId)); } catch { /* noop */ }
    setMsgs([]);
  }, [beeId]);

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
export function uidFor(beeId: string): string {
  const k = `bee_uid_${beeId}`;
  let v = localStorage.getItem(k);
  if (!v) {
    v = `web_${beeId.slice(-6)}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(k, v);
  }
  return v;
}
