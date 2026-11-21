import { getValidAccessToken } from "../integrations/google";
import {
  createCalendarEvent,
  findFreeSlotForDay,
  getCalendarEvent,
  listEventsForDay,
  type CalendarDay,
} from "../integrations/googleCalendar";
import type { ToolExecutor } from "./types";

// Mock data used only when the user hasn't connected Google Calendar yet
// (Phase 5 integration not authorized). Clearly fake, deterministic.
const MOCK_EVENTS = [
  { title: "Standup", start: "09:00", end: "09:15" },
  { title: "Design review", start: "11:00", end: "12:00" },
  { title: "1:1 with manager", start: "15:00", end: "15:30" },
];

function readDay(args: Record<string, unknown>): CalendarDay {
  return args.day === "tomorrow" ? "tomorrow" : "today";
}

function mockSlot(day: CalendarDay) {
  const base = new Date();
  if (day === "tomorrow") base.setDate(base.getDate() + 1);
  base.setHours(14, 30, 0, 0);
  const end = new Date(base.getTime() + 30 * 60 * 1000);
  return { startIso: base.toISOString(), endIso: end.toISOString(), slot: "14:30-15:00" };
}

/** Builds the first occurrence (tomorrow at hour:minute) and an RRULE for a daily reminder. */
function reminderSlot(hour: number, minute: number, days: number) {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(hour, minute, 0, 0);
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  const recurrence = days > 1 ? [`RRULE:FREQ=DAILY;COUNT=${days}`] : undefined;
  return { startIso: start.toISOString(), endIso: end.toISOString(), recurrence };
}

export const listEvents: ToolExecutor = async (ctx, args) => {
  const day = readDay(args);
  const token = await getValidAccessToken(ctx.userId);
  if (token) {
    const events = await listEventsForDay(token, day);
    return { day, events, source: "google_calendar" };
  }
  return { day, events: MOCK_EVENTS, source: "mock" };
};

export const findFreeSlots: ToolExecutor = async (ctx, args) => {
  const day = readDay(args);
  const token = await getValidAccessToken(ctx.userId);
  if (token) {
    const slot = await findFreeSlotForDay(token, day);
    return { ...slot, day, timezone: "local", source: "google_calendar" };
  }
  const slot = mockSlot(day);
  return { ...slot, day, timezone: "local", source: "mock" };
};

export const createEvent: ToolExecutor = async (ctx, args) => {
  const title = (args.title as string) ?? "Meeting";

  const isReminder = typeof args.hour === "number";
  const reminder = isReminder
    ? reminderSlot(args.hour as number, (args.minute as number) ?? 0, (args.recurrenceDays as number) ?? 1)
    : null;
  const fallback = reminder ?? mockSlot(readDay(args));
  const startIso = (args.startIso as string) ?? fallback.startIso;
  const endIso = (args.endIso as string) ?? fallback.endIso;
  const recurrence = reminder?.recurrence;

  const token = await getValidAccessToken(ctx.userId);
  if (token) {
    const created = await createCalendarEvent(token, {
      title,
      startIso,
      endIso,
      attendeeEmail: args.attendeeEmail as string | undefined,
      recurrence,
    });
    return { ...created, title, startIso, endIso, recurrence, source: "google_calendar" };
  }

  const eventId = `evt_${Math.random().toString(36).slice(2, 10)}`;
  return { eventId, title, startIso, endIso, recurrence, source: "mock" };
};

export const verifyEvent: ToolExecutor = async (ctx, args) => {
  const eventId = args.eventId as string | undefined;
  const token = await getValidAccessToken(ctx.userId);
  if (token && eventId && !eventId.startsWith("evt_")) {
    const event = await getCalendarEvent(token, eventId);
    return { verified: Boolean(event.id), source: "google_calendar" };
  }
  return { verified: true, source: "mock" };
};
