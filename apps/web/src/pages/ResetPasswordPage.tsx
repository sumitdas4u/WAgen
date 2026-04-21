import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../lib/api";

function mapResetError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid") || normalized.includes("expired")) {
    return "This reset link is invalid or expired. Request a new one.";
  }
  return message;
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await resetPassword({ token, password });
      setInfo("Password updated. Redirecting to login...");
      window.setTimeout(() => navigate("/signup", { replace: true }), 900);
    } catch (resetError) {
      setError(mapResetError((resetError as Error).message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell local-auth-shell">
      <section className="auth-card local-auth-card">
        <div className="local-auth-brand">
          <span className="local-auth-brand-mark">w</span>
          <strong>WAgen AI</strong>
        </div>

        <h1 className="local-auth-title">Set a new password</h1>
        {!token && <p className="error-text">Reset token is missing. Request a new password reset link.</p>}

        <form onSubmit={handleSubmit} className="stack-form local-auth-form" style={{ marginTop: "0.5rem" }}>
          <label className="local-auth-field">
            <span>
              New password <em>*</em>
            </span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <label className="local-auth-field">
            <span>
              Confirm password <em>*</em>
            </span>
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>

          {error && <p className="error-text">{error}</p>}
          {info && <p className="info-text">{info}</p>}

          <button className="primary-btn local-auth-submit" disabled={loading || !token} type="submit">
            {loading ? "Please wait..." : "Update password"}
          </button>
        </form>

        <p className="local-auth-switch">
          Remembered your password? <Link to="/signup" className="local-auth-switch-btn">Login</Link>
        </p>
      </section>
    </main>
  );
}

