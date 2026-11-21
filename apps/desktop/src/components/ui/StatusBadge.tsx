import clsx from "clsx";
import type { WorkflowNodeStatus } from "../../types/workflow";

const statusStyles: Record<WorkflowNodeStatus, string> = {
  queued: "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]",
  running: "bg-[var(--color-accent)]/20 text-[var(--color-accent-2)]",
  waiting_approval: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  completed: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
  failed: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  skipped: "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]",
  cancelled: "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]",
};

const statusLabels: Record<WorkflowNodeStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting_approval: "Waiting for approval",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

export function StatusBadge({ status }: { status: WorkflowNodeStatus }) {
  return (
    <span
      className={clsx(
        // gr8r-studio .badge: 20px tall, 7px padding, 5px radius, 12px/500.
        "inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-[7px] text-xs font-medium",
        statusStyles[status]
      )}
    >
      {statusLabels[status]}
    </span>
  );
}
