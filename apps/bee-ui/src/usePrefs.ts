import { useCallback, useState } from "react";

// Local, self-contained bee-ui preferences (no backend). Persisted per browser.
export interface Prefs {
  enterToSend: boolean;
  textSize: "sm" | "base" | "lg";
}
const DEFAULT: Prefs = { enterToSend: true, textSize: "base" };
const KEY = "bee_prefs";

function load(): Prefs {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    return DEFAULT;
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(load);
  const set = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => {
      const next = { ...p, [k]: v };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, []);
  return { prefs, set };
}

export const TEXT_SIZE_CLASS: Record<Prefs["textSize"], string> = {
  sm: "text-[13px]",
  base: "text-[14px]",
  lg: "text-[16px]",
};
