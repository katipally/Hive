import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "../lib/cn.js";

// Dependency-free drag handle (ported from takt). `edge` is which edge of the panel the
// handle sits on: a left sidebar's handle is on its right edge (drag right = wider); a
// right rail's handle is on its left edge (drag left = wider).
export function Resizer({
  edge,
  width,
  min,
  max,
  onChange,
}: {
  edge: "left" | "right";
  width: number;
  min: number;
  max: number;
  onChange: (w: number) => void;
}) {
  const onDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      const move = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        const next = edge === "right" ? startW + delta : startW - delta;
        onChange(Math.min(max, Math.max(min, next)));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [edge, width, min, max, onChange],
  );
  return (
    <div
      onPointerDown={onDown}
      role="separator"
      aria-orientation="vertical"
      className={cn("group absolute top-0 z-30 h-full w-2 cursor-col-resize", edge === "right" ? "-right-1" : "-left-1")}
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-accent/40" />
    </div>
  );
}
