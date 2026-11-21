import { z } from "zod";

export const workflowNodeStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);
export type WorkflowNodeStatus = z.infer<typeof workflowNodeStatusSchema>;

export const workflowNodeTypeSchema = z.enum([
  "trigger",
  "context",
  "agent",
  "tool",
  "condition",
  "approval",
  "retry",
  "verification",
  "result",
]);
export type WorkflowNodeType = z.infer<typeof workflowNodeTypeSchema>;

export const workflowNodeViewSchema = z.object({
  id: z.string(),
  runId: z.string(),
  type: workflowNodeTypeSchema,
  title: z.string(),
  description: z.string(),
  status: workflowNodeStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().optional(),
  safeInputSummary: z.record(z.string(), z.unknown()).optional(),
  safeOutputSummary: z.record(z.string(), z.unknown()).optional(),
  errorSummary: z.string().optional(),
  approvalId: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
});
export type WorkflowNodeView = z.infer<typeof workflowNodeViewSchema>;

export const workflowEdgeViewSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
});
export type WorkflowEdgeView = z.infer<typeof workflowEdgeViewSchema>;

export const workflowSnapshotSchema = z.object({
  runId: z.string(),
  status: z.enum(["running", "waiting_approval", "completed", "failed", "cancelled"]),
  nodes: z.array(workflowNodeViewSchema),
  edges: z.array(workflowEdgeViewSchema),
});
export type WorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>;
