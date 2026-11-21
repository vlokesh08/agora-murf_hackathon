import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;

export default databaseUrl
  ? defineConfig({
      schema: "./src/database/schema.ts",
      out: "./drizzle",
      dialect: "postgresql",
      dbCredentials: { url: databaseUrl },
    })
  : defineConfig({
      schema: "./src/database/schema.ts",
      out: "./drizzle",
      dialect: "postgresql",
      driver: "pglite",
      dbCredentials: { url: process.env.PGLITE_DATA_DIR ?? "./var/pgdata" },
    });
