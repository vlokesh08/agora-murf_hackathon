import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import { SOCKET_EVENTS } from "@personal-agent/shared";
import { auth } from "../auth/auth";
import { db } from "../database/db";
import { agentRuns, conversations } from "../database/schema";
import { env } from "../config/env";
import { toolEvents, type ToolBridgeResult } from "./toolEvents";

let io: Server | undefined;

// Tracks who a web-search bridge request was issued for, so a reply can
// only be accepted from that same user's socket — otherwise any connected
// client could spoof a result for someone else's pending tool call.
const pendingToolRequests = new Map<string, { userId: string }>();

export function createSocketServer(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.webOrigin, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(socket.handshake.headers),
      });
      if (!session) {
        next(new Error("Unauthorized"));
        return;
      }
      socket.data.userId = session.user.id;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    socket.on("join_run", async (runId: string) => {
      if (typeof runId !== "string") return;
      const [run] = await db
        .select({ userId: agentRuns.userId })
        .from(agentRuns)
        .where(eq(agentRuns.id, runId));
      if (run && run.userId === socket.data.userId) {
        socket.join(`run:${runId}`);
      }
    });

    socket.on("leave_run", (runId: string) => {
      if (typeof runId === "string") socket.leave(`run:${runId}`);
    });

    // Lets a conversation screen hear every run on that conversation, even
    // one it didn't start itself — e.g. a voice turn Agora's Conversational
    // AI Engine triggers via the backend's own webhook, not this client.
    socket.on("join_conversation", async (conversationId: string) => {
      if (typeof conversationId !== "string") return;
      const [conversation] = await db
        .select({ userId: conversations.userId })
        .from(conversations)
        .where(eq(conversations.id, conversationId));
      if (conversation && conversation.userId === socket.data.userId) {
        socket.join(`conversation:${conversationId}`);
      }
    });

    socket.on("leave_conversation", (conversationId: string) => {
      if (typeof conversationId === "string") socket.leave(`conversation:${conversationId}`);
    });

    socket.on(
      SOCKET_EVENTS.WEB_SEARCH_RESPONSE,
      (payload: { requestId?: string; resultText?: string; error?: string }) => {
        const requestId = payload?.requestId;
        if (typeof requestId !== "string") return;
        const pending = pendingToolRequests.get(requestId);
        if (!pending || pending.userId !== socket.data.userId) return;
        pendingToolRequests.delete(requestId);
        toolEvents.emit(requestId, { resultText: payload.resultText, error: payload.error });
      }
    );
  });

  return io;
}

let seq = 0;

export function emitRunEvent<T>(
  runId: string,
  conversationId: string,
  event: string,
  payload: T
) {
  if (!io) return;
  seq += 1;
  io.to(`run:${runId}`)
    .to(`conversation:${conversationId}`)
    .emit(event, {
    eventId: `evt_${Date.now()}_${seq}`,
    seq,
    runId,
    conversationId,
    timestamp: new Date().toISOString(),
    payload,
  });
}

const TOOL_BRIDGE_TIMEOUT_MS = 20_000;

/** Asks the user's own open desktop app to run a web search (it has the real
 *  browser window; the backend doesn't) and waits for its reply. Resolves
 *  with an error, never rejects, if the app isn't connected or doesn't
 *  answer in time — the tool executor decides how to report that. */
export function requestWebSearchFromClient(
  conversationId: string,
  userId: string,
  query: string
): Promise<ToolBridgeResult> {
  if (!io) return Promise.resolve({ error: "Realtime server is not running" });

  const requestId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  pendingToolRequests.set(requestId, { userId });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingToolRequests.delete(requestId);
      toolEvents.off(requestId, onResult);
      resolve({ error: "Desktop app didn't respond in time — is it open?" });
    }, TOOL_BRIDGE_TIMEOUT_MS);

    function onResult(result: ToolBridgeResult) {
      clearTimeout(timer);
      resolve(result);
    }
    toolEvents.once(requestId, onResult);

    io!.to(`conversation:${conversationId}`).emit(SOCKET_EVENTS.WEB_SEARCH_REQUEST, { requestId, query });
  });
}

/** An unprompted message — no run behind it, so there's no `run:${id}` room
 *  to also target; only the conversation itself is listening for this. */
export function emitNudge(conversationId: string, text: string) {
  if (!io) return;
  seq += 1;
  io.to(`conversation:${conversationId}`).emit(SOCKET_EVENTS.NUDGE, {
    eventId: `evt_${Date.now()}_${seq}`,
    seq,
    runId: "",
    conversationId,
    timestamp: new Date().toISOString(),
    payload: { text },
  });
}
