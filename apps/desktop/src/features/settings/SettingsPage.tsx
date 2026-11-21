import { useEffect } from "react";
import clsx from "clsx";
import type { AssistantMode } from "@personal-agent/shared";
import { Sidebar } from "../../components/Sidebar";
import { Card } from "../../components/ui/Card";
import { api } from "../../lib/apiClient";
import { assistantModeList } from "../../lib/assistantModes";
import { useAppStore } from "../../store/useAppStore";

export function SettingsPage() {
  const assistantMode = useAppStore((s) => s.assistantMode);
  const setAssistantMode = useAppStore((s) => s.setAssistantMode);

  useEffect(() => {
    api
      .get<{ assistantMode: AssistantMode }>("/api/preferences")
      .then((prefs) => setAssistantMode(prefs.assistantMode))
      .catch(() => {});
  }, [setAssistantMode]);

  async function selectMode(mode: AssistantMode) {
    setAssistantMode(mode);
    await api.patch("/api/preferences", { assistantMode: mode });
  }

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto px-6 py-7">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-[-0.022em]">Settings</h1>
          <p className="mt-1 text-base text-[var(--color-text-dim)]">
            Changing the mode only affects tone — not permissions or approvals.
          </p>

          <Card className="mt-5 p-5">
            <h2 className="mb-4 text-lg font-semibold tracking-[-0.01em]">
              Assistant mode
            </h2>
            <div className="grid gap-3">
              {assistantModeList.map((m) => (
                <button
                  key={m.key}
                  onClick={() => void selectMode(m.key)}
                  className={clsx(
                    "rounded-[10px] border px-3 py-3.5 text-left transition-colors duration-[140ms]",
                    assistantMode === m.key
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 shadow-[0_0_0_3px_var(--accent-soft)]"
                      : "border-[var(--color-border)] hover:border-[var(--color-text-dim)]"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{m.label}</span>
                    {assistantMode === m.key && (
                      <span className="text-xs text-[var(--color-accent-2)]">Active</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-dim)]">{m.tagline}</p>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
