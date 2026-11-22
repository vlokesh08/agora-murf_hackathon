import { useCallback, useEffect, useMemo, useRef } from "react";
import AgoraRTC, {
  type IAgoraRTCClient,
  type IMicrophoneAudioTrack,
  type IRemoteAudioTrack,
} from "agora-rtc-sdk-ng";
import { api } from "../../lib/apiClient";
import { API_BASE_URL } from "../../lib/config";

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
   *  back to recording the mic here and transcribing it via the backend. */
  mode: "convoai" | "hybrid";
  /** Present when ConvoAI was configured but joining the agent failed, so the
   *  session silently downgraded to hybrid mode. */
  warning?: string;
}

export interface VoiceSessionHandlers {
  /** A finished utterance — hybrid mode only; send it as the next message. */
  onTranscript: (text: string) => void;
  /** Live preview of what's being heard so far, not yet committed — hybrid
   *  mode only. Empty string clears any shown preview. */
  onSpeechActivity: (interimText: string) => void;
  onReconnecting: () => void;
  /** Fatal for this session (mic blocked, session failed to start). */
  onError: (message: string) => void;
  /** Recoverable — shown to the user, but the session keeps listening. */
  onWarning?: (message: string) => void;
  /** The agent started/stopped speaking — convoai mode (audio plays itself;
   *  this is only for driving the UI's state label). */
  onAgentAudio: (speaking: boolean) => void;
  /** Hybrid mode only: one utterance was captured and the mic has stopped
   *  listening for it. */
  onUtteranceEnd: () => void;
  /** Live mic input level, 0..1 — hybrid mode only. */
  onMicLevel?: (level: number) => void;
  /** Which backend the session actually ended up on, plus any downgrade
   *  reason — surfaced in the UI instead of only the console. */
  onMode?: (mode: "convoai" | "hybrid", warning?: string) => void;
}

// Hybrid-mode listening: record one utterance, cut it at natural silence and
// transcribe it with the backend's Whisper endpoint. Input below SPEECH_RMS (a
// quiet room, a fan, keyboard clatter) never starts an utterance, so ambient
// noise can't be mistaken for a request — which is exactly what the browser's
// Web Speech API used to do here.
const SPEECH_RMS = 0.012;
const SILENCE_MS = 1200;
const MIN_SPEECH_MS = 350;
const MAX_UTTERANCE_MS = 20_000;
/** Whisper's placeholder output for non-speech audio. */
const NON_SPEECH_TRANSCRIPT = /^\[?\(?(blank_?audio|silence|music|noise|inaudible)\)?\]?$/i;

