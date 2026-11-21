import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import clsx from "clsx";
import type { WorkflowSnapshot } from "@personal-agent/shared";
import { SOCKET_EVENTS } from "@personal-agent/shared";
import { Button } from "../../components/ui/Button";
import { api } from "../../lib/apiClient";
import { getSocket, joinRun } from "../../lib/socketClient";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { WorkflowListView } from "./WorkflowListView";
import { WorkflowNode } from "./WorkflowNode";

const nodeTypes = { workflowNode: WorkflowNode };

export function WorkflowCanvas() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const runId = params.get("runId");

  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [view, setView] = useState<"canvas" | "list">("canvas");

  const refresh = useCallback(async () => {
    if (!runId) return;
    const data = await api.get<WorkflowSnapshot>(`/api/agent/runs/${runId}/workflow`);
    setSnapshot(data);
  }, [runId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!runId) return;
    joinRun(runId);
    const socket = getSocket();
    const events = [
      SOCKET_EVENTS.NODE_STARTED,
      SOCKET_EVENTS.NODE_COMPLETED,
      SOCKET_EVENTS.NODE_FAILED,
      SOCKET_EVENTS.APPROVAL_REQUIRED,
      SOCKET_EVENTS.APPROVAL_RESOLVED,
      SOCKET_EVENTS.RUN_COMPLETED,
      SOCKET_EVENTS.RUN_FAILED,
      SOCKET_EVENTS.STATUS_CHANGED,
    ];
    // Reload the authoritative snapshot on any event rather than patching
    // client-side state — simple, and resilient to a missed event.
    const handler = () => void refresh();
    for (const evt of events) socket.on(evt, handler);
    return () => {
      for (const evt of events) socket.off(evt, handler);
    };
  }, [runId, refresh]);

  const nodes = useMemo(() => snapshot?.nodes ?? [], [snapshot]);
  const edges = useMemo(() => snapshot?.edges ?? [], [snapshot]);
  const selectedNode = nodes.find((n) => n.id === selectedId);

  const flowNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: "workflowNode",
        position: n.position,
        data: n as unknown as Record<string, unknown>,
        selected: n.id === selectedId,
      })),
    [nodes, selectedId]
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: nodes.find((n) => n.id === e.source)?.status === "running",
        style: { stroke: "var(--color-border)" },
      })),
    [edges, nodes]
  );

  async function decide(approvalId: string, decision: "approve" | "reject") {
    await api.post(`/api/approvals/${approvalId}/${decision}`);
    await refresh();
  }

  if (!runId) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg)] text-sm text-[var(--color-text-dim)]">
        No run selected.{" "}
        <button className="ml-2 text-[var(--color-accent-2)]" onClick={() => navigate("/app")}>
          Back to conversation
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex h-[46px] items-center justify-between border-b border-[var(--color-border)] pl-6 pr-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate("/app")}>
            ← Back to conversation
          </Button>
          <h1 className="text-sm font-semibold">Workflow</h1>
        </div>
        {/* gr8r-studio .seg: 2px inset, 24px segments on a 5px radius. */}
        <div className="flex gap-0.5 rounded-md bg-[var(--color-surface)] p-0.5">
          {(["canvas", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={clsx(
                "h-6 rounded-[5px] px-2.5 text-xs font-medium capitalize transition-colors duration-[140ms]",
                view === v
                  ? "bg-[var(--color-surface-2)] text-[var(--color-text)] shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_var(--color-border)]"
                  : "text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          {view === "canvas" ? (
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId(undefined)}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background color="var(--color-border)" gap={24} />
              <Controls showInteractive={false} />
            </ReactFlow>
          ) : (
            <div className="h-full overflow-y-auto">
              <WorkflowListView
                nodes={nodes}
                selectedId={selectedId}
                onSelect={(n) => setSelectedId(n.id)}
              />
            </div>
          )}
        </div>

        {selectedNode && (
          <NodeDetailPanel
            node={selectedNode}
            onClose={() => setSelectedId(undefined)}
            onApprove={(approvalId) => void decide(approvalId, "approve")}
            onReject={(approvalId) => void decide(approvalId, "reject")}
          />
        )}
      </div>
    </div>
  );
}
