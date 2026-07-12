import { useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "../lib/cn.js";

export function Button({
  variant = "ghost",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "subtle" | "danger" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition disabled:opacity-30 disabled:pointer-events-none",
        variant === "primary" && "bg-accent text-white hover:brightness-110 shadow-[var(--shadow-accent)]",
        variant === "ghost" && "border border-border bg-card text-fg hover:border-border-heavy hover:bg-fg/[0.04]",
        variant === "subtle" && "text-muted hover:bg-fg/[0.06] hover:text-fg",
        variant === "danger" && "border border-withhold/40 bg-withhold/10 text-withhold hover:bg-withhold/20",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

// The elevated page shell every console page sits in. Owns the wrapper that used to
// be copy-pasted into each page, plus a readable content column so text/forms don't
// stretch edge-to-edge on wide monitors. `bleed` = no padding/column (for the graph
// canvas, which manages its own layout).
export function Panel({
  width = "wide",
  surface = "elevated",
  className,
  style,
  children,
}: {
  width?: "prose" | "wide" | "bleed";
  // "elevated" = floating card (bg-card + shadow); "recessed" = sits behind the main
  // canvas on the app background (bg-background, no shadow) — like the left sidebar.
  surface?: "elevated" | "recessed";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const bleed = width === "bleed";
  const recessed = surface === "recessed";
  return (
    <div
      style={style}
      className={cn(
        "relative h-full rounded-2xl border border-border",
        recessed ? "bg-background" : "bg-card shadow-[var(--shadow-card)]",
        bleed ? "overflow-hidden" : "overflow-y-auto px-6 py-6 sm:px-8",
        className,
      )}
    >
      {bleed ? (
        children
      ) : (
        <div className={cn("mx-auto w-full", width === "prose" ? "max-w-3xl" : "max-w-5xl")}>{children}</div>
      )}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent/50 transition-colors",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-fg outline-none focus:border-accent/50 transition-colors cursor-pointer",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</span>
      {children}
    </label>
  );
}

export function Pill({
  tone = "muted",
  children,
  className,
}: {
  tone?: "muted" | "accent" | "share" | "partial" | "withhold" | "live";
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    muted: "bg-fg/[0.06] text-muted",
    accent: "bg-accent-soft text-accent",
    share: "bg-share/15 text-share",
    partial: "bg-partial/15 text-partial",
    withhold: "bg-withhold/15 text-withhold",
    live: "bg-share/15 text-share",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("font-mono text-[12px] rounded-md bg-fg/[0.05] px-1.5 py-0.5 text-fg/90", className)}>
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="grid size-14 place-items-center rounded-2xl border border-border bg-surface text-faint">{icon}</div>
      <div className="text-[15px] font-medium text-fg">{title}</div>
      {hint && <div className="max-w-xs text-[13px] text-muted">{hint}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 pb-5">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-14 rounded-xl" />
      ))}
    </div>
  );
}

// The single "the AI is working" indicator, used everywhere (chat, voice, dash).
// State-labeled: pass `label` for a specific op ("asking 3 of your friends…");
// with no label it gently cycles so a spinner never reads as "stalled".
const THINKING_CYCLE = ["thinking…", "connecting the dots…", "gathering my thoughts…"];
export function Thinking({ label, className }: { label?: string; className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (label) return;
    const t = setInterval(() => setI((v) => (v + 1) % THINKING_CYCLE.length), 2400);
    return () => clearInterval(t);
  }, [label]);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", className)}
      role="status"
      aria-live="polite"
    >
      <Sparkles size={13} className="shrink-0 text-accent" />
      <span className="thinking-shimmer">{label ?? THINKING_CYCLE[i]}</span>
    </span>
  );
}

// Connection/presence dot — the green glow-dot that was copy-pasted in 3 places.
export function StatusDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 rounded-full",
        online ? "bg-share shadow-[0_0_8px_var(--color-share)]" : "bg-faint",
        className,
      )}
    />
  );
}

// Initials avatar on the accent→arc gradient (tokenized, so it adapts to theme).
export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const initials =
    name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold text-white select-none", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: "linear-gradient(135deg, var(--color-accent), var(--color-arc))",
      }}
    >
      {initials}
    </span>
  );
}
