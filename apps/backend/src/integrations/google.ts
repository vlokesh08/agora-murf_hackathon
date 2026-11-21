import { and, eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../database/db";
import { integrations } from "../database/schema";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const SCOPES = [CALENDAR_SCOPE, GMAIL_SCOPE];

export function isGoogleConfigured() {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

export function redirectUri() {
  return `${env.betterAuthUrl}/api/integrations/google/callback`;
}

export function buildGoogleAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: env.googleClientId!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId!,
      client_secret: env.googleClientSecret!,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  return res.json() as Promise<TokenResponse>;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId!,
      client_secret: env.googleClientSecret!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  return res.json() as Promise<TokenResponse>;
}

export async function saveGoogleTokens(userId: string, tokens: TokenResponse) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const [existing] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "google_calendar")));

  if (existing) {
    await db
      .update(integrations)
      .set({
        connected: true,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? existing.refreshToken,
        expiresAt,
        scopes: SCOPES,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, existing.id));
  } else {
    await db.insert(integrations).values({
      userId,
      provider: "google_calendar",
      connected: true,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      scopes: SCOPES,
    });
  }
}

/** Returns a valid access token for the user's connected Google Calendar, refreshing if needed, or null if not connected. */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  if (!isGoogleConfigured()) return null;

  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "google_calendar")));

  if (!row || !row.connected || !row.accessToken) return null;

  const expiresSoon = !row.expiresAt || row.expiresAt.getTime() - Date.now() < 60_000;
  if (!expiresSoon) return row.accessToken;

  if (!row.refreshToken) return row.accessToken; // best effort; may be expired

  const refreshed = await refreshAccessToken(row.refreshToken);
  await db
    .update(integrations)
    .set({
      accessToken: refreshed.access_token,
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, row.id));
  return refreshed.access_token;
}

export async function disconnectGoogle(userId: string) {
  await db
    .update(integrations)
    .set({ connected: false, accessToken: null, refreshToken: null, expiresAt: null })
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "google_calendar")));
}
