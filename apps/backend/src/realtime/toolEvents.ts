import { EventEmitter } from "node:events";

/** In-process signal for "the desktop app answered this tool-bridge request"
 *  — mirrors `runEvents.ts`'s pattern, but for backend tools that need the
 *  desktop app itself to do the work (e.g. opening its own browser window)
 *  instead of something the backend can do alone. */
export const toolEvents = new EventEmitter();

export interface ToolBridgeResult {
  resultText?: string;
  error?: string;
}
