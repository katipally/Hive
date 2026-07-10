import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Zap, Check, X, Activity, Users, Sparkles, ThumbsUp, ThumbsDown } from "lucide-react";
import { api } from "../api.js";
import { useDashSocket } from "../useDashSocket.js";
import { PageHeader, Pill, Button, EmptyState } from "../components/ui.js";
import { stagger } from "../lib/motion.js";
import { cn } from "../lib/cn.js";

interface Nudge {
  id: string;
  memberId: string;
  kind: string;
  status: string;
  draft: string | null;
  reasoning: string;
  suppressReason: string | null;
  feedback: number | null;
  createdAt: number;
}
interface ActivityEntry {
  id: string;
  ts: number;
  type: string;
  memberId: string | null;
  payload: Record<string, unknown>;
}
interface MemberLite {
  id: string;
  name: string;
}

const STATUS_TONE: Record<string, "muted" | "honey" | "share" | "partial" | "withhold"> = {
  proposed: "honey",
  queued: "partial",
  sent: "share",
  suppressed: "muted",
  dismissed: "muted",
  failed: "withhold",
};

const ACTIVITY_COLOR: Record<string, string> = {
  extraction: "#8fb0ff",
  conclusion: "#c68bff",
  implication: "#f4b83c",
  disclosure: "#57c8bf",
  nudge: "#ff7a6b",
  heartbeat_pass: "#74d68a",
  error: "#e5615a",
};

