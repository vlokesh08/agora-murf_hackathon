import { useCallback, useEffect, useMemo, useRef } from "react";
import AgoraRTC, {
  type IAgoraRTCClient,
  type IMicrophoneAudioTrack,
  type IRemoteAudioTrack,
} from "agora-rtc-sdk-ng";
import { api } from "../../lib/apiClient";

/** Output (speaker/headphone) devices available to play assistant audio
 *  through — used for both convoai mode (Agora remote track) and hybrid
 *  mode (the plain `<audio>` element playing Murf's reply). */
export async function listAudioOutputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audiooutput");
}

interface VoiceSessionResponse {
  appId: string;
  channel: string;
  uid: number;
  token: string;
  /** "convoai": Agora's Conversational AI Engine does ASR+reply+TTS itself —
   *  we just carry audio. "hybrid": no engine configured server-side, fall
   *  back to browser speech recognition + our own Murf call. */
  mode: "convoai" | "hybrid";
  /** Present when ConvoAI was configured but joining the agent failed, so the
   *  session silently downgraded to hybrid mode. */
  warning?: string;
}

interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent {
  readonly results: SpeechRecognitionResultList;
  /** Index of the first result that's new in this event — everything before
   *  it was already delivered in an earlier event. */
  readonly resultIndex: number;
}
interface SpeechRecognitionErrorEvent {
  readonly error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceSessionHandlers {
  /** A finished utterance — hybrid mode only; send it as the next message. */
  onTranscript: (text: string) => void;
  /** Live preview of what's being heard so far, not yet committed — hybrid
   *  mode only. Also doubles as the barge-in signal and as proof the mic is
   *  actually picking something up. Empty string clears any shown preview. */
  onSpeechActivity: (interimText: string) => void;
  onReconnecting: () => void;
  onError: (message: string) => void;
  /** The agent started/stopped speaking — convoai mode (audio plays itself;
   *  this is only for driving the UI's state label). */
  onAgentAudio: (speaking: boolean) => void;
  /** Hybrid mode only: one push-to-talk utterance was captured and the mic
   *  has stopped listening — the caller should go back to idle ("tap to
   *  talk") rather than keep the session open for another turn. */
  onUtteranceEnd: () => void;
}

/**
 * Voice session over Agora RTC. When the backend has Agora's Conversational
 * AI Engine configured, the agent itself joins the channel, does ASR, calls
 * our own planner via its custom-LLM callback, and speaks the reply via Murf
 * — this hook then just carries audio both ways. Otherwise it falls back to
 * the browser's Web Speech API for transcription and our own Murf call for
 * output (see `speakReply` in ConversationScreen).
 */
export function useVoiceSession(handlers: VoiceSessionHandlers) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const trackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const remoteAudioTrackRef = useRef<IRemoteAudioTrack | null>(null);
  // Remembered across the whole session (and across the agent's track being
  // republished mid-call) so a device picked once keeps applying.
  const outputDeviceIdRef = useRef<string | null>(null);
  const recognizerRef = useRef<SpeechRecognitionLike | null>(null);
  const modeRef = useRef<VoiceSessionResponse["mode"] | null>(null);
  const stoppingRef = useRef(false);
  // Hybrid-mode push-to-talk state, shared across every `beginListening()`
  // call within one session (one per utterance) rather than reset per-call —
  // promoted to refs so `resumeListening()` can re-arm the same cycle for
  // the next turn instead of only ever running once.
  const pendingTextRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utteranceCapturedRef = useRef(false);
  const silentEnvironmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveErrorsRef = useRef(0);
  const lastErrorAtRef = useRef(0);

  const stop = useCallback(async () => {
    stoppingRef.current = true;
    const recognizer = recognizerRef.current;
    recognizerRef.current = null;
    recognizer?.stop();

    trackRef.current?.close();
    trackRef.current = null;
    remoteAudioTrackRef.current = null;

    const client = clientRef.current;
    clientRef.current = null;
    if (client) await client.leave().catch(() => {});

    if (modeRef.current === "convoai") {
      await api.post("/api/voice/session/stop").catch(() => {});
    }
    modeRef.current = null;
  }, []);

  /** Switches which output device the agent's voice plays through — a no-op
   *  outside convoai mode (hybrid mode's Murf audio plays through the plain
   *  `<audio>` element instead, set via its own `setSinkId`). */
  const setOutputDevice = useCallback(async (deviceId: string) => {
    outputDeviceIdRef.current = deviceId;
    await remoteAudioTrackRef.current?.setPlaybackDevice(deviceId).catch(() => {});
  }, []);

