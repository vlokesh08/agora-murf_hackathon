export type {
  AssistantMode,
  WorkflowNodeStatus,
  WorkflowNodeType,
  WorkflowNodeView,
  WorkflowEdgeView,
  WorkflowSnapshot,
} from "@personal-agent/shared";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export type VoiceState =
  | "idle"
  | "listening"
  | "transcribing"
  | "planning"
  | "executing"
  | "speaking"
  | "interrupted"
  | "reconnecting"
  | "error";
