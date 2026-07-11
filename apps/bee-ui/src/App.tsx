import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Sparkles, Mic, AudioLines, Settings2, Plus, PanelLeftClose, PanelLeftOpen, Cable, Send, MessageSquare, Hash, MoreHorizontal, Trash2, Pencil, Link2 } from "lucide-react";
import { BeeMark } from "./Logo.js";
import { ThemeToggle, useToast, Thinking, StatusDot, Avatar, ConfirmDialog } from "@hive/ui";
import { cn } from "./lib/cn.js";
import { dropdown } from "./lib/motion.js";
import { useBeeChat, uidFor, DEMO } from "./useBeeChat.js";
import { useVoice } from "./useVoice.js";
import { VoiceMode } from "./VoiceMode.js";
import { Settings } from "./Settings.js";
import { Channels } from "./Channels.js";
import { usePrefs, TEXT_SIZE_CLASS } from "./usePrefs.js";
import { API_BASE } from "./config.js";

// A small click-out popover menu (profile actions, chat row actions). The
// trigger toggles it; items call `close()` themselves after acting.
function Menu({ trigger, children, align = "right", className }: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className={cn("relative", className)}>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="flex">
        {trigger}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            variants={dropdown}
            initial="hidden"
            animate="show"
            exit="exit"
            className={cn(
              "absolute z-30 mt-1 min-w-[9.5rem] rounded-xl border border-border bg-elevated p-1 shadow-[var(--shadow-pop)]",
              align === "right" ? "right-0" : "left-0",
            )}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger, disabled }: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition disabled:pointer-events-none disabled:opacity-40",
        danger ? "text-withhold hover:bg-withhold/10" : "text-muted hover:bg-fg/[0.06] hover:text-fg",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
}

interface BeeInfo {
  beeId: string;
  name: string;
}

// Shared channels the operator has set up — surfaced under the profile's Connections.
const CONN = [
  { id: "telegram", label: "Telegram", Icon: Send },
  { id: "imessage", label: "iMessage", Icon: MessageSquare },
  { id: "discord", label: "Discord", Icon: Hash },
] as const;

