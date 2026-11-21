export const SOCKET_EVENTS = {
  RUN_STARTED: "agent:run_started",
  STATUS_CHANGED: "agent:status_changed",
  NODE_CREATED: "workflow:node_created",
  NODE_STARTED: "workflow:node_started",
  NODE_COMPLETED: "workflow:node_completed",
  NODE_FAILED: "workflow:node_failed",
  APPROVAL_REQUIRED: "workflow:approval_required",
  APPROVAL_RESOLVED: "workflow:approval_resolved",
  RUN_COMPLETED: "agent:run_completed",
  RUN_FAILED: "agent:run_failed",
  NUDGE: "agent:nudge",
  // The backend asking the (already-open) desktop app to open its own
  // browser window and read a page, and the desktop app's reply — see
  // `realtime/toolBridge.ts`.
  WEB_SEARCH_REQUEST: "tool:web_search_request",
  WEB_SEARCH_RESPONSE: "tool:web_search_response",
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

export interface SocketEventEnvelope<T = unknown> {
  eventId: string;
  seq: number;
  runId: string;
  conversationId: string;
  timestamp: string;
  payload: T;
}
