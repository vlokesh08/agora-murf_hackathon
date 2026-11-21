import { z } from "zod";

export const assistantModeSchema = z.enum(["professional", "roast", "family"]);
export type AssistantMode = z.infer<typeof assistantModeSchema>;

export const assistantModes: Record<
  AssistantMode,
  { label: string; tagline: string; tone: string; example: string }
> = {
  professional: {
    label: "Professional",
    tagline: "Clear, concise, respectful and structured",
    tone: "Clear, concise, respectful and structured.",
    example: "Your 2:30 PM slot is available. Shall I schedule the meeting?",
  },
  roast: {
    label: "Roast Mode",
    tagline: "Playfully sarcastic, witty and lightly teasing",
    tone: "Witty and playfully sarcastic. Keep teasing light and friendly.",
    example:
      "Your calendar is a mess, but I found a free slot at 2:30. Want me to fix it?",
  },
  family: {
    label: "Family Touch",
    tagline: "Warm, patient, supportive and considerate",
    tone: "Warm, patient, supportive and considerate.",
    example:
      "You have a little free time after lunch. I can arrange the meeting then if you'd like.",
  },
};

export const assistantModeList = Object.entries(assistantModes).map(
  ([key, value]) => ({ key: key as AssistantMode, ...value })
);

/** Spoken as soon as a voice session opens, before the user says anything —
 *  shared so the ConvoAI agent's greeting and the hybrid-mode fallback say
 *  the same thing. */
export const VOICE_GREETING = "Hey, I'm listening — what can I help with?";
