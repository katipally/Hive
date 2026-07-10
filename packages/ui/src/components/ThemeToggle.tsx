import { AnimatePresence, motion } from "motion/react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "../lib/cn.js";
import { quick } from "../lib/motion.js";
import { useTheme, setTheme, type Theme } from "../lib/useTheme.js";

const ORDER: Theme[] = ["dark", "light", "system"];
const ICON = { dark: Moon, light: Sun, system: Monitor };
const LABEL = { dark: "Dark", light: "Light", system: "System" };

// Single icon-cycle button: Dark → Light → System, glyph morphing on change.
export function ThemeToggle({ className }: { className?: string }) {
  const current = useTheme();
  const Icon = ICON[current];
  const cycle = () => setTheme(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!);

  return (
    <button
      onClick={cycle}
      aria-label={`Theme: ${LABEL[current]}. Click to change.`}
      title={`Theme: ${LABEL[current]}`}
      className={cn(
        "relative grid size-8 place-items-center overflow-hidden rounded-lg text-muted transition hover:bg-fg/[0.06] hover:text-fg",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={current}
          initial={{ y: 9, opacity: 0, rotate: -35 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: -9, opacity: 0, rotate: 35 }}
          transition={quick}
          className="grid place-items-center"
        >
          <Icon className="size-4" />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
