import { z } from "zod";
import { env } from "../config/env";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function toIso(year: number, monthIndex: number, day: number) {
  const d = new Date(year, monthIndex, day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parses "today"/"yesterday"/"tomorrow", "20th november 2026", "november 20, 2026" or an ISO date; defaults to today. */
function regexFallback(requestText: string): string {
  const text = requestText.toLowerCase();
  const now = new Date();

  if (text.includes("yesterday")) {
    now.setDate(now.getDate() - 1);
    return toIso(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (text.includes("tomorrow")) {
    now.setDate(now.getDate() + 1);
    return toIso(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const monthPattern = MONTHS.join("|");
  const dayMonthYear = text.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\.?,?\\s*(\\d{4})?\\b`)
  );
  if (dayMonthYear) {
    const [, day, month, year] = dayMonthYear;
    return toIso(year ? Number(year) : now.getFullYear(), MONTHS.indexOf(month), Number(day));
  }

  const monthDayYear = text.match(
    new RegExp(`\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})?\\b`)
  );
  if (monthDayYear) {
    const [, month, day, year] = monthDayYear;
    return toIso(year ? Number(year) : now.getFullYear(), MONTHS.indexOf(month), Number(day));
  }

  return toIso(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Extracts the day (YYYY-MM-DD) a request is asking about, defaulting to today. */
export async function extractEmailDate(requestText: string): Promise<string> {
  const fallback = regexFallback(requestText);
  if (!env.groqApiKey) return fallback;

  try {
    const today = new Date();
    const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate());
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
              `Today's date is ${todayIso}. The user is asking about emails from some day. ` +
              'Respond with ONLY a JSON object, no prose, no markdown fences: {"date": "YYYY-MM-DD"} ' +
              "for the single day they mean. Default to today if no day is mentioned.",
          },
          { role: "user", content: requestText },
        ],
        max_tokens: 60,
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

    const parsed = z.object({ date: dateSchema }).safeParse(JSON.parse(jsonMatch[0]));
    return parsed.success ? parsed.data.date : fallback;
  } catch {
    return fallback;
  }
}
