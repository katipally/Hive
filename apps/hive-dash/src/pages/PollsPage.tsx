import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MessagesSquare, Plus, X, Check, Clock } from "lucide-react";
import { api, type PollRow, type MemberRow } from "../api.js";
import { useDashSocket } from "../useDashSocket.js";
import { PageHeader, Pill, Panel, Button, EmptyState, Input, Avatar } from "../components/ui.js";
import { stagger } from "../lib/motion.js";
import { cn } from "../lib/cn.js";

const STATUS_TONE: Record<PollRow["status"], "accent" | "partial" | "share" | "muted"> = {
  collecting: "accent",
  synthesizing: "partial",
  done: "share",
  cancelled: "muted",
};

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function PollsPage() {
  const [polls, setPolls] = useState<PollRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [topic, setTopic] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api<PollRow[]>("/api/polls").then(setPolls).catch(() => {});
  useEffect(() => {
    load();
    api<MemberRow[]>("/api/members")
      .then((ms) => setNames(Object.fromEntries(ms.map((m) => [m.id, m.name]))))
      .catch(() => {});
  }, []);

  useDashSocket((e) => {
    if (e.type === "poll.updated") {
      const poll = e.poll as PollRow;
      setPolls((cur) => {
        const i = cur.findIndex((p) => p.id === poll.id);
        if (i === -1) return [poll, ...cur];
        const next = cur.slice();
        next[i] = poll;
        return next;
      });
    }
  });

  async function startPoll() {
    if (!question.trim()) return;
    setBusy(true);
    try {
      await api("/api/polls", { method: "POST", body: JSON.stringify({ topic: topic.trim(), question: question.trim() }) });
      setTopic("");
      setQuestion("");
      setCreating(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const act = async (id: string, action: "cancel" | "synthesize") => {
    await api(`/api/polls/${id}/${action}`, { method: "POST" }).catch(() => {});
    await load();
  };

  return (
    <Panel width="prose">
      <PageHeader
        title="Polls"
        subtitle="The hive quietly asks the group, then synthesizes what people really think."
        actions={
          <Button variant="primary" onClick={() => setCreating((v) => !v)}>
            <Plus size={14} /> New poll
          </Button>
        }
      />

      <AnimatePresence initial={false}>
        {creating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-5 overflow-hidden"
          >
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex flex-col gap-2.5">
                <Input placeholder="Topic (e.g. birthday ideas)" value={topic} onChange={(e) => setTopic(e.target.value)} />
                <Input
                  placeholder="What do you want to learn from the group?"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") startPoll(); }}
                />
                <div className="flex items-center gap-2">
                  <Button variant="primary" onClick={startPoll} disabled={busy || !question.trim()}>
                    {busy ? "asking around…" : "Ask the group"}
                  </Button>
                  <Button variant="subtle" onClick={() => setCreating(false)}>Cancel</Button>
                  <span className="ml-auto text-[11px] text-faint">Friends are asked anonymously.</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {polls.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare size={22} />}
          title="No polls yet"
          hint="When a member asks their bee to check with friends — or the hive spots a group question — it shows up here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {polls.map((p, i) => {
            const asked = p.asks.filter((a) => a.deliveredAt).length;
            const answered = p.asks.filter((a) => a.answeredAt).length;
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={stagger(i)}>
                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-semibold text-fg">{p.topic}</span>
                        <Pill tone={STATUS_TONE[p.status]}>{p.status}</Pill>
                        <span className="flex items-center gap-1 text-[11px] text-faint">
                          <Clock size={11} /> {ago(p.createdAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[13px] text-muted">{p.question}</div>
                      <div className="mt-1 text-[11px] text-faint">
                        {p.initiatorMemberId ? `asked by ${names[p.initiatorMemberId] ?? "a member"}` : "hive-initiated"} · {answered}/{asked} answered
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {(p.status === "collecting" || p.status === "synthesizing") && (
                        <>
                          {answered > 0 && (
                            <Button variant="ghost" onClick={() => act(p.id, "synthesize")} title="Synthesize now">
                              <Check size={13} /> Synthesize
                            </Button>
                          )}
                          <Button variant="subtle" onClick={() => act(p.id, "cancel")} title="Cancel poll">
                            <X size={14} />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {p.synthesis && (
                    <div className="mt-3 rounded-xl bg-share/10 px-3.5 py-2.5 text-[14px] leading-relaxed text-fg">
                      {p.synthesis}
                    </div>
                  )}

                  {p.asks.length > 0 && (
                    <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
                      {p.asks.map((a) => (
                        <div key={a.id} className="flex items-start gap-2.5 text-[12px]">
                          <Avatar name={names[a.memberId] ?? "?"} size={20} className="text-[9px]" />
                          <span className="w-20 shrink-0 truncate text-muted">{names[a.memberId] ?? "friend"}</span>
                          {a.answer ? (
                            <span className="flex-1 text-fg">{a.answer}</span>
                          ) : (
                            <span className="flex-1 italic text-faint">{a.deliveredAt ? "waiting for reply…" : "not delivered"}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
