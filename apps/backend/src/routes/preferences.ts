import { Router } from "express";
import { eq } from "drizzle-orm";
import { updatePreferencesSchema } from "@personal-agent/shared";
import { db } from "../database/db";
import { userPreferences } from "../database/schema";
import { requireAuth } from "../middleware/requireAuth";

export const preferencesRouter = Router();

preferencesRouter.use(requireAuth);

preferencesRouter.get("/", async (req, res) => {
  const userId = req.session!.user.id;
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  res.json(row ?? { userId, assistantMode: "professional" });
});

preferencesRouter.patch("/", async (req, res) => {
  const parsed = updatePreferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.session!.user.id;
  const [row] = await db
    .insert(userPreferences)
    .values({ userId, assistantMode: parsed.data.assistantMode ?? "professional" })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { assistantMode: parsed.data.assistantMode ?? "professional", updatedAt: new Date() },
    })
    .returning();
  res.json(row);
});
