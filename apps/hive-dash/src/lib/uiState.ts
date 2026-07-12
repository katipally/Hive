import { useCallback, useState } from "react";

// Tiny localStorage-backed state so rail widths / collapse flags persist across reloads
// (no need to pull in a store library for a couple of numbers and booleans).
export function usePersistentNumber(key: string, initial: number) {
  const [v, setV] = useState<number>(() => {
    const s = localStorage.getItem(key);
    const n = s == null ? NaN : Number(s);
    return Number.isFinite(n) ? n : initial;
  });
  const set = useCallback((n: number) => { setV(n); localStorage.setItem(key, String(n)); }, [key]);
  return [v, set] as const;
}

export function usePersistentBool(key: string, initial: boolean) {
  const [v, setV] = useState<boolean>(() => {
    const s = localStorage.getItem(key);
    return s == null ? initial : s === "1";
  });
  const set = useCallback((b: boolean) => { setV(b); localStorage.setItem(key, b ? "1" : "0"); }, [key]);
  const toggle = useCallback(() => setV((p) => { const n = !p; localStorage.setItem(key, n ? "1" : "0"); return n; }), [key]);
  return [v, set, toggle] as const;
}
