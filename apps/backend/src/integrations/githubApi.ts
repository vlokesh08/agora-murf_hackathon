const API_BASE = "https://api.github.com";

async function callApi<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

interface GithubNotification {
  id: string;
  reason: string;
  unread: boolean;
  updated_at: string;
  subject: { title: string; type: string };
  repository: { full_name: string };
}

/** Lists unread GitHub notifications (PR reviews, mentions, assignments, etc). */
export async function listUnreadNotifications(accessToken: string) {
  const data = await callApi<GithubNotification[]>(accessToken, "/notifications?all=false&per_page=20");
  return data.map((n) => ({
    id: n.id,
    reason: n.reason,
    title: n.subject.title,
    type: n.subject.type,
    repo: n.repository.full_name,
    updatedAt: n.updated_at,
  }));
}
