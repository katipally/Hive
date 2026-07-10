import { useState, type ReactNode } from "react";
import { Dialog, ConfirmDialog, ThemeToggle, Segmented, cn } from "@hive/ui";
import { Trash2, LogOut } from "lucide-react";
import type { Prefs } from "./usePrefs.js";

export function Settings({
  open, onClose, prefs, set, onClearConversation, onUnlink,
}: {
  open: boolean;
  onClose: () => void;
  prefs: Prefs;
  set: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  onClearConversation: () => void;
  onUnlink: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  return (
    <>
      <Dialog open={open} onClose={onClose} title="Settings" description="Personalize your bee." className="max-w-sm">
        <div className="flex flex-col">
          <Row label="Theme">
            <ThemeToggle />
          </Row>
          <Row label="Text size">
            <Segmented
              value={prefs.textSize}
              options={[{ value: "sm", label: "S" }, { value: "base", label: "M" }, { value: "lg", label: "L" }]}
              onChange={(v) => set("textSize", v)}
              size="sm"
            />
          </Row>
          <Row label="Enter to send" hint="Off · Enter makes a newline">
            <Toggle on={prefs.enterToSend} onChange={(v) => set("enterToSend", v)} />
          </Row>

          <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
            <button
              onClick={() => setConfirmClear(true)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition hover:bg-fg/[0.05] hover:text-fg"
            >
              <Trash2 size={15} /> Clear this conversation
            </button>
            <button
              onClick={() => setConfirmUnlink(true)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-withhold transition hover:bg-withhold/10"
            >
              <LogOut size={15} /> Unlink this bee
            </button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => { onClearConversation(); onClose(); }}
        title="Clear this conversation?"
        description="Your local chat history with this bee is removed. The hive still keeps what it learned about you."
        confirmLabel="Clear"
      />
      <ConfirmDialog
        open={confirmUnlink}
        onClose={() => setConfirmUnlink(false)}
        onConfirm={() => { onUnlink(); onClose(); }}
        title="Unlink this bee?"
        description="You'll need to send an invite code again to reconnect this device."
        confirmLabel="Unlink"
      />
    </>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div>
        <div className="text-[13px] text-fg">{label}</div>
        {hint && <div className="text-[11px] text-faint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn("relative h-6 w-10 rounded-full transition", on ? "bg-accent" : "bg-fg/15")}
    >
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}
