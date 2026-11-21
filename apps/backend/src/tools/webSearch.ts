import { eq } from "drizzle-orm";
import { db } from "../database/db";
import { agentRuns } from "../database/schema";
import { requestWebSearchFromClient } from "../realtime/socket";
import type { ToolExecutor } from "./types";

/** The backend has no browser of its own — it asks the user's open desktop
 *  app to open its own window and read the page (see `main.cts`'s
 *  `web-search` IPC handler), then reads back whatever it found. */
export const searchWeb: ToolExecutor = async (ctx, args) => {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { error: "No search query provided", source: "web_search" };

  const [run] = await db
    .select({ conversationId: agentRuns.conversationId })
    .from(agentRuns)
    .where(eq(agentRuns.id, ctx.runId));
  if (!run) return { query, error: "Could not resolve conversation for this run", source: "web_search" };

  const result = await requestWebSearchFromClient(run.conversationId, ctx.userId, query);
  if (result.error) return { query, error: result.error, source: "web_search" };
  return { query, resultText: result.resultText, source: "web_search" };
};
