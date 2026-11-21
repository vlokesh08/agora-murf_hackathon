import { Navigate, Route, Routes } from "react-router-dom";
import { SignInPage } from "./features/auth/SignInPage";
import { SignUpPage } from "./features/auth/SignUpPage";
import { OnboardingFlow } from "./features/onboarding/OnboardingFlow";
import { ConversationScreen } from "./features/conversation/ConversationScreen";
import { VoiceScreen } from "./features/conversation/VoiceScreen";
import { WorkflowCanvas } from "./features/workflow/WorkflowCanvas";
import { SettingsPage } from "./features/settings/SettingsPage";
import { PlaceholderPage } from "./features/settings/PlaceholderPage";
import { IntegrationsPage } from "./features/integrations/IntegrationsPage";
import { authClient } from "./lib/authClient";
import { useAppStore } from "./store/useAppStore";

function RequireSession({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return null;
  if (!session) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const hasCompletedOnboarding = useAppStore((s) => s.hasCompletedOnboarding);
  return (
    <RequireSession>
      {hasCompletedOnboarding ? children : <Navigate to="/onboarding" replace />}
    </RequireSession>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route
        path="/onboarding"
        element={
          <RequireSession>
            <OnboardingFlow />
          </RequireSession>
        }
      />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <ConversationScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/app/voice"
        element={
          <RequireAuth>
            <VoiceScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/app/workflow"
        element={
          <RequireAuth>
            <WorkflowCanvas />
          </RequireAuth>
        }
      />
      <Route
        path="/app/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/app/automations"
        element={
          <RequireAuth>
            <PlaceholderPage
              title="Automations"
              description="Saved automations will appear here once the backend is connected."
            />
          </RequireAuth>
        }
      />
      <Route
        path="/app/integrations"
        element={
          <RequireAuth>
            <IntegrationsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/sign-in" replace />} />
    </Routes>
  );
}
