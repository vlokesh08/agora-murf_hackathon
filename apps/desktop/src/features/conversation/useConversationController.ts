import { useEffect, useRef, useState } from "react";
import { SOCKET_EVENTS, VOICE_GREETING, type SocketEventEnvelope } from "@personal-agent/shared";
import { api, ApiError } from "../../lib/apiClient";
import { getSocket, joinConversation, leaveConversation } from "../../lib/socketClient";
import type { ConversationMessage, VoiceState } from "../../types/workflow";
import { listAudioOutputDevices, useVoiceSession } from "./useVoiceSession";

const ACTIVE_STATES: VoiceState[] = ["listening", "transcribing", "planning", "executing"];

interface ConversationResponse {
  conversation: { id: string };
  messages: { id: string; role: "user" | "assistant"; text: string; createdAt: string }[];
}

export interface PendingApproval {
  approvalId: string;
  nodeId: string;
  tool: string;
  summary: string;
}

const APPROVE_WORDS = /\b(approve|approved|approves|yes|yeah|yep|yup|sure|okay|ok|confirm|confirmed|accept|proceed)\b/;
const APPROVE_PHRASES = /\b(go ahead|do it|please do|sounds good|go for it)\b/;
const REJECT_WORDS = /\b(reject|rejected|no|nope|cancel|cancelled|canceled|decline|declined|stop|nevermind)\b/;

/** "approved" / "yes" / "no, cancel" said or typed while a write step is
 *  waiting — treated as the yes/no decision rather than a fresh request. */
