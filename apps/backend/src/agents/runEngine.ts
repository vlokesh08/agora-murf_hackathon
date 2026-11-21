import { and, eq } from "drizzle-orm";
import { SOCKET_EVENTS } from "@personal-agent/shared";
import { db } from "../database/db";
import { agentRuns, approvals, messages, workflowEdges, workflowNodes } from "../database/schema";
import { emitRunEvent } from "../realtime/socket";
import { runEvents, type RunSignal } from "../realtime/runEvents";
import { planFromText, type Plan } from "./planner";
import { buildWorkflow } from "./workflowBuilder";
import { compiledGraph } from "./graph";
import type { AssistantMode } from "@personal-agent/shared";

interface StartRunOptions {
  conversationId: string;
  userId: string;
  text: string;
  mode: AssistantMode;
}

function configFor(runId: string) {
  return { configurable: { thread_id: runId } };
}

export async function startRun(opts: StartRunOptions): Promise<{ runId: string }> {
  const plan = await planFromText(opts.text);
  const built = buildWorkflow(plan, opts.text);

  const [run] = await db
    .insert(agentRuns)
    .values({
      conversationId: opts.conversationId,
      userId: opts.userId,
      requestText: opts.text,
      status: "running",
      plan,
    })
    .returning();

  await db.insert(messages).values({
    conversationId: opts.conversationId,
    userId: opts.userId,
    role: "user",
    text: opts.text,
    runId: run.id,
  });

  if (built.nodes.length > 0) {
    await db.insert(workflowNodes).values(
      built.nodes.map((n) => ({
        id: n.id,
        runId: run.id,
        type: n.type,
        title: n.title,
        description: n.description,
        status: n.id === "trigger" ? "running" : "queued",
        positionX: built.positions[n.id]?.x ?? 0,
        positionY: built.positions[n.id]?.y ?? 0,
      }))
    );
  }
  if (built.edges.length > 0) {
    await db.insert(workflowEdges).values(
      built.edges.map((e) => ({ id: e.id, runId: run.id, source: e.source, target: e.target, label: e.label }))
    );
  }

  emitRunEvent(run.id, opts.conversationId, SOCKET_EVENTS.RUN_STARTED, {
    requestText: opts.text,
  });

  void executeRun(run.id, plan, opts).catch(async (err) => {
    console.error(`Run ${run.id} failed`, err);
    await db
      .update(agentRuns)
      .set({ status: "failed", errorSummary: String(err), completedAt: new Date() })
      .where(eq(agentRuns.id, run.id));
    emitRunEvent(run.id, opts.conversationId, SOCKET_EVENTS.RUN_FAILED, {
      error: String(err),
    });
  });

  return { runId: run.id };
}

async function executeRun(runId: string, plan: Plan, opts: StartRunOptions) {
  const config = configFor(runId);
  await compiledGraph.invoke(
    {
      runId,
      conversationId: opts.conversationId,
      userId: opts.userId,
      requestText: opts.text,
      mode: opts.mode,
      plan,
    },
    config
  );
  await continuePastInterruptIfNothingPending(runId);
}

// `interruptBefore: ["execute_write_steps"]` is a static breakpoint: it fires
// on every run, even when no step actually needs approval. When that's the
// case there's nothing to wait for, so resume immediately for a seamless run.
async function continuePastInterruptIfNothingPending(runId: string) {
  const state = await compiledGraph.getState(configFor(runId));
  if (state.next.length === 0) return; // already reached END

  const pending = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.runId, runId), eq(approvals.status, "pending")));
  if (pending.length === 0) {
    await resumeRun(runId);
  }
}

/** Awaits a run reaching a terminal or pausing state, for a synchronous caller
 * (the Conversational AI webhook) that can't rely on the socket/polling UI. */
export function waitForRun(runId: string, timeoutMs: number): Promise<RunSignal | { kind: "timeout" }> {
  return new Promise((resolve) => {
    const onSignal = (signal: RunSignal) => {
      clearTimeout(timer);
      resolve(signal);
    };
    const timer = setTimeout(() => {
      runEvents.off(runId, onSignal);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    runEvents.once(runId, onSignal);
  });
}

export async function resumeRun(runId: string) {
  await compiledGraph.invoke(null, configFor(runId));
}

export async function resolveApproval(
  approvalId: string,
  decision: "approved" | "rejected"
) {
  const [approval] = await db
    .update(approvals)
    .set({ status: decision, decidedAt: new Date() })
    .where(eq(approvals.id, approvalId))
    .returning();

  if (!approval) {
    throw new Error("Approval not found");
  }

  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, approval.runId));
  if (!run) throw new Error("Run not found");

  await db
    .update(workflowNodes)
    .set({ status: decision === "approved" ? "completed" : "cancelled", completedAt: new Date() })
    .where(
      and(eq(workflowNodes.runId, approval.runId), eq(workflowNodes.id, approval.nodeId))
    );

  emitRunEvent(approval.runId, run.conversationId, SOCKET_EVENTS.APPROVAL_RESOLVED, {
    approvalId,
    nodeId: approval.nodeId,
    decision,
  });

  const stillPending = await db
    .select()
    .from(approvals)
    .where(eq(approvals.runId, approval.runId));

  const hasPending = stillPending.some((a) => a.status === "pending");
  if (!hasPending) {
    try {
      await resumeRun(approval.runId);
    } catch (err) {
      // Mirrors startRun's own catch below — without this, a resume failure
      // (e.g. the in-memory LangGraph checkpoint is gone after a server
      // restart) leaves the run stuck at "waiting_approval"/"executing"
      // forever: the approval itself still succeeded, but nothing ever
      // emits a terminal event, so the UI has no way back from "Working on it".
      console.error(`Resume after approval failed for run ${approval.runId}`, err);
      await db
        .update(agentRuns)
        .set({ status: "failed", errorSummary: String(err), completedAt: new Date() })
        .where(eq(agentRuns.id, approval.runId));
      emitRunEvent(approval.runId, run.conversationId, SOCKET_EVENTS.RUN_FAILED, {
        error: String(err),
      });
    }
  }

  return { runId: approval.runId };
}
