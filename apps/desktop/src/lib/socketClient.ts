import { io, type Socket } from "socket.io-client";
import { API_BASE_URL } from "./config";

let socket: Socket | undefined;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE_URL, { withCredentials: true, autoConnect: true });
  }
  return socket;
}

export function joinRun(runId: string) {
  getSocket().emit("join_run", runId);
}

export function leaveRun(runId: string) {
  getSocket().emit("leave_run", runId);
}

export function joinConversation(conversationId: string) {
  getSocket().emit("join_conversation", conversationId);
}

export function leaveConversation(conversationId: string) {
  getSocket().emit("leave_conversation", conversationId);
}
