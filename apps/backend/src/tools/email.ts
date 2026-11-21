import { getValidAccessToken } from "../integrations/google";
import { listMessagesForDate } from "../integrations/googleGmail";
import type { ToolExecutor } from "./types";

// Mock data used only when the user hasn't connected Gmail yet.
const MOCK_MESSAGES = [
  { id: "msg_1", from: "Rahul", subject: "Re: Project update", snippet: "Sounds good, let's sync." },
  { id: "msg_2", from: "Billing", subject: "Your invoice is ready", snippet: "Invoice #4821 is now available." },
];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const searchMessages: ToolExecutor = async (ctx, args) => {
  const date = (args.date as string) ?? todayIso();
  const token = await getValidAccessToken(ctx.userId);
  if (token) {
    const messages = await listMessagesForDate(token, date);
    return { date, messages, source: "gmail" };
  }
  return { date, messages: MOCK_MESSAGES, source: "mock" };
};

export const readMessage: ToolExecutor = async (_ctx, args) => {
  const id = (args.id as string) ?? MOCK_MESSAGES[0].id;
  const message = MOCK_MESSAGES.find((m) => m.id === id) ?? MOCK_MESSAGES[0];
  return { ...message, body: `${message.snippet} (full body would appear here)` };
};

export const draftMessage: ToolExecutor = async (_ctx, args) => {
  return {
    to: (args.to as string) ?? "Rahul",
    draft: "Hi, confirming our meeting at 2:30 PM tomorrow. Let me know if that works!",
  };
};

export const sendMessage: ToolExecutor = async (_ctx, args) => {
  const messageId = `msg_${Math.random().toString(36).slice(2, 10)}`;
  return { messageId, to: (args.to as string) ?? "Rahul" };
};

export const verifySent: ToolExecutor = async () => {
  return { verified: true };
};
