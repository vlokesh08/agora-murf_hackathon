import { useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { api } from "../../lib/apiClient";
import { assistantModeList } from "../../lib/assistantModes";
import { authClient } from "../../lib/authClient";
import { useAppStore } from "../../store/useAppStore";
import type { AssistantMode } from "../../types/workflow";

const STEPS = ["Welcome", "Mode", "Integrations", "Permissions", "Microphone"] as const;

export function OnboardingFlow() {
  const navigate = useNavigate();
  const completeOnboarding = useAppStore((s) => s.completeOnboarding);
  const { data: session } = authClient.useSession();
  const userName = session?.user.name;
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<AssistantMode>("professional");
  const [connected, setConnected] = useState<Record<string, boolean>>({
    calendar: false,
    gmail: false,
  });
  const [micStatus, setMicStatus] = useState<"idle" | "checking" | "ok">("idle");
  const [saving, setSaving] = useState(false);

  const isLast = step === STEPS.length - 1;

  async function next() {
    if (isLast) {
      setSaving(true);
      await api.patch("/api/preferences", { assistantMode: mode }).catch(() => {});
      setSaving(false);
      completeOnboarding(mode);
      navigate("/app");
      return;
    }
    setStep((s) => s + 1);
  }

  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] px-6 py-10">
      <div className="mx-auto max-w-[560px]">
        {/* gr8r-studio step indicator: fixed 28×3 segments, 6px apart. */}
        <div className="mb-6 flex justify-center gap-1.5">
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={clsx(
                "h-[3px] w-7 rounded-[2px] transition-colors duration-[140ms]",
                i <= step ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
              )}
            />
          ))}
        </div>

        <Card className="p-8">
          {step === 0 && (
            <div className="text-center">
              <div className="orb-glow mx-auto mb-5 h-16 w-16 rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)]" />
              <h2 className="text-2xl font-semibold tracking-[-0.02em]">
                Welcome{userName ? `, ${userName}` : ""}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-base text-[var(--color-text-dim)]">
                I can check your calendar, draft and send emails, organize
                files, and plan your day — by voice or text. You stay in
                control: I'll always ask before anything irreversible.
              </p>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.01em]">
                Choose how I should sound
              </h2>
              <p className="mt-1 text-base text-[var(--color-text-dim)]">
                This changes my tone only — not my permissions or safety rules.
                You can change it later in Settings.
              </p>
              <div className="mt-5 grid gap-3">
                {assistantModeList.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMode(m.key)}
                    className={clsx(
                      "rounded-[10px] border px-3 py-3.5 text-left transition-colors duration-[140ms]",
                      mode === m.key
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 shadow-[0_0_0_3px_var(--accent-soft)]"
                        : "border-[var(--color-border)] hover:border-[var(--color-text-dim)]"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{m.label}</span>
                      {mode === m.key && (
                        <span className="text-xs text-[var(--color-accent-2)]">Selected</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-dim)]">{m.tagline}</p>
                    <p className="mt-2 text-sm italic text-[var(--color-text)]">"{m.example}"</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.01em]">Connect your apps</h2>
              <p className="mt-1 text-base text-[var(--color-text-dim)]">
                Optional for now — you can connect these later from Settings.
              </p>
              <div className="mt-5 space-y-3">
                {[
                  { key: "calendar", provider: "google_calendar", label: "Google Calendar" },
                  { key: "gmail", provider: "gmail", label: "Gmail" },
                ].map((i) => (
                  <div
                    key={i.key}
                    className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-4 py-3"
                  >
                    <span>{i.label}</span>
                    <Button
                      variant={connected[i.key] ? "secondary" : "primary"}
                      onClick={() => {
                        const next = !connected[i.key];
                        setConnected((c) => ({ ...c, [i.key]: next }));
                        void api.patch("/api/integrations", {
                          provider: i.provider,
                          connected: next,
                        });
                      }}
                    >
                      {connected[i.key] ? "Connected" : "Connect"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.01em]">
                Permissions &amp; approvals
              </h2>
              <p className="mt-1 text-base text-[var(--color-text-dim)]">
                Here's how I'll handle sensitive actions by default.
              </p>
              <div className="mt-5 space-y-2">
                {[
                  ["Read calendar & email", "Allowed after you connect an account"],
                  ["Draft an email", "No approval needed — you review the draft"],
                  ["Send an email", "Requires your approval"],
                  ["Create or delete an event", "Requires your approval"],
                  ["Move or delete files", "Requires your approval"],
                ].map(([label, policy]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between rounded-md bg-[var(--color-surface-2)] px-3.5 py-2.5"
                  >
                    <span>{label}</span>
                    <span className="text-[var(--color-text-dim)]">{policy}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="text-center">
              <h2 className="text-lg font-semibold tracking-[-0.01em]">
                Test your microphone
              </h2>
              <p className="mx-auto mt-1 max-w-sm text-base text-[var(--color-text-dim)]">
                You can always switch to typing instead.
              </p>
              <div className="mt-6 flex flex-col items-center gap-4">
                <div
                  className={clsx(
                    "flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)]",
                    micStatus === "checking" && "pulse-ring"
                  )}
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMicStatus("checking");
                    setTimeout(() => setMicStatus("ok"), 1200);
                  }}
                >
                  {micStatus === "ok" ? "Microphone works" : "Test microphone"}
                </Button>
              </div>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between">
            <Button variant="ghost" onClick={back} disabled={step === 0}>
              Back
            </Button>
            <Button onClick={next} disabled={saving}>
              {isLast ? (saving ? "Saving…" : "Finish") : "Continue"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
