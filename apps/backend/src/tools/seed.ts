import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";

// Seeds a couple of demo files so the "organize files in Downloads" plan has
// something real to find and move inside the sandbox on a fresh checkout.
export async function seedSandbox() {
  const entries = await fs.readdir(env.fsSandboxDir).catch(() => []);
  if (entries.length > 0) return;

  await fs.writeFile(path.join(env.fsSandboxDir, "resume.pdf"), "demo pdf contents");
  await fs.writeFile(path.join(env.fsSandboxDir, "invoice.pdf"), "demo pdf contents");
  await fs.writeFile(path.join(env.fsSandboxDir, "notes.txt"), "demo text file");
}
