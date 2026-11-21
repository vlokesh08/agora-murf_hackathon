export type ToolName =
  | "calendar.list_events"
  | "calendar.find_free_slots"
  | "calendar.create_event"
  | "calendar.verify_event"
  | "email.search_messages"
  | "email.read_message"
  | "email.draft_message"
  | "email.send_message"
  | "email.verify_sent"
  | "filesystem.list_directory"
  | "filesystem.search_files"
  | "filesystem.read_file"
  | "filesystem.create_directory"
  | "filesystem.move_file"
  | "filesystem.rename_file"
  | "tasks.create"
  | "tasks.list"
  | "tasks.update"
  | "tasks.complete"
  | "github.list_notifications"
  | "web.search";

export const APPROVAL_REQUIRED_TOOLS: ReadonlySet<ToolName> = new Set([
  "email.send_message",
  "calendar.create_event",
  "filesystem.move_file",
  "filesystem.rename_file",
]);

export function requiresApproval(tool: ToolName): boolean {
  return APPROVAL_REQUIRED_TOOLS.has(tool);
}
