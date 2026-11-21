import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import type { AssistantMode } from "@personal-agent/shared";
import { assistantModes, SOCKET_EVENTS } from "@personal-agent/shared";
import { createLLMProvider } from "./llmProvider";
import type { Plan, PlanStep } from "./planner";
import { approvalNodeId } from "./workflowBuilder";
import { toolRegistry } from "../tools/registry";
import {
  createApproval,
  getApprovalDecision,
  getPriorToolOutput,
  getStepOutcomes,
  markNodeCompleted,
  markNodeFailed,
  markNodeRunning,
  markNodeStatus,
  recordToolExecution,
} from "../services/workflowStore";
import { emitRunEvent } from "../realtime/socket";
import { runEvents } from "../realtime/runEvents";
import { db } from "../database/db";
import { agentRuns, messages } from "../database/schema";
import { eq } from "drizzle-orm";

export const RunState = Annotation.Root({
  runId: Annotation<string>,
  conversationId: Annotation<string>,
  userId: Annotation<string>,
  requestText: Annotation<string>,
  mode: Annotation<AssistantMode>,
  plan: Annotation<Plan>,
  responseText: Annotation<string>({ default: () => "", reducer: (_a, b) => b }),
  error: Annotation<string | undefined>({ default: () => undefined, reducer: (_a, b) => b }),
});

type State = typeof RunState.State;

function readSteps(plan: Plan) {
  return plan.steps.filter((s) => s.kind === "read");
}
function writeSteps(plan: Plan) {
  return plan.steps.filter((s) => s.kind === "write");
}
function verifySteps(plan: Plan) {
  return plan.steps.filter((s) => s.kind === "verify");
}

async function resolveArgs(runId: string, step: PlanStep): Promise<Record<string, unknown>> {
  const args = { ...(step.args ?? {}) };
  // Light data-flow: chain filesystem search results into the move step so
  // the file-organization demo actually moves a real matched file.
  if (step.tool === "filesystem.move_file" && !args.from) {
    for (const dep of step.dependsOn) {
      const output = await getPriorToolOutput(runId, dep);
      const matches = output?.matches as string[] | undefined;
      if (matches && matches.length > 0) {
        args.from = matches[0];
        args.to = `organized/${matches[0]}`;
        break;
      }
    }
  }
  // Chain the chosen slot into event creation, and the created event's id
  // into its verification step — needed for the real Google Calendar path.
  if (step.tool === "calendar.create_event" && !args.startIso) {
    for (const dep of step.dependsOn) {
      const output = await getPriorToolOutput(runId, dep);
      if (output?.startIso) {
        args.startIso = output.startIso;
        args.endIso = output.endIso;
        break;
      }
    }
  }
  if (step.tool === "calendar.verify_event" && !args.eventId) {
    for (const dep of step.dependsOn) {
      const output = await getPriorToolOutput(runId, dep);
      if (output?.eventId) {
        args.eventId = output.eventId;
        break;
      }
    }
  }
  return args;
}

async function runStep(state: State, step: PlanStep) {
  const { runId, conversationId } = state;
  await markNodeRunning(runId, conversationId, step.id);
  try {
    const args = await resolveArgs(runId, step);
    const executor = step.tool ? toolRegistry[step.tool] : undefined;
    const output = executor
      ? await executor({ userId: state.userId, runId, nodeId: step.id }, args)
      : {};
    await recordToolExecution({
      runId,
      nodeId: step.id,
      tool: step.tool ?? "none",
      input: args,
      output,
      status: "completed",
    });
    await markNodeCompleted(runId, conversationId, step.id, { input: args, output });
    return { ok: true as const, output };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool execution failed";
    await markNodeFailed(runId, conversationId, step.id, message);
    return { ok: false as const, error: message };
  }
}

async function receiveRequest(state: State) {
  await markNodeCompleted(state.runId, state.conversationId, "trigger");
  return {};
}

async function loadContext(state: State) {
  await markNodeRunning(state.runId, state.conversationId, "context");
  await markNodeCompleted(state.runId, state.conversationId, "context", {
    output: { mode: state.mode },
  });
  return {};
}

async function planNode(state: State) {
  await markNodeRunning(state.runId, state.conversationId, "plan");
  await markNodeCompleted(state.runId, state.conversationId, "plan", {
    output: { goal: state.plan.goal, steps: state.plan.steps.length },
  });
  return {};
}

async function validatePlan(state: State) {
  const unknown = state.plan.steps.find((s) => s.tool && !toolRegistry[s.tool]);
  if (unknown) {
    return { error: `Unknown tool: ${unknown.tool}` };
  }
  return {};
}

// Read steps are independent data pulls (calendar, email, GitHub, ...) with
// no dependsOn between them, so they run concurrently — like separate agents
// each fetching their own source — instead of blocking on each other. One
// source failing (not connected, API error) doesn't poison the others: it's
// recorded as a failed node and respond() reports whatever did come back.
async function executeReadSteps(state: State) {
  await Promise.all(readSteps(state.plan).map((step) => runStep(state, step)));
  return {};
}

