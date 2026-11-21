import { env } from "../config/env";
import { voiceParamsForNow } from "./voicePersonality";

export function isMurfConfigured() {
  return Boolean(env.murfApiKey);
}

interface MurfResponse {
  audioFile: string;
  audioLengthInSeconds: number;
}

/** Synthesizes speech for a short assistant reply, returning a hosted audio URL. */
export async function synthesizeSpeech(text: string) {
  const { rate, pitch } = voiceParamsForNow();
  const res = await fetch("https://api.murf.ai/v1/speech/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.murfApiKey!,
    },
    body: JSON.stringify({
      text,
      voiceId: env.murfVoiceId,
      format: "MP3",
      rate,
      pitch,
    }),
  });
  if (!res.ok) {
    throw new Error(`Murf API error (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as MurfResponse;
  return { audioUrl: data.audioFile, durationSeconds: data.audioLengthInSeconds };
}
