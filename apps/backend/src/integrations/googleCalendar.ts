const API_BASE = "https://www.googleapis.com/calendar/v3";

async function callApi<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Google Calendar API error (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export type CalendarDay = "today" | "tomorrow";

function dayRange(day: CalendarDay) {
  const base = new Date();
  if (day === "tomorrow") base.setDate(base.getDate() + 1);
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function workingHoursRange(day: CalendarDay) {
  const base = new Date();
  if (day === "tomorrow") base.setDate(base.getDate() + 1);
  const start = new Date(base);
  start.setHours(9, 0, 0, 0);
  const end = new Date(base);
  end.setHours(18, 0, 0, 0);
  return { start, end };
}

interface GCalEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
}

async function listEventsBetween(accessToken: string, start: Date, end: Date) {
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const data = await callApi<{ items: GCalEvent[] }>(
    accessToken,
    `/calendars/primary/events?${params.toString()}`
  );
  return (data.items ?? []).map((e) => ({
    title: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
  }));
}

export async function listEventsForDay(accessToken: string, day: CalendarDay) {
  const { start, end } = dayRange(day);
  return listEventsBetween(accessToken, start, end);
}

/** Finds the first free 30-minute slot between 9am-6pm on the given day. */
export async function findFreeSlotForDay(accessToken: string, day: CalendarDay) {
  const { start, end } = workingHoursRange(day);
  const events = await listEventsBetween(accessToken, start, end);
  const busy = events
    .filter((e) => e.start && e.end)
    .map((e) => ({ start: new Date(e.start), end: new Date(e.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  let cursor = new Date(start);
  const slotMs = 30 * 60 * 1000;
  while (cursor.getTime() + slotMs <= end.getTime()) {
    const slotEnd = new Date(cursor.getTime() + slotMs);
    const overlaps = busy.some((b) => cursor < b.end && slotEnd > b.start);
    if (!overlaps) {
      return { startIso: cursor.toISOString(), endIso: slotEnd.toISOString() };
    }
    cursor = new Date(cursor.getTime() + slotMs);
  }
  // No gap found; default to the end of the day.
  const fallbackStart = new Date(end.getTime() - slotMs);
  return { startIso: fallbackStart.toISOString(), endIso: end.toISOString() };
}

export async function createCalendarEvent(
  accessToken: string,
  opts: {
    title: string;
    startIso: string;
    endIso: string;
    attendeeEmail?: string;
    recurrence?: string[];
  }
) {
  // Google requires an explicit IANA time zone on recurring events (a
  // UTC-offset `dateTime` alone isn't enough — RRULE expansion needs to know
  // which zone's wall-clock/DST rules to repeat in). Use this machine's own
  // zone, which for a locally-run assistant is the user's actual time zone.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = {
    summary: opts.title,
    start: { dateTime: opts.startIso, timeZone },
    end: { dateTime: opts.endIso, timeZone },
    attendees: opts.attendeeEmail ? [{ email: opts.attendeeEmail }] : undefined,
    recurrence: opts.recurrence,
  };
  const event = await callApi<GCalEvent>(accessToken, "/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { eventId: event.id, htmlLink: event.htmlLink };
}

export async function getCalendarEvent(accessToken: string, eventId: string) {
  return callApi<GCalEvent>(accessToken, `/calendars/primary/events/${eventId}`);
}
