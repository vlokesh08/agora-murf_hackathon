import { and, eq } from "drizzle-orm";
import { db } from "../database/db";
import { tasks } from "../database/schema";
import type { ToolExecutor } from "./types";

export const createTask: ToolExecutor = async (ctx, args) => {
  const title = (args.title as string) ?? "New task";
  const [row] = await db
    .insert(tasks)
    .values({ userId: ctx.userId, title })
    .returning();
  return { id: row.id, title: row.title };
};

export const listTasks: ToolExecutor = async (ctx) => {
  const rows = await db.select().from(tasks).where(eq(tasks.userId, ctx.userId));
  return { tasks: rows.map((r) => ({ id: r.id, title: r.title, done: r.done })) };
};

export const updateTask: ToolExecutor = async (ctx, args) => {
  const id = args.id as string;
  const [row] = await db
    .update(tasks)
    .set({ title: (args.title as string) ?? undefined, updatedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.userId, ctx.userId)))
    .returning();
  return { id: row?.id, updated: Boolean(row) };
};

export const completeTask: ToolExecutor = async (ctx, args) => {
  const id = args.id as string;
  const [row] = await db
    .update(tasks)
    .set({ done: true, updatedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.userId, ctx.userId)))
    .returning();
  return { id: row?.id, done: true };
};
