import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ArrowUp, Bot, User } from "lucide-react";
import {
  Message,
  MessageAvatar,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
  MessageHeader,
  MessageScroller,
  MessageTyping,
} from "@/components/agents/message";
import { Sidebar } from "../../components/Sidebar";
import { Button } from "../../components/ui/Button";
import type { VoiceState } from "../../types/workflow";
import { ApprovalDock } from "./ApprovalDock";
import { useConversationController } from "./useConversationController";
import { VoiceOrb } from "./VoiceOrb";

const statusLabels: Record<VoiceState, string> = {
  idle: "Ready",
  listening: "Listening",
  transcribing: "Transcribing",
  planning: "Planning",
  executing: "Executing",
  speaking: "Speaking",
  interrupted: "Interrupted",
  reconnecting: "Reconnecting",
  error: "Something went wrong",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ConversationScreen() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const listeningBubbleRef = useRef<HTMLDivElement | null>(null);

  const {
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
    handleAudioEnded,
  } = useConversationController();

  // The listening bubble isn't part of `messages`, so MessageScroller's own
  // follow-output logic (keyed on message list changes) can miss it — and in
  // practice it reliably did, leaving the view stuck on whatever was
  // previously scrolled into place while the bubble rendered off-screen
  // below. Scroll it into view directly the instant it mounts, rather than
  // depending on that heuristic to catch up.
  useEffect(() => {
    if (voiceState === "listening") {
      listeningBubbleRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [voiceState]);

  function submitDraft() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void sendText(text);
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    submitDraft();
  }

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-2.5">
          <div>
            <h1 className="text-sm font-semibold">Conversation</h1>
            <p className="text-xs text-[var(--color-text-dim)]">
              Talk or type — I'll ask before anything irreversible.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => navigate("/app/voice")}>
              Voice mode
            </Button>
            {outputDevices.length > 0 && (
              <select
                aria-label="Audio output device"
                value={outputDeviceId}
                onChange={(e) => void handleOutputDeviceChange(e.target.value)}
                className="h-6 rounded-[5px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 text-xs text-[var(--color-text-dim)]"
              >
                {outputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Output ${d.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
            )}
            <span
              className={clsx(
                "inline-flex h-5 items-center whitespace-nowrap rounded-[5px] px-[7px] text-xs font-medium",
                voiceState === "idle"
                  ? "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]"
                  : "bg-[var(--color-accent)]/15 text-[var(--color-accent-2)]"
              )}
            >
              {statusLabels[voiceState]}
            </span>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-hidden px-6 py-6">
          <MessageScroller className="mx-auto h-full max-w-2xl" label="Conversation" busy={isWorking}>
            <div className="flex flex-col gap-4">
              {messages.map((m) => (
                <Message key={m.id} from={m.role} animateIn>
                  <MessageAvatar>
                    {m.role === "user" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                  </MessageAvatar>
                  <MessageContent>
                    <MessageHeader>
                      <span>{m.role === "user" ? "You" : "Assistant"}</span>
                      <span>{formatTime(m.createdAt)}</span>
                    </MessageHeader>
                    <MessageBubble variant={m.role === "user" ? "solid" : "soft"}>
                      <MessageBubbleContent>{m.text}</MessageBubbleContent>
                    </MessageBubble>
                  </MessageContent>
                </Message>
              ))}

              {voiceState === "listening" && (
                <div ref={listeningBubbleRef}>
                  <Message from="user" animateIn>
                    <MessageAvatar>
                      <User className="size-3.5" />
                    </MessageAvatar>
                    <MessageContent>
                      <MessageBubble variant="solid">
                        <MessageBubbleContent>
                          {interimTranscript || <MessageTyping />}
                        </MessageBubbleContent>
                      </MessageBubble>
                    </MessageContent>
                  </Message>
                </div>
              )}

              {isWorking && voiceState !== "listening" && (
                <Message from="assistant">
                  <MessageAvatar>
                    <Bot className="size-3.5" />
                  </MessageAvatar>
                  <MessageContent>
                    <MessageBubble variant="soft">
                      <MessageBubbleContent>
                        <MessageTyping />
                      </MessageBubbleContent>
                    </MessageBubble>
                  </MessageContent>
                </Message>
              )}

              {activeRunId && (
                <div className="flex justify-start pl-9">
                  <Button variant="secondary" onClick={() => navigate(`/app/workflow?runId=${activeRunId}`)}>
                    Show workflow
                  </Button>
                </div>
              )}
            </div>
          </MessageScroller>
        </main>

        <footer className="px-6 py-3">
          {voiceError && (
            <p className="mx-auto mb-2 max-w-2xl text-xs text-[var(--color-danger)]">{voiceError}</p>
          )}
          <div className="mx-auto flex max-w-2xl items-end gap-3">
            <VoiceOrb state={voiceState} onClick={toggleVoice} />
            <form onSubmit={handleSend} className="composer min-w-0 flex-1">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter inserts a newline (textarea default).
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitDraft();
                  }
                }}
                placeholder="Ask a follow-up…"
                rows={2}
                aria-label="Message"
                className="composer-input"
              />
              <button type="submit" aria-label="Send message" className="composer-send">
                <ArrowUp className="size-5" aria-hidden="true" />
              </button>
            </form>
          </div>
        </footer>

        <audio ref={audioRef} hidden onEnded={handleAudioEnded} />
      </div>
      <ApprovalDock approvals={pendingApprovals} feedback={approvalFeedback} onDecide={decideApproval} />
    </div>
  );
}
