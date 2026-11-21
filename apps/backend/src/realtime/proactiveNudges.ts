import { and, desc, eq } from "drizzle-orm";
import { db } from "../database/db";
import { conversations, integrations, messages } from "../database/schema";
import { getValidAccessToken } from "../integrations/google";
import { listEventsForDay } from "../integrations/googleCalendar";
import { emitNudge } from "./socket";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const LOOKAHEAD_MS = 15 * 60 * 1000;

// Lost on restart — an already-nudged event just risks one repeat nudge,
// which is harmless (not a safety-relevant dedupe).
const alreadyNudged = new Set<string>();

function formatStartTime(startIso: string) {
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return "soon";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

async function checkUser(userId: string) {
  const token = await getValidAccessToken(userId);
  if (!token) return;

  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  if (!conversation) return;

  const events = await listEventsForDay(token, "today").catch(() => []);
  const now = Date.now();
  for (const event of events) {
    if (!event.start) continue;
    const startMs = new Date(event.start).getTime();
    const key = `${userId}:${event.start}:${event.title}`;
    if (startMs < now || startMs - now > LOOKAHEAD_MS || alreadyNudged.has(key)) continue;

    alreadyNudged.add(key);
    const text = `Heads up — "${event.title}" starts at ${formatStartTime(event.start)}, coming up soon.`;
    await db.insert(messages).values({
      conversationId: conversation.id,
      userId,
      role: "assistant",
      text,
    });
    emitNudge(conversation.id, text);
  }
}

/** Polls connected users' calendars for events starting soon and pushes an
 *  unprompted message into their most recent conversation — the assistant
 *  "talking first" instead of only answering when asked. Only one trigger
 *  type for now (upcoming calendar events); no weather/other source wired
 *  up here yet. */
export function startProactiveNudges() {
  async function tick() {
    const connected = await db
      .select({ userId: integrations.userId })
      .from(integrations)
      .where(and(eq(integrations.provider, "google_calendar"), eq(integrations.connected, true)));
    for (const row of connected) {
      await checkUser(row.userId).catch((err) => {
        console.error("Proactive nudge check failed for user", row.userId, err);
      });
    }
  }
  setInterval(() => void tick(), CHECK_INTERVAL_MS);
  void tick();
}
