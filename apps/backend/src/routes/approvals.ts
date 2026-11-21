import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../database/db";
import { agentRuns, approvals } from "../database/schema";
import { requireAuth } from "../middleware/requireAuth";
import { resolveApproval } from "../agents/runEngine";

export const approvalsRouter = Router();

approvalsRouter.use(requireAuth);

async function assertOwnedApproval(approvalId: string, userId: string) {
  const [row] = await db
    .select({ approvalId: approvals.id, runUserId: agentRuns.userId, status: approvals.status })
    .from(approvals)
    .innerJoin(agentRuns, eq(agentRuns.id, approvals.runId))
    .where(eq(approvals.id, approvalId));
  if (!row || row.runUserId !== userId) return null;
  return row;
}

approvalsRouter.post("/:approvalId/approve", async (req, res) => {
  const owned = await assertOwnedApproval(req.params.approvalId, req.session!.user.id);
  if (!owned) {
    res.status(404).json({ error: "Approval not found" });
    return;
  }
  if (owned.status !== "pending") {
    res.status(409).json({ error: "Approval already decided" });
    return;
  }
  const result = await resolveApproval(req.params.approvalId, "approved");
  res.json(result);
});

approvalsRouter.post("/:approvalId/reject", async (req, res) => {
  const owned = await assertOwnedApproval(req.params.approvalId, req.session!.user.id);
  if (!owned) {
    res.status(404).json({ error: "Approval not found" });
    return;
  }
  if (owned.status !== "pending") {
    res.status(409).json({ error: "Approval already decided" });
    return;
  }
  const result = await resolveApproval(req.params.approvalId, "rejected");
  res.json(result);
});