function parseApprovalDecision(text: string): "approved" | "rejected" | null {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (normalized.split(" ").length > 8) return null;
  if (REJECT_WORDS.test(normalized) || /\b(don't|do not)\b/.test(normalized)) return "rejected";
  if (APPROVE_WORDS.test(normalized) || APPROVE_PHRASES.test(normalized)) return "approved";
  return null;
}

/**
 * All conversation + voice-session state and wiring, shared between the full
 * chat screen and the voice-only screen — both are just different views over
 * the same running conversation, so neither should own this logic itself.
 */
export function useConversationController() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [approvalFeedback, setApprovalFeedback] = useState<
    { status: "approved" | "rejected" | "error"; message?: string } | null
  >(null);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDeviceId, setOutputDeviceId] = useState("");

  const activeRunIdRef = useRef<string | null>(null);
  const voiceActiveRef = useRef(false);
  const lastTurnWasVoiceRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  const voice = useVoiceSession({
    onTranscript: (text) => {
      lastTurnWasVoiceRef.current = true;
      setInterimTranscript("");
      void sendText(text);
    },
    onSpeechActivity: (interimText) => {
      // Live proof the mic is actually picking something up, and the signal
      // for barge-in: the user started talking over the assistant's speech.
      setInterimTranscript(interimText);
      const audio = audioRef.current;
      if (interimText && audio && !audio.paused) {
        audio.pause();
        audio.currentTime = 0;
        setVoiceState("interrupted");
      }
    },
    onReconnecting: () => setVoiceState("reconnecting"),
    onError: (message) => {
      voiceActiveRef.current = false;
      console.error("Voice session error:", message);
      setInterimTranscript("");
      setVoiceError(message);
      setVoiceState("error");
      // Tear down fully so the next orb click starts clean instead of
      // stacking a second session on top of this one, still running unseen.
      void voice.stop();
    },
    onAgentAudio: (speaking) => setVoiceState(speaking ? "speaking" : "listening"),
    // Mic is paused here (push-to-talk, one utterance captured) — the
    // session itself stays active; listening resumes once the assistant's
    // reply has actually finished, via `backToListening()` below, so a
    // multi-turn conversation doesn't need the orb tapped every turn.
    onUtteranceEnd: () => {},
  });

  useEffect(() => {
    return () => {
      if (voiceActiveRef.current) void voice.stop();
    };
  }, [voice]);

  // Output device list (speakers/headphones/etc). Device labels only show up
  // once mic permission has been granted at least once in this browser —
  // already true by the time someone reaches a conversation screen.
  useEffect(() => {
    let cancelled = false;
    async function loadDevices() {
      const devices = await listAudioOutputDevices().catch(() => []);
      if (cancelled) return;
      setOutputDevices(devices);
      setOutputDeviceId((current) => current || devices[0]?.deviceId || "");
    }
    void loadDevices();
    navigator.mediaDevices.addEventListener("devicechange", loadDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", loadDevices);
    };
  }, []);

  async function handleOutputDeviceChange(deviceId: string) {
    setOutputDeviceId(deviceId);
    const audio = audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    await audio?.setSinkId?.(deviceId).catch((err) => {
      console.warn("Could not switch playback device for Murf audio:", err);
    });
    await voice.setOutputDevice(deviceId);
  }

  useEffect(() => {
    async function init() {
      const conversations = await api.get<{ id: string }[]>("/api/conversations");
      const conversation =
        conversations[0] ?? (await api.post<{ id: string }>("/api/conversations", {}));
      const detail = await api.get<ConversationResponse>(`/api/conversations/${conversation.id}`);
      conversationIdRef.current = conversation.id;
      setConversationId(conversation.id);
      setMessages(
        detail.messages.map((m) => ({ id: m.id, role: m.role, text: m.text, createdAt: m.createdAt }))
      );
      joinConversation(conversation.id);
    }
    void init();
    return () => {
      if (conversationIdRef.current) leaveConversation(conversationIdRef.current);
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();

    // Matching by conversation (not runId) covers both runs this client
    // started itself and ones triggered server-side — e.g. a voice turn
    // Agora's Conversational AI Engine kicks off via our backend's webhook,
    // which this client never called `/api/agent/runs` for.
    function isActive(envelope: SocketEventEnvelope) {
      return envelope.conversationId === conversationIdRef.current;
    }

    function onStarted(envelope: SocketEventEnvelope<{ requestText: string }>) {
      if (!isActive(envelope)) return;
      activeRunIdRef.current = envelope.runId;
      setActiveRunId(envelope.runId);
      setVoiceState("planning");
      setMessages((m) => [
        ...m,
        {
          id: envelope.eventId,
          role: "user",
          text: envelope.payload.requestText,
          createdAt: envelope.timestamp,
        },
      ]);
    }
    function onNodeStarted(envelope: SocketEventEnvelope) {
      if (!isActive(envelope)) return;
      setVoiceState("executing");
    }
    function onCompleted(envelope: SocketEventEnvelope<{ responseText: string }>) {
      if (!isActive(envelope)) return;
      setMessages((m) => [
        ...m,
        {
          id: envelope.eventId,
          role: "assistant",
          text: envelope.payload.responseText,
          createdAt: envelope.timestamp,
        },
      ]);

      if (voice.isConvoAi()) {
        // Agora's agent already spoke this via its own Murf binding directly
        // into the RTC channel; onAgentAudio drives speaking/listening instead.
        return;
      }
      if (lastTurnWasVoiceRef.current) {
        void speakReply(envelope.payload.responseText);
      } else {
        setVoiceState("idle");
      }
    }
    // The assistant talking first — e.g. a calendar event starting soon —
    // with no run behind it, so it only ever appends a bubble (and speaks it
    // in hybrid voice mode) rather than touching run/workflow state.
    function onNudge(envelope: SocketEventEnvelope<{ text: string }>) {
      if (!isActive(envelope)) return;
      setMessages((m) => [
        ...m,
        {
          id: envelope.eventId,
          role: "assistant",
          text: envelope.payload.text,
          createdAt: envelope.timestamp,
        },
      ]);
      if (voiceActiveRef.current && !voice.isConvoAi()) {
        void speakReply(envelope.payload.text);
      }
    }
    // The backend has no browser of its own — when a run needs a live web
    // lookup, it asks this (already-open) desktop app to do it via Electron's
    // own window, then this reports the result back the same way it arrived.
    function onWebSearchRequest(payload: { requestId: string; query: string }) {
      void (async () => {
        const result = (await window.desktopApp?.searchWeb(payload.query)) ?? {
          error: "Desktop search bridge isn't available in this window",
        };
        socket.emit(SOCKET_EVENTS.WEB_SEARCH_RESPONSE, { requestId: payload.requestId, ...result });
      })();
    }
    function onFailed(envelope: SocketEventEnvelope<{ error?: string }>) {
      if (!isActive(envelope)) return;
      setVoiceState("error");
      setMessages((m) => [
        ...m,
        {
          id: envelope.eventId,
          role: "assistant",
          text: `Something went wrong: ${envelope.payload.error ?? "unknown error"}`,
          createdAt: envelope.timestamp,
        },
      ]);
    }
    // A write step (send email, create event, move files, ...) is paused
    // waiting on a yes/no from the user — surfaced via the approval dock in
    // whichever screen is open (conversation or voice-only) rather than only
    // being reachable from the separate workflow canvas, which voice mode
    // has no way to get to mid-call.
    function onApprovalRequired(
      envelope: SocketEventEnvelope<{ approvalId: string; nodeId: string; tool: string; summary: string }>
    ) {
      if (!isActive(envelope)) return;
      const { approvalId, nodeId, tool, summary } = envelope.payload;
      setPendingApprovals((list) =>
        list.some((a) => a.approvalId === approvalId)
          ? list
          : [...list, { approvalId, nodeId, tool, summary }]
      );
      // The run pauses here — no RUN_COMPLETED will arrive, so without this
      // the orb stayed on "Working on it…" with the mic never re-armed, which
      // is exactly what made voice mode look like it had stopped listening.
      if (voiceActiveRef.current) {
        setVoiceState("listening");
        voice.resumeListening();
      }
    }
    function onApprovalResolved(envelope: SocketEventEnvelope<{ approvalId: string }>) {
      if (!isActive(envelope)) return;
      setPendingApprovals((list) => list.filter((a) => a.approvalId !== envelope.payload.approvalId));
    }

    socket.on(SOCKET_EVENTS.RUN_STARTED, onStarted);
    socket.on(SOCKET_EVENTS.NODE_STARTED, onNodeStarted);
    socket.on(SOCKET_EVENTS.RUN_COMPLETED, onCompleted);
    socket.on(SOCKET_EVENTS.RUN_FAILED, onFailed);
    socket.on(SOCKET_EVENTS.NUDGE, onNudge);
    socket.on(SOCKET_EVENTS.WEB_SEARCH_REQUEST, onWebSearchRequest);
    socket.on(SOCKET_EVENTS.APPROVAL_REQUIRED, onApprovalRequired);
    socket.on(SOCKET_EVENTS.APPROVAL_RESOLVED, onApprovalResolved);
    return () => {
      socket.off(SOCKET_EVENTS.RUN_STARTED, onStarted);
      socket.off(SOCKET_EVENTS.NODE_STARTED, onNodeStarted);
      socket.off(SOCKET_EVENTS.RUN_COMPLETED, onCompleted);
      socket.off(SOCKET_EVENTS.RUN_FAILED, onFailed);
      socket.off(SOCKET_EVENTS.NUDGE, onNudge);
      socket.off(SOCKET_EVENTS.WEB_SEARCH_REQUEST, onWebSearchRequest);
      socket.off(SOCKET_EVENTS.APPROVAL_REQUIRED, onApprovalRequired);
      socket.off(SOCKET_EVENTS.APPROVAL_RESOLVED, onApprovalResolved);
    };
  }, [voice]);

  async function sendText(text: string) {
    if (!conversationIdRef.current || !text.trim()) return;
    // A spoken/typed "yes, approve" while a write step is waiting is the
    // decision for that step — sending it as a new request instead (what used
    // to happen) left the paused run stuck and started a pointless new one.
    const decision = parseApprovalDecision(text);
    if (decision && pendingApprovals.length > 0) {
      setVoiceState("executing");
      for (const approval of pendingApprovals) {
        void decideApproval(approval.approvalId, decision === "approved" ? "approve" : "reject");
      }
      return;
    }
    // The user bubble and `activeRunId` both come from the RUN_STARTED socket
    // event (see `onStarted` above) — the single source for both this and
    // voice-triggered runs, so there's no separate optimistic append here.
    await api.post<{ runId: string }>("/api/agent/runs", { conversationId: conversationIdRef.current, text });
  }

  // The assistant finished its turn (or failed to even start speaking) —
  // re-arm the mic for the user's next turn instead of leaving the session
  // sitting idle until the orb is tapped again. A no-op in convoai mode and
  // when the session was stopped in the meantime.
  function backToListening() {
    setVoiceState(voiceActiveRef.current ? "listening" : "idle");
    if (voiceActiveRef.current) voice.resumeListening();
  }

  async function speakReply(text: string) {
    setVoiceState("speaking");
    try {
      const { audioUrl } = await api.post<{ audioUrl: string }>("/api/voice/speak", { text });
      const audio = audioRef.current;
      if (!audio) throw new Error("No audio element");
      audio.src = audioUrl;
      await audio.play();
    } catch (err) {
      console.error("Speech playback failed:", err);
      backToListening();
    }
  }

  async function decideApproval(approvalId: string, decision: "approve" | "reject") {
    const approval = pendingApprovals.find((a) => a.approvalId === approvalId);
    // Optimistic removal — the APPROVAL_RESOLVED echo will also filter it
    // out, harmlessly, once the server confirms.
    setPendingApprovals((list) => list.filter((a) => a.approvalId !== approvalId));
    try {
      await api.post(`/api/approvals/${approvalId}/${decision}`);
      setApprovalFeedback({ status: decision === "approve" ? "approved" : "rejected" });
    } catch (err) {
      // Put it back so the user can retry, and say why it didn't go through
      // instead of leaving them guessing whether it worked.
      if (approval) setPendingApprovals((list) => [...list, approval]);
      setApprovalFeedback({
        status: "error",
        message: err instanceof ApiError ? err.message : "Could not reach the server",
      });
    }
  }

  async function toggleVoice() {
    if (voiceActiveRef.current) {
      voiceActiveRef.current = false;
      await voice.stop();
      setVoiceState("idle");
      setInterimTranscript("");
      return;
    }
    if (!conversationIdRef.current) return;
    voiceActiveRef.current = true;
    setVoiceError(null);
    setVoiceState("listening");
    await voice.start(conversationIdRef.current);
    // ConvoAI speaks its own greeting server-side (`greeting_message` on the
    // join request) the instant the agent joins — only the browser-only
    // fallback needs to say something here itself.
    if (voiceActiveRef.current && !voice.isConvoAi()) {
      void speakReply(VOICE_GREETING);
    }
  }

  useEffect(() => {
    if (!approvalFeedback) return;
    const timer = setTimeout(() => setApprovalFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [approvalFeedback]);

  const isWorking = ACTIVE_STATES.includes(voiceState);

  function handleAudioEnded() {
    backToListening();
  }

  return {
    handleAudioEnded,
    conversationId,
    messages,
    voiceState,
    interimTranscript,
    voiceError,
    activeRunId,
    pendingApprovals,
    approvalFeedback,
    decideApproval,
    outputDevices,
    outputDeviceId,
    audioRef,
    isWorking,
    sendText,
    toggleVoice,
    handleOutputDeviceChange,
    setVoiceState,
  };
}
