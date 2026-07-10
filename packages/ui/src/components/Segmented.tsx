import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  hint?: string;
  dot?: "share" | "faint" | "withhold" | null;
}

// Segmented control — the house style for choosing 1-of-few (providers, effort,
// proactivity, text size). Replaces dropdowns wherever the option count is small.
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegOption<T>[];
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("inline-flex flex-wrap gap-0.5 rounded-lg border border-border bg-surface p-1", className)} role="group">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            title={o.hint}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md font-medium transition",
              size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[12.5px]",
              active ? "bg-fg text-bg shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            {o.dot && (
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  o.dot === "share" ? "bg-share" : o.dot === "withhold" ? "bg-withhold" : "bg-faint",
                )}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
