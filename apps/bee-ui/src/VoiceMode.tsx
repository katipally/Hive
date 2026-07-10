import { AnimatePresence, motion } from "motion/react";
import { Mic, MicOff, X } from "lucide-react";
import { cn } from "@hive/ui";
import { Orb, type BeePhase } from "./Orb.js";

const PHASE_LABEL: Record<BeePhase, string> = {
  idle: "Tap to speak",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

// Full-screen hands-free conversation: the Orb, a live transcript, and a
// minimal control bar. Presentational — all engine logic lives in useVoice.
export function VoiceMode({
  open, name, phase, transcript, muted, getLevels, onToggleMute, onEnd,
}: {
  open: boolean;
  name: string;
  phase: BeePhase;
  transcript: string;
  muted: boolean;
  getLevels: () => { mic: number; agent: number };
  onToggleMute: () => void;
  onEnd: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-bg/95 backdrop-blur-xl"
        >
          <div className="absolute top-6 flex items-center gap-2 text-[13px] font-medium text-muted">
            <span className="size-1.5 rounded-full bg-honey" /> {name}
          </div>

          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
          >
            <Orb phase={phase} getLevels={getLevels} size={240} />
          </motion.div>

          <div className="mt-8 flex h-16 flex-col items-center gap-2 px-8 text-center">
            <div className={cn("text-[14px] font-medium", phase === "listening" ? "text-share" : phase === "speaking" ? "text-honey" : "text-muted")}>
              {PHASE_LABEL[phase]}
            </div>
            {transcript && <div className="max-w-md text-[15px] leading-snug text-fg">{transcript}</div>}
          </div>

          <div className="absolute bottom-10 flex items-center gap-4">
            <button
              onClick={onToggleMute}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              className={cn(
                "grid size-13 place-items-center rounded-full border transition",
                muted ? "border-withhold/40 bg-withhold/15 text-withhold" : "border-border bg-card text-fg hover:border-border-heavy",
              )}
            >
              {muted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            <button
              onClick={onEnd}
              aria-label="End voice mode"
              className="grid size-13 place-items-center rounded-full bg-withhold text-white transition hover:brightness-110"
            >
              <X size={22} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
