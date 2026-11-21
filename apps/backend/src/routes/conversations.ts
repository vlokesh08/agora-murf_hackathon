import { Router } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { createConversationSchema } from "@personal-agent/shared";
import { db } from "../database/db";
import { conversations, messages } from "../database/schema";
import { requireAuth } from "../middleware/requireAuth";

export const conversationsRouter = Router();

conversationsRouter.use(requireAuth);

conversationsRouter.post("/", async (req, res) => {
  const parsed = createConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.session!.user.id;
  const [row] = await db
    .insert(conversations)
    .values({ userId, title: parsed.data.title ?? "New conversation" })
    .returning();
  res.status(201).json(row);
});

conversationsRouter.get("/", async (req, res) => {
  const userId = req.session!.user.id;
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt));
  res.json(rows);
});

conversationsRouter.get("/:id", async (req, res) => {
  const userId = req.session!.user.id;
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, req.params.id), eq(conversations.userId, userId)));
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(asc(messages.createdAt));
  res.json({ conversation, messages: rows });
});
