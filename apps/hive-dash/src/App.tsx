import { AnimatePresence, motion } from "motion/react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Share2, Zap, ShieldCheck, Users, SlidersHorizontal } from "lucide-react";
import { HexMark } from "./components/Logo.js";
import { ThemeToggle } from "@hive/ui";
import { cn } from "./lib/cn.js";
import { fadeUp } from "./lib/motion.js";
import { useDashSocket } from "./useDashSocket.js";
import { useState } from "react";
import { GraphPage } from "./pages/GraphPage.js";
import { MembersPage } from "./pages/MembersPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { DisclosuresPage } from "./pages/DisclosuresPage.js";
import { ProactivePage } from "./pages/ProactivePage.js";

const TABS = [
  { path: "graph", label: "Knowledge graph", Icon: Share2 },
  { path: "proactive", label: "Proactive", Icon: Zap },
  { path: "disclosures", label: "Disclosures", Icon: ShieldCheck },
  { path: "members", label: "Members", Icon: Users },
  { path: "settings", label: "Settings", Icon: SlidersHorizontal },
] as const;

export function App() {
  const [online, setOnline] = useState(false);
  useDashSocket(() => {}, setOnline);
  const location = useLocation();

  return (
    <div className="relative z-10 flex h-full gap-2 bg-background p-2">
      <nav className="flex w-[206px] shrink-0 flex-col gap-1 px-2 py-2">
        <div className="flex items-center gap-2.5 px-2 pb-4">
          <HexMark />
          <div className="text-[17px] font-semibold tracking-tight">Hive</div>
          <ThemeToggle className="ml-auto" />
        </div>
        {TABS.map(({ path, label, Icon }) => (
          <NavLink
            key={path}
            to={`/${path}`}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition",
                isActive ? "bg-honey-soft text-honey" : "text-muted hover:bg-fg/[0.05] hover:text-fg",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={16} className={cn(isActive ? "text-honey" : "text-faint group-hover:text-fg")} />
                {label}
              </>
            )}
          </NavLink>
        ))}
        <div className="mt-auto flex items-center gap-2 px-3 pt-4 text-[11px] text-muted" aria-live="polite">
          <span
            className={cn(
              "size-2 rounded-full transition-colors",
              online ? "bg-share shadow-[0_0_8px_var(--color-share)]" : "bg-faint",
            )}
          />
          {online ? "Hive connected" : "reconnecting…"}
        </div>
      </nav>

      <main className="relative min-w-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            exit="exit"
            className="h-full w-full"
          >
            <Routes location={location}>
              <Route index element={<Navigate to="/graph" replace />} />
              <Route path="graph" element={<GraphPage />} />
              <Route path="proactive" element={<ProactivePage />} />
              <Route path="disclosures" element={<DisclosuresPage />} />
              <Route path="members" element={<MembersPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/graph" replace />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
