import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Circle, KeyRound, Cpu, UserPlus, Link2, X } from "lucide-react";
import { api } from "../api.js";

interface Status {
  anyKey: boolean;
  rolesConfigured: boolean;
  memberCount: number;
  linkedCount: number;
}

// Guided first-run checklist. Disappears once every step is done (or dismissed).
export function SetupBanner({ goTo }: { goTo: (tab: "settings" | "members") => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = () => api<Status>("/api/status").then(setStatus).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  if (!status || dismissed) return null;
  const steps = [
    { done: status.anyKey, label: "Add a provider API key", Icon: KeyRound, tab: "settings" as const },
    { done: status.rolesConfigured, label: "Assign models to roles", Icon: Cpu, tab: "settings" as const },
    { done: status.memberCount > 0, label: "Add a member", Icon: UserPlus, tab: "members" as const },
    { done: status.linkedCount > 0, label: "Pair a bee with an invite code", Icon: Link2, tab: "members" as const },
  ];
  if (steps.every((s) => s.done)) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="absolute inset-x-4 top-4 z-30 rounded-2xl border border-honey/25 bg-popover/95 p-4 shadow-2xl backdrop-blur-xl"
      >
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[14px] font-semibold text-fg">Finish setting up your hive</span>
          <button onClick={() => setDismissed(true)} className="text-faint hover:text-fg">
            <X size={15} />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {steps.map((s) => (
            <button
              key={s.label}
              onClick={() => !s.done && goTo(s.tab)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] transition ${
                s.done ? "border-share/30 text-share" : "border-border text-fg hover:border-honey/40"
              }`}
            >
              {s.done ? <Check size={15} className="text-share" /> : <Circle size={15} className="text-faint" />}
              <s.Icon size={14} className={s.done ? "text-share" : "text-honey"} />
              {s.label}
            </button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