  /** Starts (or restarts, for the next turn) one push-to-talk listening
   *  cycle: capture a single utterance, then stop and report it — hybrid
   *  mode only. Callable repeatedly within the same session via
   *  `resumeListening()`, not just once from `start()`. */
  const beginListening = useCallback(() => {
    const Recognizer = getSpeechRecognitionCtor();
    if (!Recognizer) {
      handlersRef.current.onError("Speech recognition isn't supported in this browser");
      return;
    }
    const recognizer = new Recognizer();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = "en-US";

    pendingTextRef.current = "";
    utteranceCapturedRef.current = false;
    consecutiveErrorsRef.current = 0;
    lastErrorAtRef.current = 0;
    // 1.2s was cutting people off mid-thought on a normal pause; 2s gives
    // more room without making every reply feel laggy.
    const SILENCE_MS = 2000;

    function commitPending() {
      silenceTimerRef.current = null;
      const text = pendingTextRef.current.trim();
      pendingTextRef.current = "";
      if (text) {
        utteranceCapturedRef.current = true;
        handlersRef.current.onTranscript(text);
      }
      handlersRef.current.onSpeechActivity("");
      if (utteranceCapturedRef.current) recognizer.stop();
    }

    // If recognition has genuinely heard nothing at all (not even an
    // interim result) since this cycle started, the mic/speech backend
    // likely isn't working — say so instead of sitting silent.
    const SILENT_ENVIRONMENT_MS = 12000;
    silentEnvironmentTimerRef.current = setTimeout(() => {
      handlersRef.current.onError(
        "Not picking up any speech — check mic permission, or this environment's speech backend may not work."
      );
    }, SILENT_ENVIRONMENT_MS);

    recognizer.onresult = (event) => {
      if (silentEnvironmentTimerRef.current) {
        clearTimeout(silentEnvironmentTimerRef.current);
        silentEnvironmentTimerRef.current = null;
      }
      let interimChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const chunk = result[0]?.transcript.trim() ?? "";
        if (result.isFinal) {
          if (chunk) pendingTextRef.current = pendingTextRef.current ? `${pendingTextRef.current} ${chunk}` : chunk;
        } else {
          interimChunk = interimChunk ? `${interimChunk} ${chunk}` : chunk;
        }
      }
      const preview = [pendingTextRef.current, interimChunk].filter(Boolean).join(" ");
      if (preview) handlersRef.current.onSpeechActivity(preview);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(commitPending, SILENCE_MS);
    };

    // Circuit breaker: if recognition fails repeatedly right after
    // starting (e.g. no working speech backend in this environment),
    // stop the restart loop and surface a real error instead of retrying
    // forever.
    recognizer.onerror = (event) => {
      // "no-speech"/"aborted" are routine pauses, not real failures.
      if (event.error === "no-speech" || event.error === "aborted") return;
      const now = Date.now();
      consecutiveErrorsRef.current = now - lastErrorAtRef.current < 5000 ? consecutiveErrorsRef.current + 1 : 1;
      lastErrorAtRef.current = now;
      handlersRef.current.onError(event.error);
    };
    recognizer.onend = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      commitPending();
      if (stoppingRef.current) {
        if (silentEnvironmentTimerRef.current) clearTimeout(silentEnvironmentTimerRef.current);
        return;
      }
      if (consecutiveErrorsRef.current >= 3) {
        if (silentEnvironmentTimerRef.current) clearTimeout(silentEnvironmentTimerRef.current);
        handlersRef.current.onError(
          "Speech recognition keeps failing — your mic/browser setup likely can't reach a speech backend here."
        );
        return;
      }
      if (utteranceCapturedRef.current) {
        if (silentEnvironmentTimerRef.current) clearTimeout(silentEnvironmentTimerRef.current);
        handlersRef.current.onUtteranceEnd();
        return;
      }
      // Browsers auto-stop recognition after a pause even before the user
      // has said anything yet; keep listening until an utterance lands.
      recognizer.start();
    };
    recognizer.start();
    recognizerRef.current = recognizer;
  }, []);

  /** Re-arms listening for the next turn once the assistant's reply has
   *  finished — hybrid mode only (convoai's agent listens continuously on
   *  its own); a no-op if the session was stopped or never started. */
  const resumeListening = useCallback(() => {
    if (modeRef.current !== "hybrid" || stoppingRef.current) return;
    beginListening();
  }, [beginListening]);

  const start = useCallback(
    async (conversationId: string) => {
      stoppingRef.current = false;
      try {
        const { appId, channel, uid, token, mode, warning } = await api.post<VoiceSessionResponse>(
          "/api/voice/session/start",
          { conversationId }
        );
        modeRef.current = mode;
        if (warning) console.warn("[voice] session/start:", warning);

        if (mode === "convoai") {
          const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
          client.on("connection-state-change", (curState) => {
            if (curState === "RECONNECTING") handlersRef.current.onReconnecting();
          });
          client.on("user-published", async (user, mediaType) => {
            if (mediaType !== "audio") return;
            await client.subscribe(user, "audio");
            const track = user.audioTrack;
            track?.play();
            remoteAudioTrackRef.current = track ?? null;
            if (track && outputDeviceIdRef.current) {
              await track.setPlaybackDevice(outputDeviceIdRef.current).catch(() => {});
            }
            handlersRef.current.onAgentAudio(true);
          });
          client.on("user-unpublished", (_user, mediaType) => {
            if (mediaType === "audio") {
              remoteAudioTrackRef.current = null;
              handlersRef.current.onAgentAudio(false);
            }
          });

          await client.join(appId, channel, token, uid);
          const micTrack = await AgoraRTC.createMicrophoneAudioTrack();
          await client.publish(micTrack);
          clientRef.current = client;
          trackRef.current = micTrack;
          // Agora's agent does its own ASR — no browser speech recognition needed.
          return;
        }

        // Hybrid mode has no ConvoAI agent on the other end of the channel,
        // so there is nothing to join or publish audio to — doing so anyway
        // was publishing a mic track into an empty room, which is what
        // produced the spurious WebRTC codec-negotiation errors. The
        // browser's own SpeechRecognition API captures the mic directly.
        beginListening();
      } catch (err) {
        handlersRef.current.onError(err instanceof Error ? err.message : "Could not start voice session");
        await stop();
      }
    },
    [stop, beginListening]
  );

  // Stable identity so callers can safely depend on this in a cleanup effect
  // (e.g. release the mic on unmount) without the effect re-firing every render.
  return useMemo(
    () => ({ start, stop, resumeListening, isConvoAi: () => modeRef.current === "convoai", setOutputDevice }),
    [start, stop, resumeListening, setOutputDevice]
  );
}
