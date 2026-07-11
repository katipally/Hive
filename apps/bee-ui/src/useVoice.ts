import { useCallback, useEffect, useRef, useState } from "react";
import type { BeePhase } from "./Orb.js";

// Voice mode on native browser APIs — SpeechRecognition (listen) + speechSynthesis
// (speak) + an AnalyserNode for a live mic level to drive the Orb. Zero heavy deps.
// ponytail: native speech is the lazy-right call for a web bee; the seam to swap
// in neural TTS (kokoro/onnx, like OpenLive) is `speak()` — replace its body.
const SR: any = typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
const hasSynth = typeof window !== "undefined" && "speechSynthesis" in window;

// Markdown reads badly aloud ("star star bold star star", full URLs spelled out), so
// flatten to speech-friendly plain text before TTS (CH-5).
function plainForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // code blocks aren't speakable
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // link → its text, not the URL
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function useVoice(opts: {
  send: (text: string) => boolean;
  setOnDone: (fn: ((text: string) => void) | null) => void;
}) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<BeePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [muted, setMuted] = useState(false);
  const supported = !!SR && hasSynth;

  const recogRef = useRef<any>(null);
  const wantListenRef = useRef(false);       // should recognition auto-restart on end?
  const activeRef = useRef(false);
  const mutedRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(new ArrayBuffer(0)));
  const agentLvlRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const getLevels = useCallback(() => {
    let mic = 0;
    const an = analyserRef.current;
    if (an && !mutedRef.current) {
      an.getByteTimeDomainData(dataRef.current);
      let s = 0;
      for (let i = 0; i < dataRef.current.length; i++) {
        const d = ((dataRef.current[i] ?? 128) - 128) / 128;
        s += d * d;
      }
      mic = Math.sqrt(s / Math.max(1, dataRef.current.length));
    }
    agentLvlRef.current *= 0.88; // decay the speaking pulse
    return { mic, agent: agentLvlRef.current };
  }, []);

  const startRecog = useCallback(() => {
    if (!SR || mutedRef.current || !activeRef.current) return;
    try {
      const r = new SR();
      r.lang = navigator.language || "en-US";
      r.interimResults = true;
      r.continuous = true;
      r.onresult = (e: any) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const txt = res[0]?.transcript ?? "";
          if (res.isFinal) {
            const finalText = txt.trim();
            setTranscript("");
            if (finalText && !mutedRef.current) {
              wantListenRef.current = false;
              try { r.stop(); } catch { /* noop */ }
              setPhase("thinking");
              optsRef.current.send(finalText);
            }
          } else {
            interim += txt;
          }
        }
        if (interim) setTranscript(interim);
      };
      r.onend = () => {
        if (wantListenRef.current && activeRef.current && !mutedRef.current) startRecog();
      };
      r.onerror = () => { /* transient (no-speech, aborted) — onend handles restart */ };
      recogRef.current = r;
      wantListenRef.current = true;
      setPhase("listening");
      r.start();
    } catch { /* already started / not allowed */ }
  }, []);

  const speak = useCallback((text: string) => {
    const spoken = plainForSpeech(text);
    if (!hasSynth || !spoken) { setPhase("listening"); startRecog(); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(spoken);
      u.lang = navigator.language || "en-US";
      u.onstart = () => setPhase("speaking");
      u.onboundary = () => { agentLvlRef.current = 0.28; };
      u.onend = () => { if (activeRef.current) { setPhase("listening"); startRecog(); } else setPhase("idle"); };
      u.onerror = () => { if (activeRef.current) { setPhase("listening"); startRecog(); } };
      window.speechSynthesis.speak(u);
    } catch {
      if (activeRef.current) { setPhase("listening"); startRecog(); }
    }
  }, [startRecog]);

  const start = useCallback(async () => {
    if (!supported) return;
    activeRef.current = true;
    setActive(true);
    optsRef.current.setOnDone((text) => { if (activeRef.current && !mutedRef.current) speak(text); });
    // Mic level for the Orb — optional; recognition works without it.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      dataRef.current = new Uint8Array(new ArrayBuffer(an.fftSize));
      audioRef.current = ctx;
      analyserRef.current = an;
    } catch { /* no mic level — orb still breathes */ }
    startRecog();
  }, [supported, speak, startRecog]);

  const stop = useCallback(() => {
    activeRef.current = false;
    wantListenRef.current = false;
    setActive(false);
    setPhase("idle");
    setTranscript("");
    optsRef.current.setOnDone(null);
    try { recogRef.current?.stop(); } catch { /* noop */ }
    if (hasSynth) window.speechSynthesis.cancel();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioRef.current?.close().catch(() => {});
    audioRef.current = null;
    analyserRef.current = null;
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      if (next) { wantListenRef.current = false; try { recogRef.current?.stop(); } catch { /* noop */ } }
      else if (activeRef.current && phase !== "speaking") startRecog();
      return next;
    });
  }, [phase, startRecog]);

  useEffect(() => () => stop(), [stop]); // cleanup on unmount

  return { active, phase, transcript, muted, supported, getLevels, start, stop, toggleMute };
}
