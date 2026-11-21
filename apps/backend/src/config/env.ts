import "dotenv/config";
import path from "node:path";

function resolveFromCwd(p: string) {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL,
  pgliteDataDir: resolveFromCwd(process.env.PGLITE_DATA_DIR ?? "./var/pgdata"),
  betterAuthSecret: process.env.BETTER_AUTH_SECRET ?? "dev-only-change-me",
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:4000",
  fsSandboxDir: resolveFromCwd(process.env.FS_SANDBOX_DIR ?? "./var/sandbox"),
  groqApiKey: process.env.GROQ_API_KEY,
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  githubClientId: process.env.GITHUB_CLIENT_ID,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  agoraAppId: process.env.AGORA_APP_ID,
  agoraAppCertificate: process.env.AGORA_APP_CERTIFICATE,
  murfApiKey: process.env.MURF_API_KEY,
  murfVoiceId: process.env.MURF_VOICE_ID ?? "en-US-natalie",
  // The URL Agora's cloud can reach for the Conversational AI "custom LLM"
  // callback — needs a tunnel (ngrok/cloudflared) in local dev since Agora
  // can't call back into localhost.
  publicBackendUrl: process.env.PUBLIC_BACKEND_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:4000",
  voiceWebhookSecret: process.env.VOICE_WEBHOOK_SECRET ?? "dev-only-change-me",
};
