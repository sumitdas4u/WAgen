import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context";

function mapResetError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid email") || normalized.includes("auth/invalid-email")) {
    return "Enter a valid email address.";
  }
  if (normalized.includes("user not found") || normalized.includes("auth/user-not-found")) {
    return "No account found with this email.";
  }
  if (normalized.includes("auth/too-many-requests")) {
    return "Too many attempts. Please try again in a few minutes.";
  }
  return message;
}

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setInfo("Password reset email sent. Please check your inbox.");
    } catch (resetError) {
      setError(mapResetError((resetError as Error).message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell firebase-auth-shell">
      <section className="auth-card firebase-auth-card">
        <div className="firebase-auth-brand">
          <span className="firebase-auth-brand-mark">w</span>
          <strong>WAgen AI</strong>
        </div>

        <h1 className="firebase-auth-title">Reset your password</h1>
        <p className="tiny-note" style={{ textAlign: "center", marginTop: "-0.1rem" }}>
          Enter your account email to receive a reset link.
        </p>

        <form onSubmit={handleSubmit} className="stack-form firebase-auth-form" style={{ marginTop: "0.5rem" }}>
          <label className="firebase-auth-field">
            <span>
              Email ID <em>*</em>
            </span>
            <input
              name="email"
              type="email"
              required
              placeholder="name@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          {error && <p className="error-text">{error}</p>}
          {info && <p className="info-text">{info}</p>}

          <button className="primary-btn firebase-auth-submit" disabled={loading} type="submit">
            {loading ? "Please wait..." : "Send reset link"}
          </button>
        </form>

        <p className="firebase-auth-switch">
          Remembered your password? <Link to="/signup" className="firebase-auth-switch-btn">Login</Link>
        </p>

        <p className="tiny-note firebase-auth-back-link">
          <Link to="/">Back to landing</Link>
        </p>
      </section>
    </main>
  );
}
