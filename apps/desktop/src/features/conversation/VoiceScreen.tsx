import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import type { VoiceState } from "../../types/workflow";
import { ApprovalDock } from "./ApprovalDock";
import { useConversationController } from "./useConversationController";
import { VoiceOrb } from "./VoiceOrb";

const statusLabels: Record<VoiceState, string> = {
  idle: "Tap to talk",
  listening: "Listening…",
  transcribing: "Listening…",
  planning: "Thinking…",
  executing: "Working on it…",
  speaking: "Speaking…",
  interrupted: "Go ahead…",
  reconnecting: "Reconnecting…",
  error: "Something went wrong",
};

/**
 * A pure voice-conversation screen: nothing but the orb, centered, and
 * whatever's being heard or said right now — no message history, no
 * composer. Switching here from the full chat screen stops that screen's
 * voice session (each owns its own via `useConversationController`) and
 * starts a fresh one here instead.
 */
export function VoiceScreen() {
  const navigate = useNavigate();
  const {
    messages,
    voiceState,
    interimTranscript,
    voiceError,
    voiceMode,
    voiceWarning,
    micLevel,
    audioRef,
    toggleVoice,
    handleAudioEnded,
    pendingApprovals,
    approvalFeedback,
    decideApproval,
  } = useConversationController();

  // The voice-only screen has no transcript, so a reply whose audio failed to
  // play used to be completely invisible. Always show the latest one too.
  const lastReply = [...messages].reverse().find((m) => m.role === "assistant")?.text;
  const showMicMeter =
    voiceMode === "hybrid" && (voiceState === "listening" || voiceState === "transcribing");

  return (
    <div className="relative flex h-screen flex-col items-center justify-center bg-[var(--color-bg)]">
      <button
        type="button"
        onClick={() => navigate("/app")}
        aria-label="Exit voice mode"
        className="absolute right-6 top-6 grid size-9 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-dim)] transition-colors hover:text-[var(--color-text)]"
      >
        <X className="size-4" aria-hidden="true" />
      </button>

      <div className="flex max-h-full flex-col items-center gap-6 overflow-y-auto px-6 py-10">
        <VoiceOrb state={voiceState} onClick={toggleVoice} size="w-56" />

        <div className="flex max-w-md flex-col items-center gap-2 text-center">
          <p className="text-sm font-medium text-[var(--color-text-dim)]">{statusLabels[voiceState]}</p>

          {showMicMeter && (
            <div className="flex w-40 items-center gap-2" aria-label="Microphone input level">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                  className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-100"
                  style={{ width: `${Math.round(micLevel * 100)}%` }}
                />
              </div>
              <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-dim)]">mic</span>
            </div>
          )}

          {voiceMode && (
            <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-dim)]">
              {voiceMode === "convoai" ? "Agora agent" : "Local mic · Whisper"}
            </p>
          )}

          {interimTranscript && (
            <p className="text-base text-[var(--color-text)]">{interimTranscript}</p>
          )}
          {lastReply && (
            <p className="mt-1 line-clamp-4 text-sm text-[var(--color-text)]">{lastReply}</p>
          )}
          {voiceWarning && <p className="text-xs text-[var(--color-warning)]">{voiceWarning}</p>}
          {voiceError && <p className="text-sm text-[var(--color-danger)]">{voiceError}</p>}
        </div>
      </div>

      <audio ref={audioRef} hidden onEnded={handleAudioEnded} />
      <ApprovalDock approvals={pendingApprovals} feedback={approvalFeedback} onDecide={decideApproval} />
    </div>
  );
}
