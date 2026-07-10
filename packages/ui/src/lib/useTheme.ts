import { useSyncExternalStore } from "react";

// Tiny theme store — no next-themes (that's Next-flavored) and no zustand for
// what is a few lines. Dark is the hero, so it's the default. Toggles a
// `.light` class on <html>; :root holds dark, `:root.light` holds warm-paper.
export type Theme = "dark" | "light" | "system";
const KEY = "hive_theme";

const canDOM = typeof document !== "undefined";
const media = canDOM ? window.matchMedia("(prefers-color-scheme: light)") : null;

let theme: Theme = ((canDOM && (localStorage.getItem(KEY) as Theme)) || "dark");
const listeners = new Set<() => void>();

function resolved(): "dark" | "light" {
  if (theme === "system") return media?.matches ? "light" : "dark";
  return theme;
}

function apply() {
  if (canDOM) document.documentElement.classList.toggle("light", resolved() === "light");
}

function emit() {
  apply();
  listeners.forEach((l) => l());
}

if (media) media.addEventListener("change", () => { if (theme === "system") emit(); });
apply();

export function setTheme(t: Theme) {
  theme = t;
  if (canDOM) localStorage.setItem(KEY, t);
  emit();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => theme,
    () => theme,
  );
}

export function useResolvedTheme(): "dark" | "light" {
  useTheme();
  return resolved();
}