export function ProactivePage() {
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [shared, setShared] = useState<{ entity: string; type: string; members: string[] }[]>([]);
  const [orchestrating, setOrchestrating] = useState(false);

  const loadNudges = () => api<Nudge[]>("/api/nudges").then(setNudges).catch(() => {});
  const loadActivity = () => api<ActivityEntry[]>("/api/activity?limit=60").then(setActivity).catch(() => {});
  const loadShared = () => api<{ sharedInterests: typeof shared }>("/api/social").then((r) => setShared(r.sharedInterests)).catch(() => {});
  useEffect(() => {
    loadNudges();
    loadActivity();
    loadShared();
    api<MemberLite[]>("/api/members").then((m) => setNames(Object.fromEntries(m.map((x) => [x.id, x.name]))));
  }, []);

  async function findConnections() {
    setOrchestrating(true);
    await api("/api/orchestrate", { method: "POST" }).catch(() => {});
    setOrchestrating(false);
    loadNudges();
  }
  useDashSocket((e) => {
    if (e.type === "nudge.updated") loadNudges();
    if (e.type === "activity.append") loadActivity();
  });

  const nm = (id: string | null) => (id ? names[id] ?? id.slice(0, 6) : "hive");
  async function act(id: string, action: "approve" | "dismiss") {
    await api(`/api/nudges/${id}/${action}`, { method: "POST" });
    loadNudges();
  }
  async function feedback(id: string, helpful: boolean) {
    await api(`/api/nudges/${id}/feedback`, { method: "POST", body: JSON.stringify({ helpful }) });
    loadNudges();
  }

  const active = nudges.filter((n) => n.status === "proposed" || n.status === "queued" || n.status === "sent");
  const suppressed = nudges.filter((n) => n.status === "suppressed" || n.status === "dismissed" || n.status === "failed");

  return (
    <div className="grid h-full grid-cols-[1fr_340px] overflow-hidden">
      <div className="overflow-y-auto px-8 py-6">
        <PageHeader
          title="Proactive"
          subtitle="What the hive is deciding to reach out about — and why."
          actions={
            <Button variant="primary" onClick={findConnections} disabled={orchestrating}>
              <Sparkles size={14} className={orchestrating ? "animate-pulse" : ""} /> {orchestrating ? "Thinking…" : "Find connections"}
            </Button>
          }
        />

        {shared.length > 0 && (
          <div className="mb-4 rounded-2xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-fg">
              <Users size={15} className="text-honey" /> Shared across the group
            </div>
            <div className="flex flex-wrap gap-2">
              {shared.map((s) => (
                <span key={s.entity} className="rounded-full border border-honey/20 bg-honey-soft/50 px-3 py-1 text-[12px]">
                  <span className="text-fg">{s.entity}</span>
                  <span className="text-faint"> · {s.members.join(", ")}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {active.length === 0 && suppressed.length === 0 ? (
          <EmptyState
            icon={<Zap size={22} />}
            title="Nothing queued"
            hint="When new knowledge lands, the hive judges whether it's worth reaching out to someone."
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            <AnimatePresence initial={false}>
              {active.map((n, i) => (
                <motion.div
                  key={n.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={stagger(i)}
                  className="rounded-2xl border border-honey/20 bg-card p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="text-muted">to</span>
                      <span className="font-semibold text-fg">{nm(n.memberId)}</span>
                      <Pill tone="muted">{n.kind}</Pill>
                    </div>
                    <Pill tone={STATUS_TONE[n.status] ?? "muted"}>{n.status}</Pill>
                  </div>
                  {n.draft && (
                    <div className="mt-2.5 rounded-xl bg-honey-soft/60 px-3.5 py-2.5 text-[14px] leading-relaxed text-fg">
                      {n.draft}
                    </div>
                  )}
                  <p className="mt-2 text-[12px] italic text-muted">{n.reasoning}</p>
                  {n.status === "proposed" && (
                    <div className="mt-3 flex gap-2">
                      <Button variant="primary" onClick={() => act(n.id, "approve")}>
                        <Check size={14} /> Approve & send
                      </Button>
                      <Button variant="ghost" onClick={() => act(n.id, "dismiss")}>
                        <X size={14} /> Dismiss
                      </Button>
                    </div>
                  )}
                  {n.status === "sent" && (
                    <div className="mt-2.5 flex items-center gap-2 text-[11px] text-faint">
                      was this a good nudge?
                      <button
                        onClick={() => feedback(n.id, true)}
                        className={cn("rounded-md p-1 transition hover:text-share", n.feedback === 1 && "text-share")}
                      >
                        <ThumbsUp size={13} />
                      </button>
                      <button
                        onClick={() => feedback(n.id, false)}
                        className={cn("rounded-md p-1 transition hover:text-withhold", n.feedback === -1 && "text-withhold")}
                      >
                        <ThumbsDown size={13} />
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {suppressed.length > 0 && (
              <>
                <div className="mt-3 text-[11px] font-medium uppercase tracking-wider text-faint">Held back</div>
                {suppressed.map((n) => (
                  <div key={n.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-2.5 text-[13px]">
                    <span className="text-muted">to {nm(n.memberId)}</span>
                    <span className="truncate text-faint">{n.reasoning}</span>
                    <Pill tone="muted" className="ml-auto shrink-0">
                      {n.suppressReason ?? n.status}
                    </Pill>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* activity rail */}
      <div className="flex flex-col overflow-hidden border-l border-border bg-surface/40">
        <div className="flex items-center gap-2 px-5 py-4 text-[13px] font-medium text-fg">
          <Activity size={15} className="text-honey" /> Activity
        </div>
        <div className="flex-1 space-y-1.5 overflow-y-auto px-4 pb-6">
          {activity.length === 0 && <p className="px-1 text-[12px] text-faint">Quiet for now.</p>}
          {activity.map((a) => (
            <div key={a.id} className="rounded-lg border border-border bg-card/70 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: ACTIVITY_COLOR[a.type] ?? "#a89e88" }} />
                <span className="font-mono text-[11px] text-fg">{a.type}</span>
                <span className="ml-auto text-[10px] text-faint">{new Date(a.ts).toLocaleTimeString()}</span>
              </div>
              <div className={cn("mt-1 pl-4 text-[12px]", a.type === "error" ? "text-withhold" : "text-muted")}>
                {nm(a.memberId)} · {summarize(a.payload)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function summarize(p: Record<string, unknown>): string {
  if (p["summary"]) return String(p["summary"]);
  if (p["error"]) return `error: ${p["error"]}`;
  const keys = Object.keys(p);
  return keys.length ? keys.map((k) => `${k}=${JSON.stringify(p[k])}`).join(" ").slice(0, 100) : "";
}
