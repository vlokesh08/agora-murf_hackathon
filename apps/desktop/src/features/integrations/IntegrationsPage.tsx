import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Sidebar } from "../../components/Sidebar";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { api } from "../../lib/apiClient";
import { API_BASE_URL } from "../../lib/config";

interface IntegrationStatus {
  provider: "google_calendar" | "gmail" | "github";
  connected: boolean;
  oauthConfigured: boolean;
}

const LABELS: Record<IntegrationStatus["provider"], string> = {
  google_calendar: "Google Calendar",
  gmail: "Gmail",
  github: "GitHub",
};

const CONNECT_PATH: Record<IntegrationStatus["provider"], string> = {
  google_calendar: "google",
  gmail: "google",
  github: "github",
};

const DESCRIPTIONS: Record<IntegrationStatus["provider"], string> = {
  google_calendar: "Real Google Calendar access via OAuth.",
  gmail: "Real Gmail access via the same Google OAuth grant as Calendar.",
  github: "Reads unread notifications (PR reviews, mentions, assignments) via OAuth.",
};

export function IntegrationsPage() {
  const [params] = useSearchParams();
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const data = await api.get<IntegrationStatus[]>("/api/integrations");
    setIntegrations(data);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const justConnected = params.get("connected");
  const oauthError = params.get("error");

  async function disconnect(provider: IntegrationStatus["provider"]) {
    await api.patch("/api/integrations", { provider, connected: false });
    await refresh();
  }

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto px-6 py-7">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-[-0.022em]">Connected apps</h1>
          <p className="mt-1 text-base text-[var(--color-text-dim)]">
            Authorizing an app here is separate from signing in — it only grants this
            assistant permission to read/write that specific service.
          </p>

          {justConnected && (
            <div className="mt-4 rounded-md px-3.5 py-[7px] text-sm text-[var(--color-success)] ring-1 ring-inset ring-[var(--color-success)]/20">
              {LABELS[justConnected as IntegrationStatus["provider"]] ?? justConnected} connected.
            </div>
          )}
          {oauthError && (
            <div className="mt-4 rounded-md px-3.5 py-[7px] text-sm text-[var(--color-danger)] ring-1 ring-inset ring-[var(--color-danger)]/20">
              Couldn't connect — please try again.
            </div>
          )}

          <Card className="mt-5 divide-y divide-[var(--color-border)]">
            {!loading &&
              integrations.map((i) => (
                <div key={i.provider} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-medium">{LABELS[i.provider]}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-dim)]">
                      {i.oauthConfigured
                        ? DESCRIPTIONS[i.provider]
                        : `${LABELS[i.provider]} OAuth isn't configured on the server yet.`}
                    </p>
                  </div>
                  {i.connected ? (
                    <Button variant="secondary" onClick={() => void disconnect(i.provider)}>
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      disabled={!i.oauthConfigured}
                      onClick={() => {
                        window.location.href = `${API_BASE_URL}/api/integrations/${CONNECT_PATH[i.provider]}/connect`;
                      }}
                    >
                      Connect
                    </Button>
                  )}
                </div>
              ))}
          </Card>
        </div>
      </main>
    </div>
  );
}
