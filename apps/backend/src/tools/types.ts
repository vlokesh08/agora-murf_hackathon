export interface ToolContext {
  userId: string;
  runId: string;
  nodeId: string;
}

export type ToolExecutor = (
  ctx: ToolContext,
  args: Record<string, unknown>
) => Promise<Record<string, unknown>>;
