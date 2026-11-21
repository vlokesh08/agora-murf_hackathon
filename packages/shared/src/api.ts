import { z } from "zod";
import { assistantModeSchema } from "./modes";

export const createConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const startRunSchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1).max(4000),
});
export type StartRunInput = z.infer<typeof startRunSchema>;

export const approvalDecisionSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;

export const updatePreferencesSchema = z.object({
  assistantMode: assistantModeSchema.optional(),
});
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

export const toggleIntegrationSchema = z.object({
  provider: z.enum(["google_calendar", "gmail", "github"]),
  connected: z.boolean(),
});
export type ToggleIntegrationInput = z.infer<typeof toggleIntegrationSchema>;
