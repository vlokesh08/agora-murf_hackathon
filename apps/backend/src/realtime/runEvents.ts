import { EventEmitter } from "node:events";

/**
 * In-process signal for "this run reached a terminal or pausing state",
 * separate from Socket.IO (which is for external clients). Lets a synchronous
 * HTTP handler (the Conversational AI webhook) await a run that `startRun`
 * already kicks off in the background, without polling the DB or duplicating
 * the plan/execute/approve pipeline.
 */
export const runEvents = new EventEmitter();

export type RunSignal =
  | { kind: "completed"; responseText: string }
  | { kind: "failed"; error?: string }
  | { kind: "waiting_approval"; goal: string };
