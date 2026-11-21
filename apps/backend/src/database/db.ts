import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { env } from "../config/env";
import * as schema from "./schema";

function createDb() {
  if (env.databaseUrl) {
    // Real Postgres (e.g. Neon). Neon's pooler requires TLS.
    const pool = new Pool({ connectionString: env.databaseUrl, ssl: { rejectUnauthorized: true } });
    return drizzleNodePg(pool, { schema });
  }

  // Zero-setup fallback: embedded Postgres-compatible database on disk.
  const client = new PGlite(env.pgliteDataDir);
  return drizzlePglite(client, { schema });
}

export const db = createDb();
