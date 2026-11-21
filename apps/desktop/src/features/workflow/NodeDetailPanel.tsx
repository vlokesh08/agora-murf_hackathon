import { Button } from "../../components/ui/Button";
import { StatusBadge } from "../../components/ui/StatusBadge";
import type { WorkflowNodeView } from "../../types/workflow";

export function NodeDetailPanel({
  node,
  onClose,
  onApprove,
  onReject,
}: {
  node: WorkflowNodeView;
  onClose: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <aside className="h-full w-80 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="eyebrow">{node.type}</p>
          <h3 className="mt-0.5 font-semibold">{node.title}</h3>
        </div>
        <button
          onClick={onClose}
          className="-mr-1.5 grid size-[30px] shrink-0 place-items-center rounded-md text-[var(--color-text-dim)] transition-colors duration-[140ms] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          aria-label="Close details"
        >
          ✕
        </button>
      </div>

      <StatusBadge status={node.status} />

      <p className="mt-4 text-base text-[var(--color-text-dim)]">{node.description}</p>

      {(node.startedAt || node.durationMs) && (
        <div className="mt-4 space-y-1 text-xs text-[var(--color-text-dim)]">
          {node.startedAt && <p>Started: {new Date(node.startedAt).toLocaleTimeString()}</p>}
          {node.durationMs && <p>Duration: {(node.durationMs / 1000).toFixed(1)}s</p>}
        </div>
      )}

      {node.safeOutputSummary && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-[var(--color-text-dim)]">Result</p>
          <pre className="overflow-x-auto rounded-lg bg-[var(--color-surface-2)] p-3 text-xs">
            {JSON.stringify(node.safeOutputSummary, null, 2)}
          </pre>
        </div>
      )}

      {node.errorSummary && (
        <div className="mt-4 rounded-lg bg-[var(--color-danger)]/10 p-3 text-xs text-[var(--color-danger)]">
          {node.errorSummary}
        </div>
      )}

      {node.status === "waiting_approval" && node.approvalId && (
        <div className="mt-6 flex gap-2">
          <Button onClick={() => onApprove(node.approvalId!)}>Approve</Button>
          <Button variant="secondary" onClick={() => onReject(node.approvalId!)}>
            Reject
          </Button>
        </div>
      )}
    </aside>
  );
}
