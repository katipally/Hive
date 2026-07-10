import type { Transition, Variants } from "motion/react";

export const spring: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.9 };
export const easeOut: Transition = { duration: 0.22, ease: [0.22, 1, 0.36, 1] };
export const quick: Transition = { duration: 0.15, ease: [0.22, 1, 0.36, 1] };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: easeOut },
  exit: { opacity: 0, y: 4, transition: quick },
};

export const panel: Variants = {
  hidden: { opacity: 0, x: 24 },
  show: { opacity: 1, x: 0, transition: spring },
  exit: { opacity: 0, x: 24, transition: quick },
};

export const stagger = (i: number): Transition => ({ ...easeOut, delay: Math.min(i * 0.035, 0.4) });
