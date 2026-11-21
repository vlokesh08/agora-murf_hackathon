import { z } from "zod";
import { env } from "../config/env";

export interface ReminderDetails {
  title: string;
  hour: number;
  minute: number;
  days: number;
}

const reminderSchema = z.object({
  title: z.string().min(1).max(100),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59).default(0),
  days: z.number().int().min(1).max(30).default(7),
});

function regexFallback(requestText: string): ReminderDetails {
  const text = requestText.toLowerCase();

  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  let hour = 9;
  let minute = 0;
  if (timeMatch) {
    hour = Number(timeMatch[1]) % 12;
    minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
    if (timeMatch[3] === "pm") hour += 12;
  }

  let days = 1;
  const weekMatch = text.match(/(\d+)\s*week/);
  const dayMatch = text.match(/(\d+)\s*day/);
  if (weekMatch) days = Number(weekMatch[1]) * 7;
  else if (dayMatch) days = Number(dayMatch[1]);
  else if (text.includes("week")) days = 7;

  let title = requestText
    .replace(/.*?\bremind(er)?\b[:,]?\s*/i, "")
    .replace(/\b(me|that|to|i|should|be|getting|get)\b/gi, " ")
    .replace(/\d{1,2}(:\d{2})?\s*(am|pm)/gi, "")
    .replace(/every day|daily|each day|next (one |a )?week|for (a |one )?week|\d+\s*(day|week)s?/gi, "")
    .replace(/\b(notification|calendar|calender|saying|kind of thing|in the morning)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) title = "Reminder";
  title = title.charAt(0).toUpperCase() + title.slice(1);

  return { title, hour, minute, days };
}

export async function extractReminderDetails(requestText: string): Promise<ReminderDetails> {
  const fallback = regexFallback(requestText);
  if (!env.groqApiKey) return fallback;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.groqApiKey}`,
      },
      body: JSON.stringify({
        model: env.groqModel,
        messages: [
          {
            role: "system",
            content:
              "Extract a recurring reminder from the user's message. Respond with ONLY a JSON object, no prose, no markdown fences: " +
              '{"title": string (short label for the reminder, e.g. "Drink water"), ' +
              '"hour": number (0-23, 24-hour clock), "minute": number (0-59), ' +
              '"days": number (how many consecutive days it should repeat, e.g. 7 for "next week")}.',
          },
          { role: "user", content: requestText },
        ],
        max_tokens: 200,
        temperature: 0,
        reasoning_effort: "low",
      }),
    });
    if (!res.ok) return fallback;

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return fallback;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = reminderSchema.safeParse(JSON.parse(jsonMatch[0]));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}
