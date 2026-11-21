import type { ToolName } from "@personal-agent/shared";
import * as calendar from "./calendar";
import * as email from "./email";
import * as filesystem from "./filesystem";
import * as github from "./github";
import * as tasksTool from "./tasks";
import type { ToolExecutor } from "./types";
import * as webSearch from "./webSearch";

export const toolRegistry: Record<ToolName, ToolExecutor> = {
  "calendar.list_events": calendar.listEvents,
  "calendar.find_free_slots": calendar.findFreeSlots,
  "calendar.create_event": calendar.createEvent,
  "calendar.verify_event": calendar.verifyEvent,
  "email.search_messages": email.searchMessages,
  "email.read_message": email.readMessage,
  "email.draft_message": email.draftMessage,
  "email.send_message": email.sendMessage,
  "email.verify_sent": email.verifySent,
  "filesystem.list_directory": filesystem.listDirectory,
  "filesystem.search_files": filesystem.searchFiles,
  "filesystem.read_file": filesystem.readFile,
  "filesystem.create_directory": filesystem.createDirectory,
  "filesystem.move_file": filesystem.moveFile,
  "filesystem.rename_file": filesystem.renameFile,
  "tasks.create": tasksTool.createTask,
  "tasks.list": tasksTool.listTasks,
  "tasks.update": tasksTool.updateTask,
  "tasks.complete": tasksTool.completeTask,
  "github.list_notifications": github.listNotifications,
  "web.search": webSearch.searchWeb,
};
