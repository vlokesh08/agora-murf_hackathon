import { createServer } from "node:http";
import fs from "node:fs/promises";
import { app } from "./app";
import { env } from "./config/env";
import { createSocketServer } from "./realtime/socket";
import { startProactiveNudges } from "./realtime/proactiveNudges";
import { seedSandbox } from "./tools/seed";

async function main() {
  await fs.mkdir(env.fsSandboxDir, { recursive: true });
  await seedSandbox();

  const httpServer = createServer(app);
  createSocketServer(httpServer);
  startProactiveNudges();

  httpServer.listen(env.port, () => {
    console.log(`Backend listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start backend", err);
  process.exit(1);
});
