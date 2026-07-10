import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "../lib/cn.js";
import { spring, quick } from "../lib/motion.js";

type Tone = "info" | "success" | "error";
type Toast = { id: number; message: string; tone: Tone };

const ICON = { info: Info, success: CheckCircle2, error: AlertCircle };
const ACCENT: Record<Tone, string> = {
  info: "text-muted",
  success: "text-share",
  error: "text-withhold",
};

const ToastCtx = createContext<(message: string, tone?: Tone) => void>(() => {});

// One provider at the app root; `useToast()` gives a `toast(msg, tone)` fn.
// This is what replaces the silent `.catch(() => {})` blocks across the apps.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const toast = useCallback((message: string, tone: Tone = "info") => {
    const id = next.current++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = ICON[t.tone];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1, transition: spring }}
                exit={{ opacity: 0, x: 16, transition: quick }}
                role="status"
                aria-live="polite"
                className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border bg-elevated px-3.5 py-3 shadow-[var(--shadow-pop)]"
              >
                <Icon size={16} className={cn("mt-0.5 shrink-0", ACCENT[t.tone])} />
                <span className="text-[13px] leading-snug text-fg">{t.message}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
