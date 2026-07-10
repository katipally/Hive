import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, ChevronDown, Sparkles, Check, Mic } from "lucide-react";
import { HexMark } from "./Logo.js";
import { cn } from "./lib/cn.js";
import { spring, quick } from "./lib/motion.js";

interface BeeInfo {
  beeId: string;
  name: string;
}
interface Msg {
  id: number;
  role: "user" | "bee" | "notice" | "nudge";
  text: string;
}

let counter = 0;
// Each bee instance is a distinct person: give it its own web identity so
// bee-1 pairs to one member+code and bee-2 to another, independently.
function uidFor(beeId: string): string {
  const k = `bee_uid_${beeId}`;
  let v = localStorage.getItem(k);
  if (!v) {
    v = `web_${beeId.slice(-6)}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(k, v);
  }
  return v;
}
const memberKey = (beeId: string) => `bee_member_${beeId}`;

export function App() {
  const [bees, setBees] = useState<BeeInfo[]>([]);
  const [beeId, setBeeId] = useState(() => localStorage.getItem("bee_sel") ?? "");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [pairedName, setPairedName] = useState<string | null>(null);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const streamingRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recogRef = useRef<any>(null);

  useEffect(() => {
    fetch("/api/bees")
      .then((r) => r.json())
      .then((b: BeeInfo[]) => {
        setBees(b);
        setMemberNames(Object.fromEntries(b.map((x) => [x.beeId, localStorage.getItem(memberKey(x.beeId)) ?? ""]).filter(([, v]) => v)));
        // pick a valid bee — a cached selection from an old run won't exist anymore
        setBeeId((cur) => (b.some((x) => x.beeId === cur) ? cur : b[0]?.beeId ?? ""));
      })
      .catch(() => setBees([]));
  }, []);

  useEffect(() => {
    if (!beeId) return;
    localStorage.setItem("bee_sel", beeId);
    setMsgs([]);
    setPairedName(localStorage.getItem(memberKey(beeId)));
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/chat?bee=${beeId}&uid=${uidFor(beeId)}`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
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
          return prev;
        }
        if (m.type === "notice") {
          setThinking(false);
          const linked = m.text.match(/Linked!\s*Hi\s+(.+?)\s*—/);
          if (linked) {
            const name = linked[1]!;
            localStorage.setItem(memberKey(beeId), name);
            setPairedName(name);
            setMemberNames((mm) => ({ ...mm, [beeId]: name }));
          }
          return [...prev, { id: counter++, role: "notice", text: m.text }];
        }
        if (m.type === "nudge") return [...prev, { id: counter++, role: "nudge", text: m.text }];
        return prev;
      });
    };
    return () => ws.close();
  }, [beeId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, thinking]);

  // auto-grow the textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  function send() {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== 1) return;
    setMsgs((p) => [...p, { id: counter++, role: "user", text }]);
    setThinking(true);
    wsRef.current.send(JSON.stringify({ type: "msg", text }));
    setInput("");
  }

  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e: any) => setInput(Array.from(e.results).map((x: any) => x[0].transcript).join(""));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
    setListening(true);
    r.start();
  }

  const beeName = bees.find((b) => b.beeId === beeId)?.name ?? "bee";
  const label = (b: BeeInfo) => memberNames[b.beeId] || b.name;

  return (
    <div className="relative z-10 mx-auto flex h-full max-w-2xl flex-col">
      {/* top bar */}
      <header className="flex items-center gap-3 px-5 py-3.5">
        <HexMark size={20} />
        <div className="relative">
          <button
            onClick={() => setSwitcherOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition hover:bg-fg/[0.05]"
          >
            <span className="text-[15px] font-semibold tracking-tight">{pairedName ?? beeName}</span>
            <span className="text-[11px] text-faint">{pairedName ? beeName : "· not linked"}</span>
            <ChevronDown size={15} className="text-faint" />
          </button>
          <AnimatePresence>
            {switcherOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSwitcherOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1, transition: spring }}
                  exit={{ opacity: 0, y: -6, scale: 0.97, transition: quick }}
                  className="absolute left-0 top-full z-20 mt-1 min-w-[210px] rounded-xl border border-border bg-popover p-1 shadow-2xl"
                >
                  {bees.map((b) => (
                    <button
                      key={b.beeId}
                      onClick={() => {
                        setBeeId(b.beeId);
                        setSwitcherOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition hover:bg-fg/[0.06]"
                    >
                      <HexMark size={14} />
                      <span className="text-fg">{label(b)}</span>
                      {memberNames[b.beeId] && <span className="text-[11px] text-faint">{b.name}</span>}
                      {b.beeId === beeId && <Check size={13} className="ml-auto text-honey" />}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
        <span
          className={cn(
            "ml-auto flex items-center gap-1.5 text-[11px]",
            connected ? "text-share" : "text-faint",
          )}
        >
          <span className={cn("size-2 rounded-full", connected ? "bg-share shadow-[0_0_8px_var(--color-share)]" : "bg-faint")} />
          {connected ? "connected" : "offline"}
        </span>
      </header>

      {/* messages */}
      <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {msgs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <HexMark size={34} />
            <div className="text-[18px] font-semibold tracking-tight">Hi, I'm your bee</div>
            <p className="max-w-xs text-[13px] text-muted">
              Tell me what's going on in your life. I remember, and I look out for you and your friends.
            </p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {msgs.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "flex",
                m.role === "user" && "justify-end",
                m.role === "notice" && "justify-center",
              )}
            >
              {m.role === "user" && (
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-honey px-3.5 py-2 text-[14px] leading-relaxed text-bg">
                  {m.text}
                </div>
              )}
              {m.role === "bee" && (
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-border bg-card px-3.5 py-2 text-[14px] leading-relaxed text-fg">
                  {m.text}
                </div>
              )}
              {m.role === "notice" && (
                <div className="rounded-full bg-fg/[0.05] px-3 py-1 text-[12px] italic text-muted">{m.text}</div>
              )}
              {m.role === "nudge" && (
                <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-honey/30 bg-honey-soft px-3.5 py-2.5">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-honey">
                    <Sparkles size={12} /> from the hive
                  </div>
                  <div className="text-[14px] leading-relaxed text-fg">{m.text}</div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {thinking && (
          <div className="flex">
            <div className="honey-shimmer text-[13px] font-medium">thinking…</div>
          </div>
        )}
      </div>

      {/* composer */}
      <div className="px-5 pb-5 pt-2">
        <div className="rounded-[20px] border border-border bg-surface shadow-[0_10px_34px_-12px_rgba(0,0,0,0.6)] transition-[box-shadow,border-color] focus-within:border-honey/40 focus-within:shadow-[0_16px_44px_-12px_rgba(0,0,0,0.75)]">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={pairedName ? `Message your bee…` : `Send your invite code to link…`}
            className="block max-h-40 w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] text-fg outline-none placeholder:text-faint"
          />
          <div className="flex items-center justify-end gap-1.5 px-2.5 pb-2.5">
            <button
              onClick={toggleMic}
              title="Speak"
              className={cn(
                "grid size-8 place-items-center rounded-full text-muted transition hover:bg-fg/10 hover:text-fg",
                listening && "bg-ember/15 text-ember",
              )}
            >
              <Mic size={16} />
            </button>
            <button
              onClick={send}
              disabled={!input.trim()}
              className="grid size-8 place-items-center rounded-full bg-honey text-bg transition enabled:hover:brightness-105 disabled:opacity-30"
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