// A profile (bee) has multiple named conversation threads (chat history).
interface ChatSession { id: string; title: string }
const sessionsKey = (b: string) => `bee_sessions_${b}`;
const activeKey = (b: string) => `bee_session_sel_${b}`;
function loadSessions(beeId: string): ChatSession[] {
  try {
    const s = JSON.parse(localStorage.getItem(sessionsKey(beeId)) ?? "[]") as ChatSession[];
    return Array.isArray(s) && s.length ? s : [{ id: "main", title: "First chat" }];
  } catch {
    return [{ id: "main", title: "First chat" }];
  }
}
// Title a fresh thread from the opening message — a few words, like a chat app.
const titleFrom = (text: string) => text.trim().split(/\s+/).slice(0, 4).join(" ").slice(0, 32) || "New chat";

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
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [chInfo, setChInfo] = useState<Record<string, unknown>>({});
  useEffect(() => { fetch(`${API_BASE}/channel-info`).then((r) => r.json()).then(setChInfo).catch(() => {}); }, []);

  // Multiple conversation threads per profile (chat history).
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState("main");
  const [addingProfile, setAddingProfile] = useState(false);
  useEffect(() => {
    if (!beeId) return;
    const local = loadSessions(beeId);
    setSessions(local);
    const stored = localStorage.getItem(activeKey(beeId));
    setSessionId(stored && local.some((x) => x.id === stored) ? stored : local[0]!.id);
    // Merge in the bee's server-side threads (seeded/prior sessions this browser
    // hasn't created locally) so every conversation shows up, not just local ones.
    fetch(`${API_BASE}/sessions?bee=${beeId}`)
      .then((r) => r.json())
      .then((server: ChatSession[]) => {
        if (!Array.isArray(server) || !server.length) return;
        setSessions((cur) => {
          const extra = cur.filter((s) => s.id !== "main" && !server.some((v) => v.id === s.id));
          const merged = [...server, ...extra];
          localStorage.setItem(sessionsKey(beeId), JSON.stringify(merged));
          return merged;
        });
        if (!stored) { setSessionId(server[0]!.id); localStorage.setItem(activeKey(beeId), server[0]!.id); }
      })
      .catch(() => {});
  }, [beeId]);
  const saveSessions = (s: ChatSession[]) => { setSessions(s); if (beeId) localStorage.setItem(sessionsKey(beeId), JSON.stringify(s)); };
  const selectSession = (id: string) => { setSessionId(id); if (beeId) localStorage.setItem(activeKey(beeId), id); };
  function newChat() {
    const id = `s_${Math.random().toString(36).slice(2, 9)}`;
    saveSessions([{ id, title: "New chat" }, ...sessions]);
    selectSession(id);
  }

  // Rename a thread inline (Enter to save, Escape/blur to cancel).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  function startRename(s: ChatSession) { setRenamingId(s.id); setRenameText(s.title); }
  function commitRename() {
    const t = renameText.trim();
    if (renamingId && t) saveSessions(sessions.map((s) => (s.id === renamingId ? { ...s, title: t.slice(0, 60) } : s)));
    setRenamingId(null);
  }

  // Delete a thread: local cache + server transcript, always keeping ≥1 chat.
  function deleteChat(id: string) {
    if (beeId) {
      try { localStorage.removeItem(`bee_msgs_${beeId}_${id}`); } catch { /* noop */ }
      fetch(`${API_BASE}/history?bee=${beeId}&uid=${uidFor(beeId)}&session=${id}`, { method: "DELETE" }).catch(() => {});
    }
    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      const nid = `s_${Math.random().toString(36).slice(2, 9)}`;
      saveSessions([{ id: nid, title: "New chat" }]);
      selectSession(nid);
      return;
    }
    saveSessions(remaining);
    if (id === sessionId) selectSession(remaining[0]!.id);
  }

  // Remove the current profile (bee) entirely — backend + this device's data.
  const [confirmRemoveProfile, setConfirmRemoveProfile] = useState(false);
  async function removeProfile() {
    if (!beeId || bees.length <= 1) return;
    const removed = beeId;
    try {
      const r = await fetch(`${API_BASE}/bees/${removed}`, { method: "DELETE" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        toast(j.error ?? "Couldn't remove this profile", "error");
        return;
      }
      // wipe this profile's local data
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (
          k === sessionsKey(removed) ||
          k === activeKey(removed) ||
          k === `bee_uid_${removed}` ||
          k === memberKey(removed) ||
          k.startsWith(`bee_msgs_${removed}_`)
        ) localStorage.removeItem(k);
      }
      const b = await loadBees();
      setBeeId((cur) => (b.some((x) => x.beeId === cur) ? cur : b[0]?.beeId ?? ""));
      toast("Profile removed");
    } catch {
      toast("Couldn't remove this profile", "error");
    }
  }
  const [newBee, setNewBee] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("bee_sidebar") !== "0");
  const { prefs, set: setPref } = usePrefs();
  const logRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recogRef = useRef<any>(null);

  const chat = useBeeChat(beeId, sessionId, {
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
      const b = (await fetch(`${API_BASE}/bees`).then((r) => r.json())) as BeeInfo[];
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
    // Demo: the bee pre-links web-<name>, so discover who we are from the server
    // instead of waiting for a pairing handshake — /chat opens already "as Alice".
    if (DEMO) {
      fetch(`${API_BASE}/my-code?bee=${beeId}&uid=${uidFor(beeId)}`)
        .then((r) => r.json())
        .then((r: { name?: string }) => {
          if (!r?.name) return;
          localStorage.setItem(memberKey(beeId), r.name);
          setPairedName(r.name);
          setMemberNames((mm) => ({ ...mm, [beeId]: r.name as string }));
        })
        .catch(() => {});
    }
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
      const created = (await fetch(`${API_BASE}/bees`, {
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
    const text = input.trim();
    if (!text) return;
    // name a fresh thread from its opening message
    const cur = sessions.find((s) => s.id === sessionId);
    if (cur && (cur.title === "New chat" || cur.title === "First chat") && chat.msgs.length === 0) {
      saveSessions(sessions.map((s) => (s.id === sessionId ? { ...s, title: titleFrom(text) } : s)));
    }
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
  const activeTitle = sessions.find((s) => s.id === sessionId)?.title ?? "";

  return (
    <div className="relative z-10 flex h-dvh gap-2 bg-background p-2">
      {/* Conversation sidebar — one entry per bee, each its own history. */}
      {sidebarOpen ? (
        <aside className="flex w-60 shrink-0 flex-col px-1.5 py-1">
          <div className="flex items-center gap-2 px-2 py-2">
            <BeeMark size={20} />
            <span className="text-[15px] font-semibold tracking-tight">Bee</span>
            <button onClick={toggleSidebar} aria-label="Collapse sidebar" title="Collapse"
              className="ml-auto grid size-7 place-items-center rounded-lg text-faint transition hover:bg-fg/[0.06] hover:text-fg">
              <PanelLeftClose size={16} />
            </button>
          </div>

          {/* Profile — a dropdown; each profile is a person (a bee). */}
          <div className="px-2 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-faint">Profile</div>
          <div className="flex items-center gap-1 px-1">
            <div className="relative min-w-0 flex-1">
              <select
                value={beeId}
                onChange={(e) => setBeeId(e.target.value)}
                aria-label="Switch profile"
                className="w-full min-w-0 cursor-pointer appearance-none rounded-lg border border-border bg-surface py-1.5 pl-2.5 pr-7 text-[13px] text-fg outline-none transition-colors hover:border-border-heavy focus:border-accent/50"
              >
                {bees.map((b) => (
                  <option key={b.beeId} value={b.beeId}>{label(b)}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-faint">
                <MoreHorizontal size={14} className="rotate-90" />
              </span>
            </div>
            <button
              onClick={() => setAddingProfile((v) => !v)}
              title="New profile"
              aria-label="New profile"
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted transition hover:border-accent/40 hover:text-accent"
            >
              <Plus size={15} />
            </button>
            <Menu
              align="right"
              trigger={
                <span title="Profile options" aria-label="Profile options"
                  className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted transition hover:border-border-heavy hover:text-fg">
                  <MoreHorizontal size={15} />
                </span>
              }
            >
              {(close) => (
                <MenuItem
                  danger
                  disabled={bees.length <= 1}
                  icon={<Trash2 size={13} />}
                  onClick={() => { close(); setConfirmRemoveProfile(true); }}
                >
                  Remove profile
                </MenuItem>
              )}
            </Menu>
          </div>
          {addingProfile && (
            <input
              value={newBee}
              onChange={(e) => setNewBee(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { addBee(); setAddingProfile(false); } }}
              placeholder="Name the profile, then Enter…"
              autoFocus
              className="mt-1 w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[12px] text-fg outline-none placeholder:text-faint"
            />
          )}

          {/* Connections — the shared channels this profile can be reached on. Sits
              between Profile and Chats so the (flexible) chat list keeps the scroll region. */}
          <div className="px-2 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-faint">Connections</div>
          <div className="flex flex-col gap-0.5">
            {CONN.filter((c) => chInfo[c.id]).map((c) => (
              <button
                key={c.id}
                onClick={() => setChannelsOpen(true)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-muted transition hover:bg-fg/[0.05] hover:text-fg"
              >
                <c.Icon size={13} className="text-accent" />
                <span className="flex-1 truncate">{c.label}</span>
                <span className="text-[10px] text-faint">reach →</span>
              </button>
            ))}
            <button
              onClick={() => setChannelsOpen(true)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-muted transition hover:bg-fg/[0.05] hover:text-accent"
            >
              <Cable size={13} /> Reach your bee elsewhere
            </button>
          </div>

          {/* Chats — this profile's conversation threads, auto-titled. */}
          <div className="flex items-center justify-between px-2 pb-1 pt-3.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-faint">Chats</span>
            <button onClick={newChat} title="New chat" aria-label="New chat"
              className="grid size-5 place-items-center rounded text-faint transition hover:text-accent">
              <Plus size={14} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {sessions.map((s) => {
              const active = s.id === sessionId;
              if (renamingId === s.id) {
                return (
                  <input
                    key={s.id}
                    autoFocus
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                      else if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
                    }}
                    onBlur={commitRename}
                    className="rounded-lg border border-accent/50 bg-surface px-2.5 py-1.5 text-[13px] text-fg outline-none"
                  />
                );
              }
              return (
                <div
                  key={s.id}
                  className={cn(
                    "group/row relative flex items-center rounded-lg text-[13px] transition",
                    active ? "bg-accent-soft text-accent" : "text-muted hover:bg-fg/[0.05] hover:text-fg",
                  )}
                >
                  <button onClick={() => selectSession(s.id)} className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-left">
                    {s.title}
                  </button>
                  <Menu
                    align="right"
                    className="mr-1"
                    trigger={
                      <span
                        aria-label="Chat options"
                        className={cn(
                          "grid size-6 place-items-center rounded-md text-current opacity-0 transition hover:bg-fg/[0.08] group-hover/row:opacity-100",
                          active && "!opacity-100",
                        )}
                      >
                        <MoreHorizontal size={15} />
                      </span>
                    }
                  >
                    {(close) => (
                      <>
                        <MenuItem icon={<Pencil size={13} />} onClick={() => { close(); startRename(s); }}>Rename</MenuItem>
                        <MenuItem danger icon={<Trash2 size={13} />} onClick={() => { close(); deleteChat(s.id); }}>Delete</MenuItem>
                      </>
                    )}
                  </Menu>
                </div>
              );
            })}
          </div>

          <div className="mt-1 flex items-center gap-1 border-t border-border px-1 pt-1.5">
            <ThemeToggle />
            <button onClick={() => setSettingsOpen(true)}
              className="flex flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-muted transition hover:bg-fg/[0.06] hover:text-fg">
              <Settings2 size={14} /> Settings
            </button>
          </div>
        </aside>
      ) : (
        <div className="flex w-11 shrink-0 flex-col items-center gap-2 py-2">
          <button onClick={toggleSidebar} aria-label="Show profiles" title="Show profiles"
            className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-fg/[0.06] hover:text-fg">
            <PanelLeftOpen size={17} />
          </button>
          <BeeMark size={20} />
        </div>
      )}

      {/* Elevated chat panel. */}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <Avatar name={pairedName ?? beeName} size={32} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[14px] font-semibold tracking-tight text-fg">{pairedName ?? beeName}</span>
              {!pairedName && (
                <button
                  onClick={() => setChannelsOpen(true)}
                  title="Send your invite code to link this device"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-arc/30 bg-arc/10 px-2 py-0.5 text-[11px] font-medium text-arc transition hover:bg-arc/20"
                >
                  <Link2 size={11} /> Not linked
                </button>
              )}
            </div>
            <div className="truncate text-[11px] text-faint">{activeTitle || "New chat"}</div>
          </div>
          <span className={cn("flex shrink-0 items-center gap-1.5 text-[11px]", chat.connected ? "text-share" : "text-faint")} aria-live="polite">
            <StatusDot online={chat.connected} />
            {chat.connected ? "connected" : "offline"}
          </span>
        </header>

        <div ref={logRef} role="log" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl space-y-3 px-5 py-5">
            {chat.msgs.length === 0 && (
              <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
                <BeeMark size={34} />
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
                    <div className={cn("max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 leading-relaxed text-bg", TEXT_SIZE_CLASS[prefs.textSize])}>{m.text}</div>
                  )}
                  {m.role === "bee" && (
                    <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-border bg-elevated px-3.5 py-2 leading-relaxed text-fg", TEXT_SIZE_CLASS[prefs.textSize])}>{m.text}</div>
                  )}
                  {m.role === "notice" && (
                    <div className="rounded-full bg-fg/[0.05] px-3 py-1 text-[12px] italic text-muted">{m.text}</div>
                  )}
                  {m.role === "nudge" && (
                    <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-accent/30 bg-accent-soft px-3.5 py-2.5">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-accent">
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
                <div className="rounded-2xl rounded-bl-md border border-border bg-elevated px-3.5 py-2.5">
                  <Thinking />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-4 pb-4 pt-2">
          <div className="mx-auto w-full max-w-2xl rounded-[20px] border border-border bg-surface shadow-[var(--shadow-input)] transition-[box-shadow,border-color] focus-within:border-accent/40 focus-within:shadow-[var(--shadow-input-focus)]">
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
                className={cn("grid size-8 place-items-center rounded-full text-muted transition hover:bg-fg/10 hover:text-fg", listening && "bg-arc/15 text-arc")}>
                <Mic size={16} />
              </button>
              <button onClick={submit} disabled={!input.trim()} aria-label="Send message"
                className="grid size-8 place-items-center rounded-full bg-accent text-bg transition enabled:hover:brightness-105 disabled:opacity-30">
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

      <Channels open={channelsOpen} onClose={() => setChannelsOpen(false)} beeId={beeId} />

      <ConfirmDialog
        open={confirmRemoveProfile}
        onClose={() => setConfirmRemoveProfile(false)}
        onConfirm={removeProfile}
        title="Remove this profile?"
        description={`This permanently removes “${label(bees.find((b) => b.beeId === beeId) ?? { beeId, name: beeName } as BeeInfo)}” and deletes its chats on this device. This can't be undone.`}
        confirmLabel="Remove profile"
      />
    </div>
  );
}
