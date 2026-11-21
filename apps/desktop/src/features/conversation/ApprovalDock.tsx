import { Check, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PendingApproval } from "./useConversationController";

/**
 * A pending write action (send email, create event, move files, ...) waiting
 * on a yes/no — pinned to the bottom-right of whichever screen is open
 * (conversation or voice-only) so approving never requires leaving the
 * conversation to go find it in the separate workflow canvas.
 */
export function ApprovalDock({
  approvals,
  feedback,
  onDecide,
}: {
  approvals: PendingApproval[];
  feedback?: { status: "approved" | "rejected" | "error"; message?: string } | null;
  onDecide: (approvalId: string, decision: "approve" | "reject") => void;
}) {
  if (approvals.length === 0 && !feedback) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-80 flex-col gap-2">
      {feedback && (
        <div
          className={`pointer-events-auto rounded-xl border p-3 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.28)] ${
            feedback.status === "error"
              ? "border-[var(--color-danger)] bg-[var(--color-surface)] text-[var(--color-danger)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
          }`}
        >
          {feedback.status === "approved" && "Approved"}
          {feedback.status === "rejected" && "Rejected"}
          {feedback.status === "error" && (feedback.message ?? "Couldn't save that decision — try again.")}
        </div>
      )}
      {approvals.map((a) => (
        <div
          key={a.approvalId}
          className="pointer-events-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
        >
          <p className="text-xs font-medium text-[var(--color-accent-2)]">Needs your approval</p>
          <p className="mt-1 text-sm text-[var(--color-text)]">{a.summary}</p>
          <p className="mt-1 text-xs text-[var(--color-text-dim)]">
            Tap Approve, or just say “approve” (or “reject”).
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="danger" onClick={() => onDecide(a.approvalId, "reject")}>
              <X className="size-3.5" aria-hidden="true" />
              Reject
            </Button>
            <Button onClick={() => onDecide(a.approvalId, "approve")}>
              <Check className="size-3.5" aria-hidden="true" />
              Approve
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
