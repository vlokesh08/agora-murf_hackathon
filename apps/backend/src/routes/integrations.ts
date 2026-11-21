import { Router } from "express";
import { eq } from "drizzle-orm";
import { toggleIntegrationSchema } from "@personal-agent/shared";
import { db } from "../database/db";
import { integrations } from "../database/schema";
import { requireAuth } from "../middleware/requireAuth";
import { env } from "../config/env";
import {
  buildGoogleAuthUrl,
  disconnectGoogle,
  exchangeCodeForTokens,
  isGoogleConfigured,
  saveGoogleTokens,
} from "../integrations/google";
import {
  buildGithubAuthUrl,
  disconnectGithub,
  exchangeGithubCode,
  isGithubConfigured,
  saveGithubToken,
} from "../integrations/github";

export const integrationsRouter = Router();

const PROVIDERS = ["google_calendar", "gmail", "github"] as const;

// The OAuth callback is a top-level browser redirect, not an XHR with our
// normal headers, but the session cookie still travels with it (SameSite=Lax
// allows top-level GET navigation), so requireAuth still works.
integrationsRouter.use(requireAuth);

integrationsRouter.get("/", async (req, res) => {
  const userId = req.session!.user.id;
  const rows = await db.select().from(integrations).where(eq(integrations.userId, userId));
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  // Gmail rides on the same Google OAuth grant as Calendar (one consent,
  // both scopes), so its status just mirrors that connection.
  const googleConnected = byProvider.get("google_calendar")?.connected ?? false;
  const githubConnected = byProvider.get("github")?.connected ?? false;
  res.json(
    PROVIDERS.map((provider) => ({
      provider,
      connected: provider === "github" ? githubConnected : googleConnected,
      oauthConfigured: provider === "github" ? isGithubConfigured() : isGoogleConfigured(),
    }))
  );
});

integrationsRouter.get("/google/connect", (req, res) => {
  if (!isGoogleConfigured()) {
    res.status(501).json({ error: "Google OAuth is not configured on this server" });
    return;
  }
  const url = buildGoogleAuthUrl(req.session!.user.id);
  res.redirect(url);
});

integrationsRouter.get("/google/callback", async (req, res) => {
  const { code, state } = req.query;
  const userId = req.session!.user.id;

  if (typeof code !== "string" || state !== userId) {
    res.redirect(`${env.webOrigin}/app/integrations?error=google_oauth_failed`);
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveGoogleTokens(userId, tokens);
    res.redirect(`${env.webOrigin}/app/integrations?connected=google_calendar`);
  } catch (err) {
    console.error("Google OAuth callback failed", err);
    res.redirect(`${env.webOrigin}/app/integrations?error=google_oauth_failed`);
  }
});

integrationsRouter.get("/github/connect", (req, res) => {
  if (!isGithubConfigured()) {
    res.status(501).json({ error: "GitHub OAuth is not configured on this server" });
    return;
  }
  const url = buildGithubAuthUrl(req.session!.user.id);
  res.redirect(url);
});

integrationsRouter.get("/github/callback", async (req, res) => {
  const { code, state } = req.query;
  const userId = req.session!.user.id;

  if (typeof code !== "string" || state !== userId) {
    res.redirect(`${env.webOrigin}/app/integrations?error=github_oauth_failed`);
    return;
  }

  try {
    const accessToken = await exchangeGithubCode(code);
    await saveGithubToken(userId, accessToken);
    res.redirect(`${env.webOrigin}/app/integrations?connected=github`);
  } catch (err) {
    console.error("GitHub OAuth callback failed", err);
    res.redirect(`${env.webOrigin}/app/integrations?error=github_oauth_failed`);
  }
});

integrationsRouter.patch("/", async (req, res) => {
  const parsed = toggleIntegrationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.session!.user.id;
  const { provider, connected } = parsed.data;

  // Gmail shares the google_calendar OAuth grant — there's nothing to toggle
  // independently. Disconnecting either disconnects the one Google grant.
  if (!connected) {
    await (provider === "github" ? disconnectGithub(userId) : disconnectGoogle(userId));
    res.json({ provider, connected: false });
    return;
  }

  res.status(400).json({
    error: "Connect via /api/integrations/{google,github}/connect — this endpoint only disconnects.",
  });
});
