import { and, eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../database/db";
import { integrations } from "../database/schema";

const AUTH_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const SCOPE = "repo notifications read:user";

export function isGithubConfigured() {
  return Boolean(env.githubClientId && env.githubClientSecret);
}

export function githubRedirectUri() {
  return `${env.betterAuthUrl}/api/integrations/github/callback`;
}

export function buildGithubAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: env.githubClientId!,
    redirect_uri: githubRedirectUri(),
    scope: SCOPE,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeGithubCode(code: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: env.githubClientId!,
      client_secret: env.githubClientSecret!,
      code,
      redirect_uri: githubRedirectUri(),
    }),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(`GitHub token exchange failed: ${data.error_description ?? data.error ?? "unknown error"}`);
  }
  return data.access_token;
}

export async function saveGithubToken(userId: string, accessToken: string) {
  const [existing] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "github")));

  if (existing) {
    await db
      .update(integrations)
      .set({ connected: true, accessToken, scopes: [SCOPE], updatedAt: new Date() })
      .where(eq(integrations.id, existing.id));
  } else {
    await db.insert(integrations).values({
      userId,
      provider: "github",
      connected: true,
      accessToken,
      scopes: [SCOPE],
    });
  }
}

/** GitHub's classic OAuth App tokens don't expire, so this is just a lookup. */
export async function getGithubAccessToken(userId: string): Promise<string | null> {
  if (!isGithubConfigured()) return null;

  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "github")));

  if (!row || !row.connected || !row.accessToken) return null;
  return row.accessToken;
}

export async function disconnectGithub(userId: string) {
  await db
    .update(integrations)
    .set({ connected: false, accessToken: null })
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "github")));
}
