import type { ToolName } from "@personal-agent/shared";
import { requiresApproval } from "@personal-agent/shared";
import { extractEmailDate } from "./emailDateExtractor";
import { extractReminderDetails } from "./reminderExtractor";

export interface PlanStep {
  id: string;
  title: string;
  tool: ToolName | null;
  kind: "read" | "write" | "verify" | "respond";
  dependsOn: string[];
  approvalRequired: boolean;
  args?: Record<string, unknown>;
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
}

function step(
  partial: Omit<PlanStep, "approvalRequired" | "dependsOn"> & {
    dependsOn?: string[];
  }
): PlanStep {
  return {
    dependsOn: partial.dependsOn ?? [],
    approvalRequired: partial.tool ? requiresApproval(partial.tool) : false,
    ...partial,
  };
}

/**
 * Deterministic, keyword-based planner. Stands in for a real LLM call so the
 * whole pipeline (plan -> approve -> execute -> verify) runs without any
 * external model API key. Swap this for a real LLMProvider-backed planner
 * later without changing any caller.
 */
export async function planFromText(requestText: string): Promise<Plan> {
  const text = requestText.toLowerCase();

  if (text.includes("schedule") || text.includes("meeting")) {
    return {
      goal: "Schedule a meeting",
      steps: [
        step({
          id: "s1",
          title: "Calendar: List events",
          tool: "calendar.list_events",
          kind: "read",
          args: { day: "tomorrow" },
        }),
        step({
          id: "s2",
          title: "Calendar: Find free slots",
          tool: "calendar.find_free_slots",
          kind: "read",
          dependsOn: ["s1"],
          args: { day: "tomorrow" },
        }),
        step({
          id: "s3",
          title: "Calendar: Create event",
          tool: "calendar.create_event",
          kind: "write",
          dependsOn: ["s2"],
        }),
        step({
          id: "s4",
          title: "Email: Send invite",
          tool: "email.send_message",
          kind: "write",
          dependsOn: ["s2"],
        }),
        step({
          id: "s5",
          title: "Verify event created",
          tool: "calendar.verify_event",
          kind: "verify",
          dependsOn: ["s3"],
        }),
        step({
          id: "s6",
          title: "Verify email sent",
          tool: "email.verify_sent",
          kind: "verify",
          dependsOn: ["s4"],
        }),
      ],
    };
  }

  const mentionsCalendar = text.includes("calend") || text.includes("agenda");
  const mentionsReminder = text.includes("remind");
  const hasCreationVerb = /\b(add|create|set up|setup|set|keep|put|make)\b/.test(text);
  const hasTimeSignal = /\d{1,2}(:\d{2})?\s*(am|pm)/.test(text) || text.includes("o'clock");

  // A reminder/event creation request takes priority over the plain
  // "what's on my calendar" check below, even though both mention
  // "calendar" — otherwise a create request gets misread as a listing.
  // A bare "remind me to X" with no time or calendar mention is just a
  // to-do, not a calendar event — that falls through to the tasks branch.
  const wantsCalendarReminder =
    (mentionsReminder && (mentionsCalendar || hasTimeSignal)) ||
    (mentionsCalendar && hasCreationVerb);

  if (wantsCalendarReminder) {
    const details = await extractReminderDetails(requestText);
    return {
      goal: `Set a reminder: ${details.title}`,
      steps: [
        step({
          id: "s1",
          title: `Calendar: Create reminder "${details.title}"`,
          tool: "calendar.create_event",
          kind: "write",
          args: {
            title: details.title,
            hour: details.hour,
            minute: details.minute,
            recurrenceDays: details.days,
          },
        }),
        step({
          id: "s2",
          title: "Verify reminder created",
          tool: "calendar.verify_event",
          kind: "verify",
          dependsOn: ["s1"],
        }),
      ],
    };
  }

  if (text.includes("task") || text.includes("todo") || mentionsReminder) {
    return {
      goal: "Track a task",
      steps: [
        step({ id: "s1", title: "Tasks: Create task", tool: "tasks.create", kind: "write" }),
        step({ id: "s2", title: "Tasks: List open tasks", tool: "tasks.list", kind: "verify", dependsOn: ["s1"] }),
      ],
    };
  }

  if (
    text.includes("organize") ||
    text.includes("pdf") ||
    text.includes("downloads") ||
    text.includes("folder")
  ) {
    return {
      goal: "Organize files",
      steps: [
        step({
          id: "s1",
          title: "Filesystem: List directory",
          tool: "filesystem.list_directory",
          kind: "read",
        }),
        step({
          id: "s2",
          title: "Filesystem: Search matching files",
          tool: "filesystem.search_files",
          kind: "read",
          dependsOn: ["s1"],
        }),
        step({
          id: "s3",
          title: "Filesystem: Create destination folder",
          tool: "filesystem.create_directory",
          kind: "write",
          dependsOn: ["s2"],
          args: { path: "organized" },
        }),
        step({
          id: "s4",
          title: "Filesystem: Move files",
          tool: "filesystem.move_file",
          kind: "write",
          dependsOn: ["s2", "s3"],
        }),
        step({
          id: "s5",
          title: "Verify files moved",
          tool: "filesystem.list_directory",
          kind: "verify",
          dependsOn: ["s4"],
        }),
      ],
    };
  }

  if (mentionsCalendar) {
    const day = text.includes("tomorrow") ? "tomorrow" : "today";
    return {
      goal: `Check your calendar for ${day}`,
      steps: [
        step({
          id: "s1",
          title: `Calendar: List events (${day})`,
          tool: "calendar.list_events",
          kind: "read",
          args: { day },
        }),
      ],
    };
  }

  const mentionsEmail = text.includes("mail") || text.includes("inbox");
  if (mentionsEmail) {
    const date = await extractEmailDate(requestText);
    return {
      goal: `Summarize emails from ${date}`,
      steps: [
        step({
          id: "s1",
          title: `Email: Search messages (${date})`,
          tool: "email.search_messages",
          kind: "read",
          args: { date },
        }),
      ],
    };
  }

  const mentionsGithub =
    text.includes("github") || text.includes("pull request") || text.includes("notifications");
  if (mentionsGithub) {
    return {
      goal: "Check GitHub notifications",
      steps: [
        step({
          id: "s1",
          title: "GitHub: List unread notifications",
          tool: "github.list_notifications",
          kind: "read",
        }),
      ],
    };
  }

  // A live-lookup request ("price of gold", "search for...", "look up...") —
  // checked before the daily-briefing fan-out below so e.g. "price of gold
  // today" isn't misread as that catch-all just because it contains "today".
  const wantsWebSearch =
    text.includes("price of") ||
    text.includes("how much is") ||
    text.includes("how much does") ||
    text.includes("search for") ||
    text.includes("look up") ||
    text.startsWith("google ");
  if (wantsWebSearch) {
    return {
      goal: `Search the web for "${requestText}"`,
      steps: [
        step({
          id: "s1",
          title: "Web: Search",
          tool: "web.search",
          kind: "read",
          args: { query: requestText },
        }),
      ],
    };
  }

  // Broad, no-specific-source request ("what's today", "catch me up", "summarize
  // my day") — fan out to every connected source in parallel (see
  // executeReadSteps in graph.ts) and let the response step merge them into
  // one answer, like independent agents reporting back on their own slice.
  const mentionsDailyBriefing =
    text.includes("summarize") ||
    text.includes("prepare my day") ||
    text.includes("my day") ||
    text.includes("briefing") ||
    text.includes("catch me up") ||
    /\btoday\b/.test(text);

  if (mentionsDailyBriefing) {
    return {
      goal: "Daily briefing",
      steps: [
        step({
          id: "s1",
          title: "Calendar: List events (today)",
          tool: "calendar.list_events",
          kind: "read",
          args: { day: "today" },
        }),
        step({
          id: "s2",
          title: "Email: Search messages (today)",
          tool: "email.search_messages",
          kind: "read",
        }),
        step({
          id: "s3",
          title: "GitHub: List unread notifications",
          tool: "github.list_notifications",
          kind: "read",
        }),
      ],
    };
  }

  return {
    goal: "Answer directly",
    steps: [],
  };
}
