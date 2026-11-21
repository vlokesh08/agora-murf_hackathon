import { useAnimationFrame, useMotionValue, useReducedMotion } from "motion/react";
import { VoiceOrb as BeuiVoiceOrb } from "@/components/agents/voice-orb";
import type { VoiceState } from "../../types/workflow";

// It's your turn to talk — mic is open, waiting to hear you.
const LISTENING_STATES: VoiceState[] = ["listening", "transcribing"];
// The agent is talking back.
const SPEAKING_STATES: VoiceState[] = ["speaking"];
const THINKING_STATES: VoiceState[] = ["planning", "executing"];
const ALERT_STATES: VoiceState[] = ["error", "reconnecting"];

// Distinct palette per state so "listening" and "speaking" (previously
// identical) read apart at a glance, not just via the text label.
const ORB_COLORS: Record<string, readonly [string, string, string]> = {
  listening: ["#2f6df0", "#4ecbff", "#140c2e"],
  speaking: ["#5b3df0", "#4ecbff", "#140c2e"],
  thinking: ["#5b3df0", "#8a7bf5", "#140c2e"],
  alert: ["#d0433d", "#ff8a65", "#140c2e"],
  idle: ["#5b3df0", "#4ecbff", "#140c2e"],
};

function colorsFor(state: VoiceState) {
  if (LISTENING_STATES.includes(state)) return ORB_COLORS.listening;
  if (SPEAKING_STATES.includes(state)) return ORB_COLORS.speaking;
  if (THINKING_STATES.includes(state)) return ORB_COLORS.thinking;
  if (ALERT_STATES.includes(state)) return ORB_COLORS.alert;
  return ORB_COLORS.idle;
}

export function VoiceOrb({
  state,
  onClick,
  size = "w-16",
}: {
  state: VoiceState;
  onClick: () => void;
  /** Tailwind width class controlling the orb's diameter (height follows via
   *  its own aspect ratio) — the footer orb and the full-screen voice-only
   *  orb are the same component at different sizes. */
  size?: string;
}) {
  const activity = useMotionValue(0);
  const reducedMotion = useReducedMotion();

  useAnimationFrame((time) => {
    if (reducedMotion) {
      activity.set(0);
      return;
    }
    const t = time / 1000;
    if (SPEAKING_STATES.includes(state)) {
      // Simulated syllables and pauses — no real audio is analyzed yet.
      const phrase = Math.max(0, Math.sin(t * 0.85));
      const syllable = Math.max(0, Math.sin(t * 9.3 + Math.sin(t * 2.1)));
      activity.set(phrase * (0.12 + syllable ** 2 * 0.72));
    } else if (LISTENING_STATES.includes(state)) {
      // Calmer, steadier breathing — your turn to talk, not the agent's.
      activity.set(0.08 + Math.sin(t * 1.2) * 0.05);
    } else if (THINKING_STATES.includes(state)) {
      activity.set(0.12 + Math.sin(t * 2) * 0.04);
    } else if (ALERT_STATES.includes(state)) {
      activity.set(0.1 + Math.sin(t * 3) * 0.08);
    } else {
      activity.set(0);
    }
  });

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Toggle voice input"
      className="shrink-0 cursor-pointer rounded-full"
    >
      <BeuiVoiceOrb activity={activity} colors={colorsFor(state)} className={size} />
    </button>
  );
}
