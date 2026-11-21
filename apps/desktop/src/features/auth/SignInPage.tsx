import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { authClient } from "../../lib/authClient";
import { useAppStore } from "../../store/useAppStore";
import { AuthLayout } from "./AuthLayout";

// Saved account for one-click sign-in (local dev convenience only —
// don't ship hardcoded credentials in a real deployment).
const QUICK_LOGIN = {
  email: "venkatalokeshvl@gmail.com",
  password: "Lokesh@204",
} as const;

export function SignInPage() {
  const navigate = useNavigate();
  const hasCompletedOnboarding = useAppStore((s) => s.hasCompletedOnboarding);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn(withEmail: string, withPassword: string) {
    setError(null);
    setLoading(true);
    const { error: signInError } = await authClient.signIn.email({
      email: withEmail,
      password: withPassword,
    });
    setLoading(false);
    if (signInError) {
      setError(signInError.message ?? "Could not sign in. Check your details.");
      return;
    }
    navigate(hasCompletedOnboarding ? "/app" : "/onboarding");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await signIn(email, password);
  }

  // One-click sign-in for the saved account — no typing, straight to the app.
  async function handleQuickLogin() {
    await signIn(QUICK_LOGIN.email, QUICK_LOGIN.password);
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue to your assistant"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="input"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="input"
        />
        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        <Button type="submit" block disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
        <div className="or">or</div>
        <Button
          type="button"
          variant="secondary"
          block
          disabled={loading}
          onClick={() => void handleQuickLogin()}
        >
          {loading ? "Signing in…" : "Login as Lokesh"}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-[var(--color-text-dim)]">
        New here?{" "}
        <Link
          to="/sign-up"
          className="font-medium text-[var(--color-accent-2)] hover:underline hover:underline-offset-[3px]"
        >
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
