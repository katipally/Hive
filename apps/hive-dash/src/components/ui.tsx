import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export function Button({
  variant = "ghost",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "subtle" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition disabled:opacity-30 disabled:pointer-events-none",
        variant === "primary" && "bg-honey text-bg hover:brightness-105 shadow-[0_2px_12px_-4px_rgba(244,184,60,0.5)]",
        variant === "ghost" && "border border-border bg-card text-fg hover:border-border-heavy hover:bg-fg/[0.04]",
        variant === "subtle" && "text-muted hover:bg-fg/[0.06] hover:text-fg",
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
        "rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.3),0_16px_40px_-24px_rgba(0,0,0,0.7)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-fg outline-none placeholder:text-faint focus:border-honey/50 transition-colors",
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
        "rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-fg outline-none focus:border-honey/50 transition-colors cursor-pointer",
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
  tone?: "muted" | "honey" | "share" | "partial" | "withhold" | "live";
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    muted: "bg-fg/[0.06] text-muted",
    honey: "bg-honey-soft text-honey",
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
