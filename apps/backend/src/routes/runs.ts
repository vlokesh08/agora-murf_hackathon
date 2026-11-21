import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { startRunSchema, type WorkflowSnapshot } from "@personal-agent/shared";
import { db } from "../database/db";
import { agentRuns, conversations, userPreferences, workflowEdges, workflowNodes } from "../database/schema";
import { requireAuth } from "../middleware/requireAuth";
import { startRun } from "../agents/runEngine";
import type { AssistantMode } from "@personal-agent/shared";

export const runsRouter = Router();

runsRouter.use(requireAuth);

runsRouter.post("/", async (req, res) => {
  const parsed = startRunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.session!.user.id;

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, parsed.data.conversationId), eq(conversations.userId, userId)));
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));
  const mode = (prefs?.assistantMode ?? "professional") as AssistantMode;

  const { runId } = await startRun({
    conversationId: conversation.id,
    userId,
    text: parsed.data.text,
    mode,
  });

  res.status(201).json({ runId });
});

runsRouter.get("/:runId", async (req, res) => {
  const userId = req.session!.user.id;
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, req.params.runId), eq(agentRuns.userId, userId)));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(run);
});

runsRouter.get("/:runId/workflow", async (req, res) => {
  const userId = req.session!.user.id;
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, req.params.runId), eq(agentRuns.userId, userId)));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const [nodeRows, edgeRows] = await Promise.all([
    db.select().from(workflowNodes).where(eq(workflowNodes.runId, run.id)),
    db.select().from(workflowEdges).where(eq(workflowEdges.runId, run.id)),
  ]);

  const snapshot: WorkflowSnapshot = {
    runId: run.id,
    status: run.status as WorkflowSnapshot["status"],
    nodes: nodeRows.map((n) => ({
      id: n.id,
      runId: run.id,
      type: n.type as WorkflowSnapshot["nodes"][number]["type"],
      title: n.title,
      description: n.description,
      status: n.status as WorkflowSnapshot["nodes"][number]["status"],
      startedAt: n.startedAt?.toISOString(),
      completedAt: n.completedAt?.toISOString(),
      durationMs:
        n.startedAt && n.completedAt
          ? n.completedAt.getTime() - n.startedAt.getTime()
          : undefined,
      safeInputSummary: (n.safeInputSummary as Record<string, unknown>) ?? undefined,
      safeOutputSummary: (n.safeOutputSummary as Record<string, unknown>) ?? undefined,
      errorSummary: n.errorSummary ?? undefined,
      approvalId: n.approvalId ?? undefined,
      position: { x: n.positionX, y: n.positionY },
    })),
    edges: edgeRows.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label ?? undefined })),
  };

  res.json(snapshot);
});
