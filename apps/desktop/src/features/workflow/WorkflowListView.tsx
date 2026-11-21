import clsx from "clsx";
import { StatusBadge } from "../../components/ui/StatusBadge";
import type { WorkflowNodeView } from "../../types/workflow";

export function WorkflowListView({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: WorkflowNodeView[];
  selectedId?: string;
  onSelect: (node: WorkflowNodeView) => void;
}) {
  return (
    <ol className="mx-auto max-w-xl space-y-2 p-6">
      {nodes.map((node, i) => (
        <li key={node.id}>
          <button
            onClick={() => onSelect(node)}
            className={clsx(
              "flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-left transition-colors duration-[140ms]",
              selectedId === node.id
                ? "border-[var(--color-accent)]"
                : "border-[var(--color-border)] hover:border-[var(--color-text-dim)]"
            )}
          >
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--color-text-dim)]">{i + 1}</span>
              <div>
                <p className="font-medium">{node.title}</p>
                <p className="text-xs text-[var(--color-text-dim)]">{node.type}</p>
              </div>
            </div>
            <StatusBadge status={node.status} />
          </button>
        </li>
      ))}
    </ol>
  );
}
