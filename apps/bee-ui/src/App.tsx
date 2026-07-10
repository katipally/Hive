import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Sparkles, Mic, AudioLines, Settings2, Plus, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { HexMark } from "./Logo.js";
import { ThemeToggle, useToast } from "@hive/ui";
import { cn } from "./lib/cn.js";
import { useBeeChat } from "./useBeeChat.js";
import { useVoice } from "./useVoice.js";
import { VoiceMode } from "./VoiceMode.js";
import { Settings } from "./Settings.js";
import { usePrefs, TEXT_SIZE_CLASS } from "./usePrefs.js";

interface BeeInfo {
  beeId: string;
  name: string;
}

const memberKey = (beeId: string) => `bee_member_${beeId}`;

export function App() {
  const toast = useToast();
  const [bees, setBees] = useState<BeeInfo[]>([]);
  const [beeId, setBeeId] = useState(() => localStorage.getItem("bee_sel") ?? "");
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [pairedName, setPairedName] = useState<string | null>(null);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newBee, setNewBee] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("bee_sidebar") !== "0");
  const { prefs, set: setPref } = usePrefs();
  const logRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recogRef = useRef<any>(null);

  const chat = useBeeChat(beeId, {
    onPaired: (name) => {
      localStorage.setItem(memberKey(beeId), name);
      setPairedName(name);
      setMemberNames((mm) => ({ ...mm, [beeId]: name }));
    },
    onError: (m) => toast(m, "error"),
  });
  const voice = useVoice({ send: chat.send, setOnDone: chat.setOnDone });

  const loadBees = useCallback(async (): Promise<BeeInfo[]> => {
    try {
      const b = (await fetch("/api/bees").then((r) => r.json())) as BeeInfo[];
      setBees(b);
      setMemberNames(Object.fromEntries(b.map((x) => [x.beeId, localStorage.getItem(memberKey(x.beeId)) ?? ""]).filter(([, v]) => v)));
      return b;
    } catch {
      setBees([]);
      toast("Couldn't reach the bee runtime", "error");
      return [];
    }
  }, [toast]);

  useEffect(() => {
    loadBees().then((b) => setBeeId((cur) => (b.some((x) => x.beeId === cur) ? cur : b[0]?.beeId ?? "")));
  }, [loadBees]);

  useEffect(() => {
    if (!beeId) return;
    localStorage.setItem("bee_sel", beeId);
    setPairedName(localStorage.getItem(memberKey(beeId)));
  }, [beeId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.msgs, chat.thinking]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  function toggleSidebar() {
    setSidebarOpen((o) => { localStorage.setItem("bee_sidebar", o ? "0" : "1"); return !o; });
  }

  async function addBee() {
    const nm = newBee.trim();
    try {
      const created = (await fetch("/api/bees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nm }),
      }).then((r) => r.json())) as BeeInfo;
      setNewBee("");
      await loadBees();
      setBeeId(created.beeId);
      toast("Bee added");
    } catch {
      toast("Couldn't add a bee", "error");
    }
  }

  function submit() {
    if (chat.send(input)) setInput("");
  }

  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast("Speech input isn't supported in this browser", "error"); return; }
    if (listening) { recogRef.current?.stop(); return; }
    const r = new SR();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e: any) => setInput(Array.from(e.results).map((x: any) => x[0].transcript).join(""));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
    setListening(true);
    r.start();
  }

  function startVoice() {
    if (!voice.supported) { toast("Voice mode needs a browser with speech support (try Chrome)", "error"); return; }
    voice.start();
  }

  function unlink() {
    if (!beeId) return;
    localStorage.removeItem(`bee_uid_${beeId}`);
    localStorage.removeItem(memberKey(beeId));
    chat.clear();
    location.reload();
  }

  const beeName = bees.find((b) => b.beeId === beeId)?.name ?? "bee";
  const label = (b: BeeInfo) => memberNames[b.beeId] || b.name;

  return (
    <div className="relative z-10 flex h-dvh gap-2 bg-background p-2">
      {/* Conversation sidebar — one entry per bee, each its own history. */}
      {sidebarOpen ? (
        <aside className="flex w-60 shrink-0 flex-col px-1.5 py-1">
          <div className="flex items-center gap-2 px-2 py-2">
            <HexMark size={20} />
            <span className="text-[15px] font-semibold tracking-tight">Hive</span>
            <button onClick={toggleSidebar} aria-label="Collapse sidebar" title="Collapse"
              className="ml-auto grid size-7 place-items-center rounded-lg text-faint transition hover:bg-fg/[0.06] hover:text-fg">
              <PanelLeftClose size={16} />
            </button>
          </div>

          <button
            onClick={addBee}
            className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-2 text-[13px] font-medium text-muted transition hover:border-accent/40 hover:text-accent"
          >
            <Plus size={15} /> New bee
          </button>
          <input
            value={newBee}
            onChange={(e) => setNewBee(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addBee(); }}
            placeholder="Name it (optional), then Enter…"
            className="mt-1 w-full rounded-md bg-transparent px-2.5 py-1.5 text-[12px] text-fg outline-none placeholder:text-faint"
          />

          <div className="px-2 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-faint">Bees</div>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {bees.map((b) => (
              <button
                key={b.beeId}
                onClick={() => setBeeId(b.beeId)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition",
                  b.beeId === beeId ? "bg-accent-soft text-accent" : "text-muted hover:bg-fg/[0.05] hover:text-fg",
                )}
              >
                <HexMark size={14} />
                <span className="flex-1 truncate">{label(b)}</span>
                {memberNames[b.beeId] && <span className="shrink-0 text-[10px] text-faint">{b.name}</span>}
              </button>
            ))}
          </div>

          <div className="mt-1 flex items-center gap-1 border-t border-border px-1 pt-1.5">
            <ThemeToggle />
            <button onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings"
              className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-fg/[0.06] hover:text-fg">
              <Settings2 size={16} />
            </button>
          </div>
        </aside>
      ) : (
        <div className="flex w-11 shrink-0 flex-col items-center gap-2 py-2">
          <button onClick={toggleSidebar} aria-label="Show bees" title="Show bees"
            className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-fg/[0.06] hover:text-fg">
            <PanelLeftOpen size={17} />
          </button>
          <HexMark size={20} />
        </div>
      )}

      {/* Elevated chat panel. */}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <span className="text-[14px] font-semibold tracking-tight text-fg">{pairedName ?? beeName}</span>
          <span className="text-[11px] text-faint">{pairedName ? beeName : "· not linked"}</span>
          <span className={cn("ml-auto flex items-center gap-1.5 text-[11px]", chat.connected ? "text-share" : "text-faint")} aria-live="polite">
            <span className={cn("size-2 rounded-full", chat.connected ? "bg-share shadow-[0_0_8px_var(--color-share)]" : "bg-faint")} />
            {chat.connected ? "connected" : "offline"}
          </span>
        </header>

        <div ref={logRef} role="log" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl space-y-3 px-5 py-5">
            {chat.msgs.length === 0 && (
              <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
                <HexMark size={34} />
                <div className="text-[18px] font-semibold tracking-tight">Hi, I'm your bee</div>
                <p className="max-w-xs text-[13px] text-muted">
                  Tell me what's going on in your life. I remember, and I look out for you and your friends.
                </p>
              </div>
            )}

            <AnimatePresence initial={false}>
              {chat.msgs.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className={cn("flex", m.role === "user" && "justify-end", m.role === "notice" && "justify-center")}
                >
                  {m.role === "user" && (
                    <div className={cn("max-w-[80%] rounded-2xl rounded-br-md bg-honey px-3.5 py-2 leading-relaxed text-bg", TEXT_SIZE_CLASS[prefs.textSize])}>{m.text}</div>
                  )}
                  {m.role === "bee" && (
                    <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-border bg-elevated px-3.5 py-2 leading-relaxed text-fg", TEXT_SIZE_CLASS[prefs.textSize])}>{m.text}</div>
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

            {chat.thinking && (
              <div className="flex">
                <div className="honey-shimmer text-[13px] font-medium">thinking…</div>
              </div>
            )}
          </div>
        </div>

        <div className="px-4 pb-4 pt-2">
          <div className="mx-auto w-full max-w-2xl rounded-[20px] border border-border bg-surface shadow-[0_10px_34px_-14px_rgba(0,0,0,0.5)] transition-[box-shadow,border-color] focus-within:border-accent/40 focus-within:shadow-[0_16px_44px_-14px_rgba(0,0,0,0.6)]">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && prefs.enterToSend) { e.preventDefault(); submit(); }
                else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
              }}
              rows={1}
              placeholder={pairedName ? `Message your bee…` : `Send your invite code to link…`}
              className={cn("block max-h-40 w-full resize-none bg-transparent px-4 pt-3.5 text-fg outline-none placeholder:text-faint", TEXT_SIZE_CLASS[prefs.textSize])}
            />
            <div className="flex items-center justify-end gap-1.5 px-2.5 pb-2.5">
              <button onClick={startVoice} aria-label="Start voice conversation" title="Talk to your bee"
                className="grid size-8 place-items-center rounded-full text-muted transition hover:bg-fg/10 hover:text-fg">
                <AudioLines size={16} />
              </button>
              <button onClick={toggleMic} aria-label={listening ? "Stop dictation" : "Dictate a message"} title="Dictate"
                className={cn("grid size-8 place-items-center rounded-full text-muted transition hover:bg-fg/10 hover:text-fg", listening && "bg-ember/15 text-ember")}>
                <Mic size={16} />
              </button>
              <button onClick={submit} disabled={!input.trim()} aria-label="Send message"
                className="grid size-8 place-items-center rounded-full bg-honey text-bg transition enabled:hover:brightness-105 disabled:opacity-30">
                <ArrowUp size={16} />
              </button>
            </div>
          </div>
        </div>

        <VoiceMode
          open={voice.active}
          name={pairedName ?? beeName}
          phase={voice.phase}
          transcript={voice.transcript}
          muted={voice.muted}
          getLevels={voice.getLevels}
          onToggleMute={voice.toggleMute}
          onEnd={voice.stop}
        />
      </main>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        prefs={prefs}
        set={setPref}
        onClearConversation={chat.clear}
        onUnlink={unlink}
      />
    </div>
  );
}