/**
 * Voice session over Agora RTC. When the backend has Agora's Conversational
 * AI Engine configured, the agent itself joins the channel, does ASR, calls
 * our own planner via its custom-LLM callback, and speaks the reply via Murf
 * — this hook then just carries audio both ways. Otherwise it records each
 * utterance locally and transcribes it through `/api/voice/transcribe`, with
 * our own Murf call for output (see `speakReply` in the controller).
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
  const modeRef = useRef<VoiceSessionResponse["mode"] | null>(null);
  const stoppingRef = useRef(false);

  // Hybrid-mode listening state.
  const listeningRef = useRef(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserDataRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const levelRef = useRef(0);
  const monitorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speechStartedAtRef = useRef(0);
  const lastLoudAtRef = useRef(0);

  function stopMonitor() {
    if (monitorTimerRef.current) {
      clearTimeout(monitorTimerRef.current);
      monitorTimerRef.current = null;
    }
  }

  async function ensureMic() {
    const existing = micStreamRef.current;
    if (existing && existing.getAudioTracks().some((t) => t.readyState === "live")) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    micStreamRef.current = stream;

    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    await ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    analyserDataRef.current = new Float32Array(analyser.fftSize);
  }

  function startRecorder() {
    const stream = micStreamRef.current;
    if (!stream) return;
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) =>
      MediaRecorder.isTypeSupported(type)
    );
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.start();
    recorderRef.current = recorder;
  }

  /** Cuts the recording, sends it for transcription, and hands the text to
   *  the caller as the next message. Re-arms listening if nothing usable came
   *  back, so the mic never silently dies. */
  async function finishUtterance() {
    if (!listeningRef.current) return;
    listeningRef.current = false;
    stopMonitor();
    speechStartedAtRef.current = 0;
    lastLoudAtRef.current = 0;

    const recorder = recorderRef.current;
    recorderRef.current = null;
    const blob = await new Promise<Blob>((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        resolve(new Blob(chunksRef.current, { type: recorder?.mimeType || "audio/webm" }));
        return;
      }
      recorder.onstop = () =>
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
      recorder.stop();
    });
    chunksRef.current = [];
    handlersRef.current.onSpeechActivity("");
    handlersRef.current.onUtteranceEnd();

    if (stoppingRef.current) return;
    if (blob.size === 0) {
      beginListening();
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/voice/transcribe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Transcription failed (${res.status})`);
      }
      const { text } = (await res.json()) as { text?: string };
      const transcript = (text ?? "").trim();
      if (!transcript || NON_SPEECH_TRANSCRIPT.test(transcript)) {
        handlersRef.current.onWarning?.("I didn't catch any words there — try again.");
        beginListening();
        return;
      }
      handlersRef.current.onTranscript(transcript);
    } catch (err) {
      console.error("[voice] transcription failed", err);
      handlersRef.current.onWarning?.(
        err instanceof Error ? err.message : "Couldn't transcribe that — try again."
      );
      beginListening();
    }
  }

  function monitor() {
    const analyser = analyserRef.current;
    const data = analyserDataRef.current;
    if (!analyser || !data || !listeningRef.current) return;

    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    levelRef.current = levelRef.current * 0.5 + rms * 0.5;

    const now = performance.now();
    if (rms > SPEECH_RMS) {
      if (!speechStartedAtRef.current) speechStartedAtRef.current = now;
      lastLoudAtRef.current = now;
    }
    handlersRef.current.onMicLevel?.(Math.min(1, levelRef.current * 12));

    const startedAt = speechStartedAtRef.current;
    if (
      startedAt &&
      now - startedAt > MIN_SPEECH_MS &&
      (now - lastLoudAtRef.current > SILENCE_MS || now - startedAt > MAX_UTTERANCE_MS)
    ) {
      void finishUtterance();
      return;
    }
    monitorTimerRef.current = setTimeout(monitor, 60);
  }

  /** Starts (or restarts, for the next turn) one listening cycle: wait for
   *  speech to begin, record until the user pauses, then transcribe it —
   *  hybrid mode only. */
  const beginListening = useCallback(() => {
    if (modeRef.current !== "hybrid" || stoppingRef.current) return;
    if (listeningRef.current) return;
    void (async () => {
      try {
        await ensureMic();
      } catch (err) {
        console.error("[voice] mic unavailable", err);
        handlersRef.current.onError(
          "Microphone access is blocked — allow mic access for this app and try again."
        );
        return;
      }
      if (stoppingRef.current || modeRef.current !== "hybrid") return;
      listeningRef.current = true;
      speechStartedAtRef.current = 0;
      lastLoudAtRef.current = 0;
      levelRef.current = 0;
      startRecorder();
      monitor();
    })();
    // All state lives in refs, so the identity only needs to be stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(async () => {
    stoppingRef.current = true;
    listeningRef.current = false;
    stopMonitor();

    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // already stopped
      }
    }
    chunksRef.current = [];
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    analyserRef.current = null;
    analyserDataRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx) void ctx.close().catch(() => {});
    handlersRef.current.onMicLevel?.(0);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Switches which output device the agent's voice plays through — a no-op
   *  outside convoai mode (hybrid mode's Murf audio plays through the plain
   *  `<audio>` element instead, set via its own `setSinkId`). */
  const setOutputDevice = useCallback(async (deviceId: string) => {
    outputDeviceIdRef.current = deviceId;
    await remoteAudioTrackRef.current?.setPlaybackDevice(deviceId).catch(() => {});
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
        handlersRef.current.onMode?.(mode, warning);
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
          // Agora's agent does its own ASR — no local recording needed.
          return;
        }

        // Hybrid mode has no ConvoAI agent on the other end of the channel, so
        // there is nothing to join or publish audio to. Listening happens
        // locally and the audio is transcribed by our backend.
        beginListening();
      } catch (err) {
        handlersRef.current.onError(
          err instanceof Error ? err.message : "Could not start voice session"
        );
        await stop();
      }
    },
    [stop, beginListening]
  );

  // Stable identity so callers can safely depend on this in a cleanup effect
  // (e.g. release the mic on unmount) without the effect re-firing every render.
  return useMemo(
    () => ({
      start,
      stop,
      resumeListening,
      isConvoAi: () => modeRef.current === "convoai",
      setOutputDevice,
    }),
    [start, stop, resumeListening, setOutputDevice]
  );
}
