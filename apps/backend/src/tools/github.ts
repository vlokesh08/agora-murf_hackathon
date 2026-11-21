import { getGithubAccessToken } from "../integrations/github";
import { listUnreadNotifications } from "../integrations/githubApi";
import type { ToolExecutor } from "./types";

// Mock data used only when the user hasn't connected GitHub yet.
const MOCK_NOTIFICATIONS = [
  { id: "notif_1", reason: "review_requested", title: "Fix flaky login test", type: "PullRequest", repo: "acme/web", updatedAt: new Date().toISOString() },
  { id: "notif_2", reason: "mention", title: "Should we bump the Node version?", type: "Issue", repo: "acme/infra", updatedAt: new Date().toISOString() },
];

export const listNotifications: ToolExecutor = async (ctx) => {
  const token = await getGithubAccessToken(ctx.userId);
  if (token) {
    const notifications = await listUnreadNotifications(token);
    return { notifications, source: "github" };
  }
  return { notifications: MOCK_NOTIFICATIONS, source: "mock" };
};
