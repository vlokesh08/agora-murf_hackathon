import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../database/db";
import { env } from "../config/env";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  secret: env.betterAuthSecret,
  baseURL: env.betterAuthUrl,
  trustedOrigins: [env.webOrigin],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
  },
});

export type Session = typeof auth.$Infer.Session;
