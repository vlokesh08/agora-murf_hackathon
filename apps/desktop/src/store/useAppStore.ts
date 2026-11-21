import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AssistantMode } from "../types/workflow";

interface AppState {
  hasCompletedOnboarding: boolean;
  assistantMode: AssistantMode;
  completeOnboarding: (mode: AssistantMode) => void;
  setAssistantMode: (mode: AssistantMode) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hasCompletedOnboarding: false,
      assistantMode: "professional",
      completeOnboarding: (mode) => set({ hasCompletedOnboarding: true, assistantMode: mode }),
      setAssistantMode: (mode) => set({ assistantMode: mode }),
    }),
    { name: "personal-agent-app-state" }
  )
);
