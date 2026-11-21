import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth/auth";
import { env } from "./config/env";
import { conversationsRouter } from "./routes/conversations";
import { runsRouter } from "./routes/runs";
import { approvalsRouter } from "./routes/approvals";
import { preferencesRouter } from "./routes/preferences";
import { integrationsRouter } from "./routes/integrations";
import { voiceRouter } from "./routes/voice";

export const app = express();

app.use(cors({ origin: env.webOrigin, credentials: true }));

// Better Auth owns body parsing for its own routes; mount before express.json().
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/conversations", conversationsRouter);
app.use("/api/agent/runs", runsRouter);
app.use("/api/approvals", approvalsRouter);
app.use("/api/preferences", preferencesRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/voice", voiceRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});
