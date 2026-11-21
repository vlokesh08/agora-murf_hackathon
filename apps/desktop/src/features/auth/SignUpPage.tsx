import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { authClient } from "../../lib/authClient";
import { AuthLayout } from "./AuthLayout";

export function SignUpPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: signUpError } = await authClient.signUp.email({ name, email, password });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message ?? "Could not create your account.");
      return;
    }
    navigate("/onboarding");
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Set up your personal automation assistant"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="input"
        />
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
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="input"
        />
        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        <Button type="submit" block disabled={loading}>
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-[var(--color-text-dim)]">
        Already have an account?{" "}
        <Link
          to="/sign-in"
          className="font-medium text-[var(--color-accent-2)] hover:underline hover:underline-offset-[3px]"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
