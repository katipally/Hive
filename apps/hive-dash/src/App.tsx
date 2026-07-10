import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Share2, Zap, ShieldCheck, Users, SlidersHorizontal } from "lucide-react";
import { HexMark } from "./components/Logo.js";
import { cn } from "./lib/cn.js";
import { fadeUp } from "./lib/motion.js";
import { useDashSocket } from "./useDashSocket.js";
import { SetupBanner } from "./components/SetupBanner.js";
import { GraphPage } from "./pages/GraphPage.js";
import { MembersPage } from "./pages/MembersPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { DisclosuresPage } from "./pages/DisclosuresPage.js";
import { ProactivePage } from "./pages/ProactivePage.js";

const TABS = [
  { id: "graph", label: "Knowledge graph", Icon: Share2 },
  { id: "proactive", label: "Proactive", Icon: Zap },
  { id: "disclosures", label: "Disclosures", Icon: ShieldCheck },
  { id: "members", label: "Members", Icon: Users },
  { id: "settings", label: "Settings", Icon: SlidersHorizontal },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App() {
  const [tab, setTab] = useState<TabId>("graph");
  const [online, setOnline] = useState(false);
  useDashSocket(() => {}, setOnline);

  return (
    <div className="relative z-10 flex h-full">
      <nav className="flex w-[218px] shrink-0 flex-col gap-1 border-r border-border bg-surface/60 px-3 py-4 backdrop-blur">
        <div className="flex items-center gap-2.5 px-2 pb-5">
          <HexMark />
          <div className="text-[17px] font-semibold tracking-tight">Hive</div>
        </div>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition",
              tab === id ? "bg-honey-soft text-honey" : "text-muted hover:bg-fg/[0.05] hover:text-fg",
            )}
          >
            <Icon size={16} className={cn(tab === id ? "text-honey" : "text-faint group-hover:text-fg")} />
            {label}
          </button>
        ))}
        <div className="mt-auto flex items-center gap-2 px-3 pt-4 text-[11px] text-muted">
          <span
            className={cn(
              "size-2 rounded-full transition-colors",
              online ? "bg-share shadow-[0_0_8px_var(--color-share)]" : "bg-faint",
            )}
          />
          {online ? "Hive connected" : "reconnecting…"}
        </div>
      </nav>

      <main className="relative flex-1 overflow-hidden">
        <SetupBanner goTo={setTab} />
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            exit="exit"
            className="h-full"
          >
            {tab === "graph" && <GraphPage />}
            {tab === "proactive" && <ProactivePage />}
            {tab === "disclosures" && <DisclosuresPage />}
            {tab === "members" && <MembersPage />}
            {tab === "settings" && <SettingsPage />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
