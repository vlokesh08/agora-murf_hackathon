import { Router, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import type { AssistantMode } from "@personal-agent/shared";
import { requireAuth } from "../middleware/requireAuth";
import { buildRtcToken, isAgoraConfigured } from "../integrations/agora";
import {
  isConvoAiConfigured,
  joinConvoAiAgent,
  leaveConvoAiAgent,
  missingConvoAiEnvVars,
} from "../integrations/agoraConvoAi";
import { isMurfConfigured, synthesizeSpeech } from "../integrations/murf";
import { env } from "../config/env";
import { db } from "../database/db";
import { agentRuns, approvals, conversations, userPreferences } from "../database/schema";
import { resolveApproval, startRun, waitForRun } from "../agents/runEngine";

export const voiceRouter = Router();

// Keyed by the human user's id. Lost on server restart (acceptable for this
// scope) — an orphaned agent still exits on its own idle_timeout/72h cap.
const convoAiSessions = new Map<string, { agentId: string; channel: string; agentUid: number }>();

// --- SSE helpers ------------------------------------------------------
// Agora's Custom LLM vendor requires an OpenAI-compatible Server-Sent Events
// stream — its own sample servers reject non-streaming responses outright
// (400 "chat completions require streaming"). A single flat JSON body (what
// this handler used to send) is silently unusable to it, which is why ASR
// and the plan/execute pipeline could work perfectly while no audio was ever
// heard: Agora never had anything it recognized as a completion to hand TTS.
function sseHeaders(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  // `writeHead()` alone only buffers the status line/headers — Node doesn't
  // actually put them on the wire until the first `write()` or an explicit
  // flush. Without this, Agora (and anything else talking to this endpoint)
  // sees zero bytes for the entire debounce + pipeline duration, which looks
  // identical to a dead connection and is exactly what was happening here.
  res.flushHeaders();
}
function sseChunk(res: Response, id: string, delta: Record<string, unknown>, finishReason: string | null) {
  const chunk = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "personal-agent",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}
// Agora-specific leading chunk (documented separately from the standard
// OpenAI chunk shape): carries TTS-interrupt policy, `choices` ignored.
function sseMetadataChunk(res: Response, id: string, interruptable: boolean) {
  const chunk = {
    id,
    object: "chat.completion.custom_metadata",
    created: Math.floor(Date.now() / 1000),
    model: "personal-agent",
    choices: [] as unknown[],
    metadata: { interruptable },
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}
function sseDone(res: Response) {
  res.write("data: [DONE]\n\n");
  res.end();
}
/** Closes the stream with no content — used for a superseded mid-utterance
 *  call so the agent says nothing for it instead of speaking stale text. */
function sseEmpty(res: Response, id: string) {
  sseChunk(res, id, {}, "stop");
  sseDone(res);
}

// Spoken the instant a real utterance is dispatched, before anything else
// runs — a real plan (calendar/email reads, a Groq call) can easily take
// several seconds, and sitting in total silence for that whole stretch is
// exactly what made this feel like talking to a machine instead of a person,
// who'd at least say "let me check" before going quiet to look something up.
const ACK_FILLERS = [
  "Let me check that for you.",
  "Okay, one moment.",
  "Got it, let me take a look.",
  "Sure, give me a second.",
];
function pickAckFiller() {
  return ACK_FILLERS[Math.floor(Math.random() * ACK_FILLERS.length)];
}

// Agora calls this webhook again on every ASR end-of-speech segment while
// the user is still mid-sentence, not just once they're actually done
// talking (observed live: 5 calls for one unbroken sentence, each with more
// of the transcript than the last). Debouncing here is the same idea as the
// SILENCE_MS debounce already used for the browser's own speech recognition
// in hybrid mode (see useVoiceSession.ts) — only the call that goes
// unsuperseded for this long is treated as the real, finished utterance.
// 1.5s rather than hybrid mode's 1.2s: Agora's own ASR segments are already
// coarser than the browser's, so a slightly longer window further lowers the
// odds of firing early on an ordinary mid-sentence breath.
const DEBOUNCE_MS = 1500;
const pendingTurns = new Map<string, { res: Response; timer: NodeJS.Timeout }>();

function supersede(sessionId: string) {
  const pending = pendingTurns.get(sessionId);
  if (!pending) return;
  pendingTurns.delete(sessionId);
  clearTimeout(pending.timer);
  sseEmpty(pending.res, `chatcmpl-superseded-${Date.now()}`);
}

// Hard backstop against the same real request (plan -> execute -> respond,
// including any write like creating a calendar event) ever running more than
// once for one spoken utterance. The debounce above only protects against
// calls that arrive *while* a timer is still pending — it does nothing once
// that timer has already fired and dispatched a real run. A long enough
// pause mid-sentence (longer than DEBOUNCE_MS) lets exactly that happen:
// Agora calls again for the same session_id after we've already acted, which
// without this guard silently created duplicate calendar events, duplicate
// sent emails, etc. — once dispatched, a session is dispatched for good.
const DISPATCHED_SESSION_TTL_MS = 10 * 60 * 1000;
const dispatchedSessions = new Map<string, number>();

function wasAlreadyDispatched(sessionId: string): boolean {
  const cutoff = Date.now() - DISPATCHED_SESSION_TTL_MS;
  for (const [id, dispatchedAt] of dispatchedSessions) {
    if (dispatchedAt < cutoff) dispatchedSessions.delete(id);
  }
  return dispatchedSessions.has(sessionId);
}
function markDispatched(sessionId: string) {
  dispatchedSessions.set(sessionId, Date.now());
}

// Voice mode has no clickable approval dialog of its own — the run pauses at
// the approval gate and the only thing the user can do mid-call is talk. So a
// short affirmative/negative reply while a write step is waiting is treated as
// the approval decision itself, instead of being planned as a brand-new
// request (which is what used to happen: saying "approved" started a whole
// new run and left the paused one stuck waiting forever).
const APPROVE_WORDS = /\b(approve|approved|approves|yes|yeah|yep|yup|sure|okay|ok|confirm|confirmed|accept|proceed)\b/;
const APPROVE_PHRASES = /\b(go ahead|do it|please do|sounds good|go for it)\b/;
const REJECT_WORDS = /\b(reject|rejected|no|nope|cancel|cancelled|canceled|decline|declined|stop|nevermind)\b/;

function parseApprovalDecision(text: string): "approved" | "rejected" | null {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  // Only short replies count — "sure, what's on my calendar today?" is a new
  // question, not a decision about a pending write.
  if (normalized.split(" ").length > 8) return null;
  if (REJECT_WORDS.test(normalized) || /\b(don't|do not)\b/.test(normalized)) return "rejected";
  if (APPROVE_WORDS.test(normalized) || APPROVE_PHRASES.test(normalized)) return "approved";
  return null;
}

async function pendingApprovalsForConversation(conversationId: string) {
  return db
    .select({ id: approvals.id, runId: approvals.runId, summary: approvals.summary })
    .from(approvals)
    .innerJoin(agentRuns, eq(agentRuns.id, approvals.runId))
    .where(and(eq(agentRuns.conversationId, conversationId), eq(approvals.status, "pending")))
    .orderBy(desc(approvals.createdAt));
}

async function respondToApprovalDecision(
  res: Response,
  id: string,
  decision: "approved" | "rejected",
  pending: { id: string; runId: string; summary: string }[]
) {
  sseChunk(
    res,
    id,
    {
      role: "assistant",
      content: decision === "approved" ? "Okay, approved. " : "Okay, I won't do that. ",
    },
    null
  );

  // `resolveApproval` resumes the run once nothing is left pending, so the
  // terminal signal for the wait below comes from that resume, not from here.
  for (const approval of pending) {
    await resolveApproval(approval.id, decision).catch((err) => {
      console.error(`[voice/llm] could not resolve approval ${approval.id}`, err);
    });
  }

  const signal = await waitForRun(pending[0].runId, 25000);
  let reply: string;
  if (signal.kind === "completed") {
    reply = signal.responseText;
  } else if (signal.kind === "waiting_approval") {
    reply = `I still need your approval before I ${signal.goal.toLowerCase()}. Just say approve when you're ready.`;
  } else if (signal.kind === "failed") {
    reply = `Sorry, something went wrong${signal.error ? `: ${signal.error}` : "."}`;
  } else {
    reply =
      decision === "approved"
        ? "Done — it's finishing up in the app."
        : "Okay, I've cancelled that.";
  }
  sseChunk(res, id, { content: reply }, null);
  sseChunk(res, id, {}, "stop");
  sseDone(res);
}

async function respondToFinalUtterance(res: Response, conversationId: string, text: string) {
  const id = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  sseMetadataChunk(res, id, true);

  const decision = parseApprovalDecision(text);
  if (decision) {
    const pending = await pendingApprovalsForConversation(conversationId);
    if (pending.length > 0) {
      await respondToApprovalDecision(res, id, decision, pending);
      return;
    }
  }

  // Fires synchronously, before any DB/network call below — the whole point
  // is zero added latency before the user hears *something*.
  sseChunk(res, id, { role: "assistant", content: `${pickAckFiller()} ` }, null);

  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conversation) {
    sseChunk(res, id, { content: "Hmm, I couldn't find this conversation — try again?" }, null);
    sseChunk(res, id, {}, "stop");
    sseDone(res);
    return;
  }

  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, conversation.userId));
  const mode = (prefs?.assistantMode ?? "professional") as AssistantMode;

  const startedAt = Date.now();
  const { runId } = await startRun({ conversationId, userId: conversation.userId, text, mode });
  // Agora documents no fixed timeout for this webhook, so this is real
  // headroom for a full plan (calendar/email reads + a Groq response call)
  // rather than a budget raced against a guessed retry cadence.
  // Bumped from 12s: the new web-search tool's worst case (opening the
  // desktop app's browser window, loading a page, waiting on a live price)
  // can exceed that on its own.
  const signal = await waitForRun(runId, 25000);
  console.log(`[voice/llm] run=${runId} resolved as "${signal.kind}" after ${Date.now() - startedAt}ms`);

  let reply: string;
  if (signal.kind === "completed") {
    reply = signal.responseText;
  } else if (signal.kind === "waiting_approval") {
    reply = `I need your approval before I ${signal.goal.toLowerCase()}. Say "approve" when you're ready, or tap Approve in the app.`;
  } else if (signal.kind === "failed") {
    reply = `Sorry, I ran into a problem with that${signal.error ? `: ${signal.error}` : "."}`;
  } else {
    // Not "I'll let you know once it's done" — there's no channel for this
    // agent to speak again unprompted after this turn ends, so that would
    // be a promise it can't actually keep.
    reply = "That's taking unusually long — go ahead and ask me again in a moment.";
  }
  console.log(`[voice/llm] replying: "${reply}"`);
  // Continues the same spoken turn as the acknowledgement above rather than
  // starting a new one, so it reads (and sounds) like one natural reply:
  // "Let me check that for you. ... You've got one event today: ...".
  sseChunk(res, id, { content: reply }, null);
  sseChunk(res, id, {}, "stop");
  sseDone(res);
}

/**
 * Called by Agora's Conversational AI Engine, not our own frontend — no
 * session cookie travels with it, so this is verified by a shared secret
 * instead of `requireAuth`, and must be registered before that middleware is
 * attached to the router below.
 */
voiceRouter.post("/llm", async (req, res) => {
  if (req.headers["x-voice-webhook-secret"] !== env.voiceWebhookSecret) {
    res.status(401).json({ error: "Invalid webhook secret" });
    return;
  }
  const conversationId = req.headers["x-conversation-id"];
  if (typeof conversationId !== "string" || !conversationId) {
    res.status(400).json({ error: "Missing x-conversation-id header" });
    return;
  }

  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const lastUserMessage = [...messages].reverse().find((m) => m?.role === "user");
  const text = typeof lastUserMessage?.content === "string" ? lastUserMessage.content.trim() : "";
  const realSessionId = typeof lastUserMessage?.metadata?.session_id === "string"
    ? lastUserMessage.metadata.session_id
    : null;
  // Falling back to conversationId only ever affects debounce/supersede
  // (harmless — at worst a short window of over-eager superseding). The
  // permanent dispatched-guard below deliberately requires a *real* per-
  // utterance session id: reusing conversationId there would make it look
  // like every later utterance in the same conversation was a repeat of the
  // first, silently dropping all of them.
  const sessionId = realSessionId ?? conversationId;
  console.log(`[voice/llm] conversation=${conversationId} session=${sessionId} heard="${text}"`);

  // A newer ASR segment for the same utterance supersedes whatever was still
  // waiting on the debounce timer — that older call gets a quiet empty reply
  // instead of speaking stale, truncated content.
  supersede(sessionId);

  sseHeaders(res);

  if (!text) {
    sseEmpty(res, `chatcmpl-empty-${Date.now()}`);
    return;
  }

  if (realSessionId && wasAlreadyDispatched(realSessionId)) {
    // We already ran the real pipeline for this utterance (a long mid-
    // sentence pause let an earlier call's debounce timer fire before the
    // user actually finished) — this is more of the same utterance arriving
    // late, not a new request, so don't act on it again.
    sseEmpty(res, `chatcmpl-already-handled-${Date.now()}`);
    return;
  }

  const timer = setTimeout(() => {
    pendingTurns.delete(sessionId);
    if (realSessionId) markDispatched(realSessionId);
    respondToFinalUtterance(res, conversationId, text).catch((err) => {
      console.error("[voice/llm] failed while responding", err);
      sseEmpty(res, `chatcmpl-error-${Date.now()}`);
    });
  }, DEBOUNCE_MS);
  pendingTurns.set(sessionId, { res, timer });

  // Agora actually dropping the connection before we respond (not to be
  // confused with `req`'s own 'close', which fires as soon as Express
  // finishes reading the request body — i.e. almost immediately, long before
  // our handler even runs — and would cancel the debounce timer on every
  // single call regardless of whether the client ever disconnected).
  // `writableEnded` tells apart a genuine abort from our own normal finish.
  res.on("close", () => {
    if (res.writableEnded) return;
    const pending = pendingTurns.get(sessionId);
    if (pending?.res === res) {
      clearTimeout(pending.timer);
      pendingTurns.delete(sessionId);
    }
  });
});

voiceRouter.use(requireAuth);

voiceRouter.post("/session/start", async (req, res) => {
  if (!isAgoraConfigured()) {
    res.status(501).json({ error: "Agora is not configured on this server" });
    return;
  }
  const userId = req.session!.user.id;
  const conversationId = typeof req.body?.conversationId === "string" ? req.body.conversationId : "";
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  // Unique per voice session, not per conversation: a reused channel name can
  // collide with an agent from an earlier session that never got a clean
  // `leave()` (e.g. the backend restarting mid-session during development),
  // which makes the next join fail and silently fall back to hybrid mode.
  const channel = `${conversation.id}-${Date.now()}`;
  const humanUid = Math.floor(Math.random() * 1_000_000_000);
  const token = buildRtcToken(channel, humanUid);

  if (!isConvoAiConfigured()) {
    const missing = missingConvoAiEnvVars();
    console.warn(`[voice/session/start] ConvoAI not configured, using hybrid mode — missing: ${missing.join(", ")}`);
    res.json({
      appId: env.agoraAppId,
      channel,
      uid: humanUid,
      token,
      mode: "hybrid",
      warning: `ConvoAI not configured — missing: ${missing.join(", ")}`,
    });
    return;
  }
  console.log("[voice/session/start] ConvoAI configured, joining agent for channel", channel);

  try {
    const agentUid = Math.floor(Math.random() * 1_000_000_000);
    const { agentId } = await joinConvoAiAgent({ channel, agentUid, humanUid, conversationId });
    convoAiSessions.set(userId, { agentId, channel, agentUid });
    res.json({ appId: env.agoraAppId, channel, uid: humanUid, token, mode: "convoai" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Agora ConvoAI join failed, falling back to hybrid mode:", message);
    // The RTC transport still works — just fall back to the hybrid client
    // path, but tell the client WHY so this isn't a silent downgrade.
    res.json({
      appId: env.agoraAppId,
      channel,
      uid: humanUid,
      token,
      mode: "hybrid",
      warning: `ConvoAI join failed: ${message}`,
    });
  }
});

voiceRouter.post("/session/stop", async (req, res) => {
  const userId = req.session!.user.id;
  const session = convoAiSessions.get(userId);
  convoAiSessions.delete(userId);
  if (session) {
    await leaveConvoAiAgent(session).catch((err) => {
      console.error("Agora ConvoAI leave failed", err);
    });
  }
  res.json({ ok: true });
});

voiceRouter.post("/speak", async (req, res) => {
  if (!isMurfConfigured()) {
    res.status(501).json({ error: "Murf is not configured on this server" });
    return;
  }
  const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 2000) : "";
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  try {
    const { audioUrl, durationSeconds } = await synthesizeSpeech(text);
    res.json({ audioUrl, durationSeconds });
  } catch (err) {
    console.error("Murf synthesis failed", err);
    res.status(502).json({ error: "Speech synthesis failed" });
  }
});
