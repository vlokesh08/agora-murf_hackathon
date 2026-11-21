import { and, eq } from "drizzle-orm";
import { db } from "../database/db";
import { approvals, toolExecutions, workflowNodes } from "../database/schema";
import type { WorkflowNodeStatus } from "@personal-agent/shared";
import { SOCKET_EVENTS } from "@personal-agent/shared";
import { emitRunEvent } from "../realtime/socket";

async function patchNode(
  runId: string,
  nodeId: string,
  patch: Partial<{
    status: WorkflowNodeStatus;
    safeInputSummary: Record<string, unknown>;
    safeOutputSummary: Record<string, unknown>;
    errorSummary: string;
    startedAt: Date;
    completedAt: Date;
    approvalId: string;
  }>
) {
  await db
    .update(workflowNodes)
    .set(patch)
    .where(and(eq(workflowNodes.runId, runId), eq(workflowNodes.id, nodeId)));
}

export async function markNodeRunning(
  runId: string,
  conversationId: string,
  nodeId: string
) {
  await patchNode(runId, nodeId, { status: "running", startedAt: new Date() });
  emitRunEvent(runId, conversationId, SOCKET_EVENTS.NODE_STARTED, { nodeId });
}

export async function markNodeCompleted(
  runId: string,
  conversationId: string,
  nodeId: string,
  summary?: { input?: Record<string, unknown>; output?: Record<string, unknown> }
) {
  await patchNode(runId, nodeId, {
    status: "completed",
    completedAt: new Date(),
    ...(summary?.input ? { safeInputSummary: summary.input } : {}),
    ...(summary?.output ? { safeOutputSummary: summary.output } : {}),
  });
  emitRunEvent(runId, conversationId, SOCKET_EVENTS.NODE_COMPLETED, {
    nodeId,
    output: summary?.output,
  });
}

export async function markNodeFailed(
  runId: string,
  conversationId: string,
  nodeId: string,
  errorSummary: string
) {
  await patchNode(runId, nodeId, { status: "failed", completedAt: new Date(), errorSummary });
  emitRunEvent(runId, conversationId, SOCKET_EVENTS.NODE_FAILED, { nodeId, errorSummary });
}

export async function markNodeStatus(
  runId: string,
  conversationId: string,
  nodeId: string,
  status: WorkflowNodeStatus
) {
  await patchNode(runId, nodeId, { status, completedAt: new Date() });
  emitRunEvent(runId, conversationId, SOCKET_EVENTS.NODE_COMPLETED, { nodeId, status });
}

export async function createApproval(opts: {
  runId: string;
  conversationId: string;
  nodeId: string;
  tool: string;
  summary: string;
  payload?: Record<string, unknown>;
}) {
  const [row] = await db
    .insert(approvals)
    .values({
      runId: opts.runId,
      nodeId: opts.nodeId,
      tool: opts.tool,
      summary: opts.summary,
      payload: opts.payload,
    })
    .returning();

  await patchNode(opts.runId, opts.nodeId, { status: "waiting_approval", approvalId: row.id });
  emitRunEvent(opts.runId, opts.conversationId, SOCKET_EVENTS.APPROVAL_REQUIRED, {
    approvalId: row.id,
    nodeId: opts.nodeId,
    tool: opts.tool,
    summary: opts.summary,
  });
  return row.id;
}

export async function getApprovalDecision(runId: string, nodeId: string) {
  const [row] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.runId, runId), eq(approvals.nodeId, nodeId)));
  return row ?? null;
}

export async function recordToolExecution(opts: {
  runId: string;
  nodeId: string;
  tool: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  status: "completed" | "failed";
}) {
  await db.insert(toolExecutions).values({
    runId: opts.runId,
    nodeId: opts.nodeId,
    tool: opts.tool,
    inputSummary: opts.input,
    outputSummary: opts.output,
    status: opts.status,
  });
}

export async function getPriorToolOutput(runId: string, nodeId: string) {
  const [row] = await db
    .select()
    .from(toolExecutions)
    .where(and(eq(toolExecutions.runId, runId), eq(toolExecutions.nodeId, nodeId)));
  return (row?.outputSummary as Record<string, unknown> | undefined) ?? undefined;
}

export async function getStepOutcomes(
  runId: string,
  steps: { id: string; title: string }[]
) {
  const rows = await db.select().from(workflowNodes).where(eq(workflowNodes.runId, runId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return steps.map((s) => ({
    title: s.title,
    status: byId.get(s.id)?.status ?? "queued",
    output: (byId.get(s.id)?.safeOutputSummary as Record<string, unknown> | undefined) ?? undefined,
  }));
}
