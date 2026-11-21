import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import type { ToolExecutor } from "./types";

// Every filesystem tool is restricted to this sandbox directory. Paths are
// resolved and checked to stay inside it, defending against traversal
// (`../..`) and symlink escapes, per the blueprint's safety rules.
async function resolveSafePath(relativePath: string): Promise<string> {
  const base = await fs.realpath(env.fsSandboxDir).catch(async () => {
    await fs.mkdir(env.fsSandboxDir, { recursive: true });
    return fs.realpath(env.fsSandboxDir);
  });

  const target = path.resolve(base, relativePath || ".");
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("Path escapes the sandbox directory");
  }

  // Resolve symlinks for anything that already exists, and re-check.
  const resolved = await fs.realpath(target).catch(() => target);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error("Path escapes the sandbox directory (symlink)");
  }
  return target;
}

export const listDirectory: ToolExecutor = async (_ctx, args) => {
  const dir = await resolveSafePath((args.path as string) ?? ".");
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return {
    path: path.relative(env.fsSandboxDir, dir) || ".",
    entries: entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
  };
};

export const searchFiles: ToolExecutor = async (_ctx, args) => {
  const dir = await resolveSafePath((args.path as string) ?? ".");
  const pattern = ((args.extension as string) ?? ".pdf").toLowerCase();
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const matches = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(pattern))
    .map((e) => e.name);
  return { pattern, matches };
};

export const readFile: ToolExecutor = async (_ctx, args) => {
  const file = await resolveSafePath(args.path as string);
  const content = await fs.readFile(file, "utf8");
  return { path: args.path, content: content.slice(0, 4000) };
};

export const createDirectory: ToolExecutor = async (_ctx, args) => {
  const dir = await resolveSafePath(args.path as string);
  await fs.mkdir(dir, { recursive: true });
  return { path: args.path, created: true };
};

export const moveFile: ToolExecutor = async (_ctx, args) => {
  const from = await resolveSafePath(args.from as string);
  const to = await resolveSafePath(args.to as string);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
  return { from: args.from, to: args.to, moved: true };
};

export const renameFile: ToolExecutor = async (_ctx, args) => {
  const from = await resolveSafePath(args.from as string);
  const to = await resolveSafePath(args.to as string);
  await fs.rename(from, to);
  return { from: args.from, to: args.to, renamed: true };
};
