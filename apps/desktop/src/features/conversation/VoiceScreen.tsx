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
    voiceState,
    interimTranscript,
    voiceError,
    audioRef,
    toggleVoice,
    handleAudioEnded,
    pendingApprovals,
    approvalFeedback,
    decideApproval,
  } = useConversationController();

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

      <div className="flex flex-col items-center gap-8">
        <VoiceOrb state={voiceState} onClick={toggleVoice} size="w-56" />

        <div className="flex max-w-md flex-col items-center gap-2 px-6 text-center">
          <p className="text-sm font-medium text-[var(--color-text-dim)]">{statusLabels[voiceState]}</p>
          {interimTranscript && (
            <p className="text-base text-[var(--color-text)]">{interimTranscript}</p>
          )}
          {voiceError && <p className="text-sm text-[var(--color-danger)]">{voiceError}</p>}
        </div>
      </div>

      <audio ref={audioRef} hidden onEnded={handleAudioEnded} />
      <ApprovalDock approvals={pendingApprovals} feedback={approvalFeedback} onDecide={decideApproval} />
    </div>
  );
}
