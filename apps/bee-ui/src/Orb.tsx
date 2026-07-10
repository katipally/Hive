import { useEffect, useRef } from "react";

export type BeePhase = "idle" | "listening" | "thinking" | "speaking";

// Per-state color so the orb signals what's happening: green while it listens,
// honey while it speaks (the brand), ember while it thinks, calm warm when idle.
function colorsFor(phase: BeePhase): { core: string; ring: string; glow: string } {
  switch (phase) {
    case "listening": // green — hearing you
      return { core: "radial-gradient(circle at 40% 35%, #d6f9e4, #56cf8c 55%, #2f9a63 82%)", ring: "rgba(74,222,128,0.55)", glow: "rgba(74,222,128,0.40)" };
    case "speaking": // blue accent — talking
      return { core: "radial-gradient(circle at 40% 35%, #d6e6ff, #5b9dff 55%, #3f74d0 82%)", ring: "rgba(91,157,255,0.55)", glow: "rgba(91,157,255,0.42)" };
    case "thinking": // ember — working
      return { core: "radial-gradient(circle at 40% 35%, #ffe0c0, #ef8f3f 55%, #c9601f 82%)", ring: "rgba(226,112,31,0.55)", glow: "rgba(226,112,31,0.40)" };
    default: // idle — calm warm neutral
      return { core: "radial-gradient(circle at 40% 35%, #efe6d2, #cbb98f 55%, #a2916b 80%)", ring: "rgba(200,180,130,0.42)", glow: "rgba(200,180,130,0.32)" };
  }
}

// Dependency-free voice orb (ported from OpenLive): layered CSS circles driven by
// a rAF loop — a glowing core + two rings that react to the mic (listening) or a
// gentle wobble (speaking), breathing while thinking. No WebGL.
export function Orb({ phase, getLevels, size = 220 }: { phase: BeePhase; getLevels: () => { mic: number; agent: number }; size?: number }) {
  const core = useRef<HTMLDivElement>(null);
  const ring1 = useRef<HTMLDivElement>(null);
  const ring2 = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const reduce = matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, t0 = 0, cur = 0;
    const loop = (ms: number) => {
      if (!t0) t0 = ms;
      const time = (ms - t0) / 1000;
      const p = phaseRef.current;
      const { mic, agent } = getLevels();
      const busy = p === "thinking";
      let amp = 0;
      if (p === "speaking") amp = Math.min(1, agent * 4 + 0.06 * (1 + Math.sin(time * 6)));
      else if (p === "listening" || p === "idle") amp = Math.min(1, mic * 4);
      else if (busy) amp = 0.35 + 0.2 * Math.sin(time * 3);
      if (reduce) amp = busy ? 0.3 : Math.min(0.3, amp);
      cur += (amp - cur) * 0.2; // critically damped

      if (core.current) { core.current.style.transform = `scale(${1 + cur * 0.16})`; core.current.style.opacity = `${0.85 + cur * 0.15}`; }
      if (ring1.current) { ring1.current.style.transform = `scale(${1 + cur * 0.55})`; ring1.current.style.opacity = `${0.35 + cur * 0.35}`; }
      if (ring2.current) { ring2.current.style.transform = `scale(${1 + cur * 0.95})`; ring2.current.style.opacity = `${0.15 + cur * 0.3}`; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getLevels]);

  const c = colorsFor(phase);
  const ring = "absolute inset-0 rounded-full border will-change-transform";
  return (
    <div className="relative grid place-items-center select-none" style={{ width: size, height: size }} aria-hidden>
      <div ref={ring2} className={ring} style={{ borderColor: c.ring, opacity: 0.6, transition: "border-color 400ms ease" }} />
      <div ref={ring1} className={ring} style={{ borderColor: c.ring, transition: "border-color 400ms ease" }} />
      <div ref={core} className="rounded-full will-change-transform" style={{
        width: size * 0.55, height: size * 0.55,
        background: c.core,
        boxShadow: `0 0 40px 8px ${c.glow}, inset 0 0 24px rgba(255,255,255,0.35)`,
        transition: "background 400ms ease, box-shadow 400ms ease",
      }} />
    </div>
  );
}
