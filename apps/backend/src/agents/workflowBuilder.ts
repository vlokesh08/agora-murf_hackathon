import type { WorkflowEdgeView, WorkflowNodeType } from "@personal-agent/shared";
import type { Plan, PlanStep } from "./planner";

export interface BuiltNode {
  id: string;
  type: WorkflowNodeType;
  title: string;
  description: string;
  tool?: PlanStep["tool"];
}

export interface BuiltWorkflow {
  nodes: BuiltNode[];
  edges: WorkflowEdgeView[];
  positions: Record<string, { x: number; y: number }>;
}

const STEP_NODE_TYPE: Record<PlanStep["kind"], WorkflowNodeType> = {
  read: "tool",
  write: "tool",
  verify: "verification",
  respond: "result",
};

export function approvalNodeId(stepId: string) {
  return `approval_${stepId}`;
}

export function buildWorkflow(plan: Plan, requestText: string): BuiltWorkflow {
  const nodes: BuiltNode[] = [
    { id: "trigger", type: "trigger", title: "User request", description: requestText },
    { id: "context", type: "context", title: "Load context", description: "Retrieve preferences and recent context." },
    { id: "plan", type: "agent", title: "Plan", description: `Goal: ${plan.goal}` },
  ];

  const edges: WorkflowEdgeView[] = [
    { id: "e_trigger_context", source: "trigger", target: "context" },
    { id: "e_context_plan", source: "context", target: "plan" },
  ];

  const isDependedOn = new Set<string>();
  for (const s of plan.steps) for (const d of s.dependsOn) isDependedOn.add(d);

  for (const s of plan.steps) {
    nodes.push({
      id: s.id,
      type: STEP_NODE_TYPE[s.kind],
      title: s.title,
      description: s.tool ? `Tool: ${s.tool}` : s.title,
      tool: s.tool,
    });

    const sources = s.dependsOn.length > 0 ? s.dependsOn : ["plan"];

    if (s.approvalRequired) {
      const approvalId = approvalNodeId(s.id);
      nodes.push({
        id: approvalId,
        type: "approval",
        title: `Approval: ${s.title}`,
        description: `Waiting for you to confirm "${s.title}".`,
      });
      for (const src of sources) {
        edges.push({ id: `e_${src}_${approvalId}`, source: src, target: approvalId, label: "needs approval" });
      }
      edges.push({ id: `e_${approvalId}_${s.id}`, source: approvalId, target: s.id, label: "approved" });
    } else {
      for (const src of sources) {
        edges.push({ id: `e_${src}_${s.id}`, source: src, target: s.id });
      }
    }
  }

  nodes.push({ id: "result", type: "result", title: "Final response", description: "Summarize the outcome." });

  const leafStepIds =
    plan.steps.length > 0
      ? plan.steps.filter((s) => !isDependedOn.has(s.id)).map((s) => s.id)
      : ["plan"];
  for (const leaf of leafStepIds) {
    edges.push({ id: `e_${leaf}_result`, source: leaf, target: "result" });
  }

  const positions = layoutByLevel(nodes.map((n) => n.id), edges, "trigger");

  return { nodes, edges, positions };
}

function layoutByLevel(
  nodeIds: string[],
  edges: WorkflowEdgeView[],
  rootId: string
): Record<string, { x: number; y: number }> {
  const level: Record<string, number> = { [rootId]: 0 };
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target]);
  }

  // Longest-path levelling via repeated relaxation (graph is a small DAG).
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      const sourceLevel = level[e.source];
      if (sourceLevel === undefined) continue;
      const candidate = sourceLevel + 1;
      if (level[e.target] === undefined || candidate > level[e.target]) {
        level[e.target] = candidate;
        changed = true;
      }
    }
  }

  const byLevel = new Map<number, string[]>();
  for (const id of nodeIds) {
    const lvl = level[id] ?? 0;
    byLevel.set(lvl, [...(byLevel.get(lvl) ?? []), id]);
  }

  const positions: Record<string, { x: number; y: number }> = {};
  for (const [lvl, ids] of byLevel) {
    ids.forEach((id, i) => {
      positions[id] = { x: lvl * 260, y: i * 140 };
    });
  }
  return positions;
}
