import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";

const BUSINESS_TYPES = ["E-commerce", "SaaS", "Agency", "Coaching", "Real Estate", "Healthcare", "Other"];

function mapAuthError(message: string): string {
  if (message.toLowerCase().includes("email already in use")) {
    return "This email already has an account. Use login mode.";
  }
  if (message.toLowerCase().includes("invalid credentials")) {
    return "Wrong email or password.";
  }
  return message;
}

export function SignupPage() {
  const { signupAndLogin, loginWithPassword } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const name = String(form.get("name") || "");
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");
    const businessType = String(form.get("businessType") || "");

    setError(null);
    setLoading(true);

    try {
      if (mode === "signup") {
        await signupAndLogin({ name, email, password, businessType });
      } else {
        await loginWithPassword({ email, password });
      }
      navigate(mode === "signup" ? "/onboarding" : "/dashboard", { replace: true });
    } catch (submitError) {
      setError(mapAuthError((submitError as Error).message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>{mode === "signup" ? "Create Account" : "Welcome Back"}</h1>
        <p>{mode === "signup" ? "Start your WAgen trial." : "Log in to your WAgen dashboard."}</p>

        <form onSubmit={handleSubmit} className="stack-form">
          {mode === "signup" && (
            <label>
              Name
              <input name="name" required minLength={2} placeholder="Your full name" />
            </label>
          )}

          <label>
            Email
            <input name="email" type="email" required placeholder="name@company.com" />
          </label>

          <label>
            Password
            <input name="password" type="password" required minLength={8} placeholder="At least 8 characters" />
          </label>

          {mode === "signup" && (
            <label>
              Business Type
              <select name="businessType" defaultValue={BUSINESS_TYPES[0]}>
                {BUSINESS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          )}

          {error && <p className="error-text">{error}</p>}

          <button className="primary-btn" disabled={loading} type="submit">
            {loading ? "Please wait..." : mode === "signup" ? "Create Account" : "Login"}
          </button>
        </form>

        <button
          type="button"
          className="ghost-btn"
          onClick={() => setMode((previous) => (previous === "signup" ? "login" : "signup"))}
        >
          {mode === "signup" ? "Already have an account? Login" : "Need an account? Sign up"}
        </button>

        <p className="tiny-note">
          Prefer the new main screen? <Link to="/">Go to landing</Link>.
        </p>
      </section>
    </main>
  );
}
