import agoraToken from "agora-token";
import { VOICE_GREETING } from "@personal-agent/shared";
import { env } from "../config/env";
import { voiceParamsForNow } from "./voicePersonality";

const { ConvoAITokenBuilder } = agoraToken;

const API_BASE = "https://api.agora.io/api/conversational-ai-agent";

export function isConvoAiConfigured() {
  return missingConvoAiEnvVars().length === 0;
}

/** Names of the required env vars that aren't set, for a diagnosable log line. */
export function missingConvoAiEnvVars(): string[] {
  const required: [string, unknown][] = [
    ["AGORA_APP_ID", env.agoraAppId],
    ["AGORA_APP_CERTIFICATE", env.agoraAppCertificate],
    ["MURF_API_KEY", env.murfApiKey],
  ];
  return required.filter(([, value]) => !value).map(([name]) => name);
}

// Token auth is Agora's recommended method for the Conversational AI REST API
// (vs. Basic auth with a separate Customer ID/Secret pair) — it only needs
// the same App ID/Certificate already used for plain RTC tokens. One token
// carries RTC + RTM + ConvoAI privileges together for a given channel/uid.
const TOKEN_TTL_SECONDS = 3600;

function buildConvoAiToken(channel: string, uid: number) {
  return ConvoAITokenBuilder.buildToken(
    env.agoraAppId!,
    env.agoraAppCertificate!,
    channel,
    String(uid),
    TOKEN_TTL_SECONDS,
    TOKEN_TTL_SECONDS
  );
}

function tokenAuthHeader(token: string) {
  return `agora token="${token}"`;
}

interface JoinResponse {
  agent_id: string;
  create_ts: number;
  status: string;
}

/** Starts a Conversational AI agent in `channel`, listening for `humanUid` and
 * calling back to our own planner/tools via `llm.url` for every turn. */
export async function joinConvoAiAgent(opts: {
  channel: string;
  agentUid: number;
  humanUid: number;
  conversationId: string;
}): Promise<{ agentId: string }> {
  const agentToken = buildConvoAiToken(opts.channel, opts.agentUid);

  const res = await fetch(`${API_BASE}/v2/projects/${env.agoraAppId}/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: tokenAuthHeader(agentToken),
    },
    body: JSON.stringify({
      name: `agent-${opts.channel}-${Date.now()}`,
      properties: {
        channel: opts.channel,
        token: agentToken,
        agent_rtc_uid: String(opts.agentUid),
        remote_rtc_uids: [String(opts.humanUid)],
        // Long enough for a paused run to wait on the user's approval — the
        // old 120s let the agent leave the channel while a write step was
        // still waiting, so the user's "approve" had nobody left to hear it.
        idle_timeout: 900,
        llm: {
          url: `${env.publicBackendUrl}/api/voice/llm`,
          vendor: "custom",
          style: "openai",
          max_history: 20,
          // Speaks this via the same Murf TTS binding the moment the human
          // joins — no ASR/webhook round-trip needed for the opener.
          greeting_message: VOICE_GREETING,
          headers: {
            "x-voice-webhook-secret": env.voiceWebhookSecret,
            "x-conversation-id": opts.conversationId,
          },
        },
        tts: {
          vendor: "murf",
          params: {
            api_key: env.murfApiKey,
            // Required streaming endpoint per Agora's Murf integration docs —
            // without it the agent has nowhere to open the TTS stream, so it
            // silently produces no audio even though ASR + the LLM step work.
            base_url: "wss://global.api.murf.ai/v1/speech/stream-input",
            voiceId: env.murfVoiceId,
            locale: "en-US",
            // Quieter/slower at night, snappier during rush hours — set once
            // at join time for this session's whole call.
            ...voiceParamsForNow(),
            sample_rate: 24000,
            model: "FALCON",
          },
        },
        asr: { language: "en-US" },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Agora ConvoAI join failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as JoinResponse;
  return { agentId: data.agent_id };
}

export async function leaveConvoAiAgent(opts: {
  agentId: string;
  channel: string;
  agentUid: number;
}): Promise<void> {
  const agentToken = buildConvoAiToken(opts.channel, opts.agentUid);
  const res = await fetch(`${API_BASE}/v2/projects/${env.agoraAppId}/agents/${opts.agentId}/leave`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: tokenAuthHeader(agentToken),
    },
  });
  if (!res.ok) {
    throw new Error(`Agora ConvoAI leave failed (${res.status}): ${await res.text()}`);
  }
}
