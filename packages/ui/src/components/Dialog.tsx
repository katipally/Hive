import { useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "../lib/cn.js";
import { overlay, modal } from "../lib/motion.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";
import { Button } from "./ui.js";

// Real modal: dimmed backdrop, focus trap, Escape/click-out to close.
// Replaces the ad-hoc absolutely-positioned overlays scattered in the apps.
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open, onClose);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          variants={overlay}
          initial="hidden"
          animate="show"
          exit="exit"
          className="fixed inset-0 z-50 grid place-items-center p-4"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={ref}
            variants={modal}
            role="dialog"
            aria-modal="true"
            className={cn(
              "relative z-10 w-full max-w-md rounded-2xl border border-border bg-elevated p-5 shadow-[var(--shadow-pop)]",
              className,
            )}
          >
            {(title || description) && (
              <div className="mb-4 pr-8">
                {title && <h2 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h2>}
                {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
              </div>
            )}
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="absolute right-3.5 top-3.5 grid size-7 place-items-center rounded-lg text-faint transition hover:bg-fg/[0.06] hover:text-fg"
            >
              <X size={15} />
            </button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Destructive-action confirmation — used for graph "forget" / "remove", etc.,
// which previously deleted with no prompt.
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  danger = true,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button
          variant={danger ? "danger" : "primary"}
          onClick={() => { onConfirm(); onClose(); }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