async function approvalGate(state: State) {
  const pendingWrites = writeSteps(state.plan).filter((s) => s.approvalRequired);
  for (const step of pendingWrites) {
    await createApproval({
      runId: state.runId,
      conversationId: state.conversationId,
      nodeId: approvalNodeId(step.id),
      tool: step.tool ?? "unknown",
      summary: `Approve "${step.title}"?`,
      payload: { stepId: step.id, title: step.title },
    });
  }
  if (pendingWrites.length > 0) {
    await db
      .update(agentRuns)
      .set({ status: "waiting_approval" })
      .where(eq(agentRuns.id, state.runId));
    emitRunEvent(state.runId, state.conversationId, SOCKET_EVENTS.STATUS_CHANGED, {
      status: "waiting_approval",
    });
    runEvents.emit(state.runId, { kind: "waiting_approval", goal: state.plan.goal });
  }
  return {};
}

async function executeWriteSteps(state: State) {
  for (const step of writeSteps(state.plan)) {
    if (step.approvalRequired) {
      const decision = await getApprovalDecision(state.runId, approvalNodeId(step.id));
      if (decision?.status === "rejected") {
        await markNodeStatus(state.runId, state.conversationId, step.id, "cancelled");
        continue;
      }
    }
    const result = await runStep(state, step);
    if (!result.ok) return { error: result.error };
  }
  return {};
}

async function verify(state: State) {
  for (const step of verifySteps(state.plan)) {
    const dep = state.plan.steps.find((s) => s.id === step.dependsOn[0]);
    if (dep?.approvalRequired) {
      const decision = await getApprovalDecision(state.runId, approvalNodeId(dep.id));
      if (decision?.status === "rejected") {
        await markNodeStatus(state.runId, state.conversationId, step.id, "skipped");
        continue;
      }
    }
    const result = await runStep(state, step);
    if (!result.ok) return { error: result.error };
  }
  return {};
}

async function respond(state: State) {
  const llm = createLLMProvider();
  const tone = assistantModes[state.mode].tone;
  const status: "completed" | "failed" = state.error ? "failed" : "completed";

  const steps = await getStepOutcomes(state.runId, state.plan.steps);
  const responseText = await llm.generateResponse({
    requestText: state.requestText,
    tone,
    goal: state.plan.goal,
    steps,
    error: state.error,
  });

  await markNodeCompleted(state.runId, state.conversationId, "result", {
    output: { responseText },
  });

  await db
    .update(agentRuns)
    .set({
      status,
      responseText,
      errorSummary: state.error,
      completedAt: new Date(),
    })
    .where(eq(agentRuns.id, state.runId));

  await db.insert(messages).values({
    conversationId: state.conversationId,
    userId: state.userId,
    role: "assistant",
    text: responseText,
    runId: state.runId,
  });

  emitRunEvent(
    state.runId,
    state.conversationId,
    status === "completed" ? SOCKET_EVENTS.RUN_COMPLETED : SOCKET_EVENTS.RUN_FAILED,
    { responseText, error: state.error }
  );
  runEvents.emit(
    state.runId,
    status === "completed"
      ? { kind: "completed", responseText }
      : { kind: "failed", error: state.error }
  );

  return { responseText };
}

function afterValidate(state: State) {
  return state.error ? "respond" : "execute_read_steps";
}
function afterRead(state: State) {
  return state.error ? "respond" : "approval_gate";
}
function afterWrite(state: State) {
  return state.error ? "respond" : "verify";
}

const workflow = new StateGraph(RunState)
  .addNode("receive_request", receiveRequest)
  .addNode("load_context", loadContext)
  .addNode("create_plan", planNode)
  .addNode("validate_plan", validatePlan)
  .addNode("execute_read_steps", executeReadSteps)
  .addNode("approval_gate", approvalGate)
  .addNode("execute_write_steps", executeWriteSteps)
  .addNode("verify", verify)
  .addNode("respond", respond)
  .addEdge(START, "receive_request")
  .addEdge("receive_request", "load_context")
  .addEdge("load_context", "create_plan")
  .addEdge("create_plan", "validate_plan")
  .addConditionalEdges("validate_plan", afterValidate, ["execute_read_steps", "respond"])
  .addConditionalEdges("execute_read_steps", afterRead, ["approval_gate", "respond"])
  .addEdge("approval_gate", "execute_write_steps")
  .addConditionalEdges("execute_write_steps", afterWrite, ["verify", "respond"])
  .addEdge("verify", "respond")
  .addEdge("respond", END);

export const checkpointer = new MemorySaver();

export const compiledGraph = workflow.compile({
  checkpointer,
  interruptBefore: ["execute_write_steps"],
});
