import { Handle, Position, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import { StatusBadge } from "../../components/ui/StatusBadge";
import type { WorkflowNodeView } from "../../types/workflow";

const typeAccent: Record<WorkflowNodeView["type"], string> = {
  trigger: "border-l-[var(--color-accent-2)]",
  context: "border-l-[var(--color-text-dim)]",
  agent: "border-l-[var(--color-accent)]",
  tool: "border-l-[var(--color-success)]",
  condition: "border-l-[var(--color-warning)]",
  approval: "border-l-[var(--color-warning)]",
  retry: "border-l-[var(--color-danger)]",
  verification: "border-l-[var(--color-accent-2)]",
  result: "border-l-[var(--color-accent)]",
};

export function WorkflowNode({ data, selected }: NodeProps) {
  const node = data as unknown as WorkflowNodeView;
  return (
    <div
      className={clsx(
        "w-60 rounded-lg border border-l-4 bg-[var(--color-surface)] p-3 shadow-sm",
        typeAccent[node.type],
        selected ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-[var(--color-text-dim)]" />
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="eyebrow">{node.type}</span>
        <StatusBadge status={node.status} />
      </div>
      <p className="font-medium leading-snug">{node.title}</p>
      <Handle type="source" position={Position.Right} className="!bg-[var(--color-text-dim)]" />
    </div>
  );
}
