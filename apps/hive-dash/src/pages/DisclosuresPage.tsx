import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ShieldCheck, ArrowRight, Check, Ban } from "lucide-react";
import { api } from "../api.js";
import { useDashSocket } from "../useDashSocket.js";
import { PageHeader, Pill, EmptyState } from "../components/ui.js";
import { stagger } from "../lib/motion.js";
import { cn } from "../lib/cn.js";

interface Disc {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  context: string;
  decision: "share" | "partial" | "withhold";
  disclosed: string | null;
  withheld: string | null;
  reasoning: string;
  createdAt: number;
}
interface MemberLite {
  id: string;
  name: string;
}

export function DisclosuresPage() {
  const [rows, setRows] = useState<Disc[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = () => api<Disc[]>("/api/disclosures").then(setRows).catch(() => {});
  useEffect(() => {
    load();
    api<MemberLite[]>("/api/members").then((m) => setNames(Object.fromEntries(m.map((x) => [x.id, x.name]))));
  }, []);
  useDashSocket((e) => e.type === "disclosure.created" && load());

  const nm = (id: string) => names[id] ?? id.slice(0, 6);
  const counts = {
    share: rows.filter((r) => r.decision === "share").length,
    partial: rows.filter((r) => r.decision === "partial").length,
    withhold: rows.filter((r) => r.decision === "withhold").length,
  };

  return (
    <div className="h-full overflow-y-auto rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] px-8 py-6">
      <PageHeader
        title="Disclosure audit"
        subtitle="Every time knowledge crossed between members — and what the hive chose to hold back."
        actions={
          <div className="flex items-center gap-1.5">
            <Pill tone="share">{counts.share} shared</Pill>
            <Pill tone="partial">{counts.partial} partial</Pill>
            <Pill tone="withhold">{counts.withhold} withheld</Pill>
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={22} />}
          title="No disclosures yet"
          hint="When one member's bee could draw on another's knowledge, the decision and reasoning appear here."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((d, i) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={stagger(i)}
              className={cn(
                "rounded-2xl border bg-card p-4",
                d.decision === "share" && "border-share/25",
                d.decision === "partial" && "border-partial/25",
                d.decision === "withhold" && "border-withhold/25",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[13px] font-medium text-fg">
                  {nm(d.fromMemberId)}
                  <ArrowRight size={14} className="text-faint" />
                  {nm(d.toMemberId)}
                  <span className="text-[11px] font-normal text-faint">· {d.context}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={d.decision}>{d.decision}</Pill>
                  <span className="text-[11px] text-faint">{new Date(d.createdAt).toLocaleString()}</span>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {d.disclosed && (
                  <div className="flex items-start gap-2 rounded-lg bg-share/[0.08] px-3 py-2 text-[13px]">
                    <Check size={14} className="mt-0.5 shrink-0 text-share" />
                    <span className="text-fg/90">{d.disclosed}</span>
                  </div>
                )}
                {d.withheld && (
                  <div className="flex items-start gap-2 rounded-lg bg-withhold/[0.08] px-3 py-2 text-[13px]">
                    <Ban size={14} className="mt-0.5 shrink-0 text-withhold" />
                    <span className="text-muted">{d.withheld}</span>
                  </div>
                )}
              </div>

              <p className="mt-2.5 text-[12.5px] italic leading-relaxed text-muted">“{d.reasoning}”</p>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
