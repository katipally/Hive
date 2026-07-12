import { useEffect, type RefObject } from "react";

// Minimal modal a11y: while active, trap Tab inside the dialog, close on Escape,
// move focus in on open and restore it on close. Enough for our handful of
// modals without pulling in a focus-trap dependency.
const SEL = 'a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onClose?: () => void) {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>(SEL) ?? []).filter((n) => n.offsetParent !== null);
    // Prefer the first text field so a modal with an input lands focus there (not the
    // close button) — otherwise Enter would target the ✕ instead of submitting.
    const fields = focusables().filter((n) => /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
    (fields[0] ?? focusables()[0] ?? el)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose?.(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [active, ref, onClose]);
}
