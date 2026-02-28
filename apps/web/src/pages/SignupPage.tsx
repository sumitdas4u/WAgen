import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";

const BUSINESS_TYPES = ["E-commerce", "SaaS", "Agency", "Coaching", "Real Estate", "Healthcare", "Other"];

function mapAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("email already in use") || normalized.includes("auth/email-already-in-use")) {
    return "This email already has an account. Use login mode.";
  }
  if (
    normalized.includes("invalid credentials") ||
    normalized.includes("auth/invalid-credential") ||
    normalized.includes("auth/user-not-found") ||
    normalized.includes("auth/wrong-password")
  ) {
    return "Wrong email or password.";
  }
  if (normalized.includes("auth/popup-closed-by-user")) {
    return "Google login was closed before completion.";
  }
  if (normalized.includes("auth/too-many-requests")) {
    return "Too many attempts. Please try again in a few minutes.";
  }
  if (normalized.includes("email not verified") || normalized.includes("verify your email")) {
    return "Please verify your email from the link sent to your inbox, then login.";
  }
  return message;
}

function readPlanFromSearch(search: string): "starter" | "pro" | "business" | null {
  const value = new URLSearchParams(search).get("plan");
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "starter" || normalized === "pro" || normalized === "business") {
    return normalized;
  }
  return null;
}

export function SignupPage() {
  const { signupAndLogin, loginWithPassword, loginWithGoogle, requestPasswordReset } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"signup" | "login">("login");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessType, setBusinessType] = useState(BUSINESS_TYPES[0]);
  const selectedPlan = readPlanFromSearch(location.search);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      if (mode === "signup") {
        const result = await signupAndLogin({ name, email, password, businessType });
        if (result.emailVerificationRequired) {
          setInfo("Verification link sent to your email. Verify first, then login.");
          setMode("login");
          setPassword("");
          return;
        }
      } else {
        await loginWithPassword({ email, password });
        navigate(selectedPlan ? `/purchase?plan=${selectedPlan}` : "/dashboard", { replace: true });
        return;
      }
    } catch (submitError) {
      setError(mapAuthError((submitError as Error).message));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      await loginWithGoogle();
      navigate(selectedPlan ? `/purchase?plan=${selectedPlan}` : "/dashboard", { replace: true });
    } catch (submitError) {
      setError(mapAuthError((submitError as Error).message));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError("Enter your email first, then click Forgot password.");
      return;
    }

    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setInfo("Password reset email sent. Please check your inbox.");
    } catch (resetError) {
      setError(mapAuthError((resetError as Error).message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell firebase-auth-shell">
      <section className="auth-card firebase-auth-card">
        <div className="firebase-auth-brand">
          <span className="firebase-auth-brand-mark">w</span>
          <strong>wagenai</strong>
        </div>

        <h1 className="firebase-auth-title">{mode === "signup" ? "Create your account" : "Login to your account"}</h1>

        <div className="firebase-auth-social-row">
          <button type="button" className="firebase-auth-social-btn google-only" onClick={handleGoogleLogin} disabled={loading}>
            <span className="firebase-auth-social-icon">G</span>
            <span>Google</span>
          </button>
        </div>

        <div className="firebase-auth-divider">
          <span>or {mode === "signup" ? "sign up" : "login"} with</span>
        </div>

        <form onSubmit={handleSubmit} className="stack-form firebase-auth-form">
          {mode === "signup" && (
            <label className="firebase-auth-field">
              <span>
                Full Name <em>*</em>
              </span>
              <input
                name="name"
                required
                minLength={2}
                placeholder="Your full name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}

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

          <label className="firebase-auth-field">
            <span>
              Password <em>*</em>
            </span>
            <div className="firebase-auth-password-wrap">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                placeholder="At least 8 characters"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="firebase-auth-password-toggle"
                onClick={() => setShowPassword((previous) => !previous)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          {mode === "signup" && (
            <label className="firebase-auth-field">
              <span>Business Type</span>
              <select
                name="businessType"
                value={businessType}
                onChange={(event) => setBusinessType(event.target.value)}
              >
                {BUSINESS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          )}

          {mode === "login" && (
            <button type="button" className="auth-inline-btn firebase-auth-forgot" onClick={handleForgotPassword} disabled={loading}>
              Forgot Password?
            </button>
          )}

          {error && <p className="error-text">{error}</p>}
          {info && <p className="info-text">{info}</p>}

          <button className="primary-btn firebase-auth-submit" disabled={loading} type="submit">
            {loading ? "Please wait..." : mode === "signup" ? "Create Account" : "Login"}
          </button>
        </form>

        <p className="firebase-auth-switch">
          {mode === "signup" ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            type="button"
            className="firebase-auth-switch-btn"
            onClick={() => {
              setMode((previous) => (previous === "signup" ? "login" : "signup"));
              setError(null);
              setInfo(null);
            }}
          >
            {mode === "signup" ? "Login" : "Sign up"}
          </button>
        </p>

        <p className="tiny-note firebase-auth-back-link">
          <Link to="/">Back to landing</Link>
        </p>
      </section>
    </main>
  );
}
