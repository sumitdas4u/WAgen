import { useMutation } from "@tanstack/react-query";
import {
  EmailAuthProvider,
  PhoneAuthProvider,
  RecaptchaVerifier,
  linkWithCredential,
  reauthenticateWithCredential,
  updatePassword,
  updatePhoneNumber
} from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { updateMyProfile } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { firebaseAuth } from "../../../../lib/firebase";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import "./../account.css";

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < 6) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(3, score) as 0 | 1 | 2 | 3;
}

const STRENGTH_LABELS = ["Too short", "Weak", "Fair", "Strong"];
const STRENGTH_CLASSES = ["", "filled-weak", "filled-fair", "filled-strong"];

type PhoneStep = "idle" | "sending" | "sent" | "verifying" | "done" | "error";

function PhoneVerifySection({
  currentPhone,
  currentVerified,
  token,
  onSaved
}: {
  currentPhone: string | null;
  currentVerified: boolean;
  token: string;
  onSaved: () => Promise<void>;
}) {
  const [phone, setPhone] = useState(currentPhone ?? "");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<PhoneStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const verificationIdRef = useRef<string | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  const firebaseUser = firebaseAuth.currentUser;

  const clearVerifier = () => {
    try {
      recaptchaVerifierRef.current?.clear();
    } catch {
      // verifier may already be destroyed by Firebase internally
    }
    recaptchaVerifierRef.current = null;
  };

  const sendOtp = async () => {
    setError(null);
    const normalized = phone.trim();
    if (!normalized.startsWith("+") || normalized.length < 8) {
      setError("Enter phone in international format: +91XXXXXXXXXX");
      return;
    }
    if (!firebaseUser) {
      setError("No active session — please refresh and try again.");
      return;
    }
    setStep("sending");
    clearVerifier();
    try {
      recaptchaVerifierRef.current = new RecaptchaVerifier(
        firebaseAuth,
        "prf-recaptcha-container",
        { size: "invisible" }
      );
      const provider = new PhoneAuthProvider(firebaseAuth);
      verificationIdRef.current = await provider.verifyPhoneNumber(
        normalized,
        recaptchaVerifierRef.current
      );
      setStep("sent");
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("auth/operation-not-allowed")) {
        setError("Phone authentication is not enabled. Contact support.");
      } else {
        setError(msg);
      }
      setStep("error");
      clearVerifier();
    }
  };

  const verifyOtp = async () => {
    setError(null);
    if (!verificationIdRef.current || !firebaseUser) return;
    if (otp.trim().length !== 6) {
      setError("Enter the 6-digit OTP.");
      return;
    }
    setStep("verifying");
    try {
      const credential = PhoneAuthProvider.credential(verificationIdRef.current, otp.trim());
      const hasPhoneProvider = firebaseUser.providerData.some(
        (p) => p.providerId === "phone"
      );
      if (hasPhoneProvider) {
        await updatePhoneNumber(firebaseUser, credential);
      } else {
        await linkWithCredential(firebaseUser, credential);
      }
      // Persist to backend
      await updateMyProfile(token, {
        phoneNumber: phone.trim(),
        phoneVerified: true
      });
      await onSaved();
      setStep("done");
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("auth/invalid-verification-code")) {
        setError("Incorrect OTP. Please try again.");
      } else if (msg.includes("auth/code-expired")) {
        setError("OTP expired. Please resend.");
      } else {
        setError(msg);
      }
      setStep("sent"); // back to OTP entry
    }
  };

  if (step === "done") {
    return (
      <div className="acc-card">
        <div className="acc-card-head">
          <h2 className="acc-card-title">Phone number</h2>
        </div>
        <div className="acc-card-body">
          <div className="acc-info-grid">
            <span className="acc-info-key">Number</span>
            <span className="acc-info-value acc-info-mono">{phone}</span>
            <span className="acc-info-key">Status</span>
            <span className="acc-info-value">
              <span className="acc-status-dot acc-status-dot--on">Verified</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="acc-card">
      <div className="acc-card-head">
        <div>
          <h2 className="acc-card-title">Phone number</h2>
          <p className="acc-card-subtitle">Verify your mobile number via OTP</p>
        </div>
        {currentVerified && currentPhone && step === "idle" && (
          <span className="acc-status-dot acc-status-dot--on">Verified</span>
        )}
      </div>
      <div className="acc-card-body">
        {/* invisible reCAPTCHA mount point */}
        <div id="prf-recaptcha-container" />

        {currentVerified && currentPhone && step === "idle" && (
          <div className="acc-info-grid" style={{ marginBottom: "0.75rem" }}>
            <span className="acc-info-key">Current number</span>
            <span className="acc-info-value acc-info-mono">{currentPhone}</span>
          </div>
        )}

        {(step === "idle" || step === "error") && (
          <>
            <div className="acc-form-row">
              <label className="acc-label" htmlFor="prf-phone">
                {currentPhone ? "Update phone number" : "Phone number"}
              </label>
              <input
                id="prf-phone"
                className="acc-input"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91XXXXXXXXXX"
              />
              <span className="acc-input-hint">Include country code — e.g. +91 for India</span>
            </div>
            {error && <p className="acc-save-error">{error}</p>}
            <div className="acc-form-actions" style={{ borderTop: "none", paddingTop: 0 }}>
              <button className="acc-save-btn" onClick={() => void sendOtp()}>
                Send OTP
              </button>
            </div>
          </>
        )}

        {step === "sending" && (
          <p style={{ color: "#5f6f86", fontSize: "0.83rem" }}>Sending OTP to {phone}…</p>
        )}

        {(step === "sent" || step === "verifying") && (
          <>
            <p style={{ fontSize: "0.83rem", color: "#334155" }}>
              OTP sent to <strong>{phone}</strong>. Enter the 6-digit code below.
            </p>
            <div className="acc-form-row">
              <label className="acc-label" htmlFor="prf-otp">One-time code</label>
              <input
                id="prf-otp"
                className="acc-input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                autoFocus
              />
            </div>
            {error && <p className="acc-save-error">{error}</p>}
            <div className="acc-form-actions" style={{ borderTop: "none", paddingTop: 0 }}>
              <button
                className="acc-secondary-btn"
                onClick={() => { setStep("idle"); setOtp(""); setError(null); }}
                disabled={step === "verifying"}
              >
                Change number
              </button>
              <button
                className="acc-save-btn"
                onClick={() => void verifyOtp()}
                disabled={step === "verifying" || otp.length !== 6}
              >
                {step === "verifying" ? "Verifying…" : "Verify OTP"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Component() {
  const { user, refreshUser } = useAuth();
  const { token } = useDashboardShell();

  const [name, setName] = useState(user?.name ?? "");
  const [profileSavedOk, setProfileSavedOk] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSavedOk, setPwSavedOk] = useState(false);

  useEffect(() => {
    if (user) setName(user.name ?? "");
  }, [user?.id]); // intentionally only re-seed on user identity change

  // Detect if user has password-based login (Firebase email provider)
  const firebaseUser = firebaseAuth.currentUser;
  const hasPasswordProvider = firebaseUser?.providerData.some(
    (p) => p.providerId === "password"
  ) ?? false;

  const profileMutation = useMutation({
    mutationFn: () => updateMyProfile(token, { name }),
    onSuccess: async () => {
      await refreshUser();
      setProfileSavedOk(true);
      setTimeout(() => setProfileSavedOk(false), 3000);
    }
  });

  const pwStrength = passwordStrength(newPw);

  const pwMutation = useMutation({
    mutationFn: async () => {
      if (!firebaseUser || !firebaseUser.email) {
        throw new Error("No Firebase session — please log out and back in.");
      }
      if (newPw.length < 8) {
        throw new Error("New password must be at least 8 characters.");
      }
      if (newPw !== confirmPw) {
        throw new Error("Passwords do not match.");
      }
      const credential = EmailAuthProvider.credential(
        firebaseUser.email,
        currentPw
      );
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, newPw);
    },
    onSuccess: () => {
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setPwError(null);
      setPwSavedOk(true);
      setTimeout(() => setPwSavedOk(false), 3000);
    },
    onError: (e) => {
      const msg = (e as Error).message;
      if (msg.includes("auth/wrong-password") || msg.includes("auth/invalid-credential")) {
        setPwError("Current password is incorrect.");
      } else if (msg.includes("auth/too-many-requests")) {
        setPwError("Too many attempts. Try again later.");
      } else {
        setPwError(msg);
      }
    }
  });

  const handlePwSubmit = () => {
    setPwError(null);
    if (!currentPw) { setPwError("Enter your current password."); return; }
    if (!newPw) { setPwError("Enter a new password."); return; }
    if (newPw !== confirmPw) { setPwError("Passwords do not match."); return; }
    pwMutation.mutate();
  };

  const initials = getInitials(user?.name ?? user?.email ?? "?");

  return (
    <div className="acc-page">
      <div className="acc-page-header">
        <h1 className="acc-page-title">Profile &amp; Password</h1>
      </div>

      {/* ── Identity card ─────────────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">Your profile</h2>
            <p className="acc-card-subtitle">Display name and login email</p>
          </div>
          <div className="acc-profile-avatar">{initials}</div>
        </div>
        <div className="acc-card-body">
          <div className="acc-form-row-inline">
            <div className="acc-form-row">
              <label className="acc-label" htmlFor="prf-name">Display name</label>
              <input
                id="prf-name"
                className="acc-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="acc-form-row">
              <label className="acc-label" htmlFor="prf-email">Email address</label>
              <input
                id="prf-email"
                className="acc-input acc-input-readonly"
                value={user?.email ?? ""}
                readOnly
              />
              <span className="acc-input-hint">Contact support to change your login email</span>
            </div>
          </div>
          <div className="acc-form-actions" style={{ borderTop: "none", paddingTop: 0 }}>
            {profileMutation.isError && (
              <span className="acc-save-error">
                {profileMutation.error instanceof Error
                  ? profileMutation.error.message
                  : "Save failed"}
              </span>
            )}
            {profileSavedOk && <span className="acc-save-success">Name updated</span>}
            <button
              className="acc-save-btn"
              onClick={() => profileMutation.mutate()}
              disabled={profileMutation.isPending || !name.trim()}
            >
              {profileMutation.isPending ? "Saving…" : "Save profile"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Auth provider badge ────────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <h2 className="acc-card-title">Login method</h2>
        </div>
        <div className="acc-card-body">
          <div className="acc-info-grid">
            {firebaseUser?.providerData.map((p) => (
              <span key={p.providerId} className="acc-provider-pill">
                {p.providerId === "password"
                  ? "Email + Password"
                  : p.providerId === "google.com"
                    ? "Google"
                    : p.providerId}
              </span>
            ))}
            {!firebaseUser && (
              <span className="acc-info-value" style={{ color: "#5f6f86" }}>
                Session loaded — refresh to see provider info
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Password change ────────────────────────────────────────────────── */}
      {hasPasswordProvider ? (
        <div className="acc-card">
          <div className="acc-card-head">
            <div>
              <h2 className="acc-card-title">Change password</h2>
              <p className="acc-card-subtitle">Requires your current password to confirm</p>
            </div>
          </div>
          <div className="acc-card-body">
            <div className="acc-form-row-inline">
              <div className="acc-form-row">
                <label className="acc-label" htmlFor="prf-current-pw">Current password</label>
                <input
                  id="prf-current-pw"
                  className="acc-input"
                  type="password"
                  autoComplete="current-password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  placeholder="Your current password"
                />
              </div>
            </div>
            <div className="acc-form-row-inline">
              <div className="acc-form-row">
                <label className="acc-label" htmlFor="prf-new-pw">New password</label>
                <input
                  id="prf-new-pw"
                  className="acc-input"
                  type="password"
                  autoComplete="new-password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="Min. 8 characters"
                />
                {newPw && (
                  <>
                    <div className="acc-password-strength">
                      {[1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className={`acc-strength-bar${pwStrength >= i ? ` ${STRENGTH_CLASSES[pwStrength]}` : ""}`}
                        />
                      ))}
                    </div>
                    <span className="acc-input-hint">{STRENGTH_LABELS[pwStrength]}</span>
                  </>
                )}
              </div>
              <div className="acc-form-row">
                <label className="acc-label" htmlFor="prf-confirm-pw">Confirm new password</label>
                <input
                  id="prf-confirm-pw"
                  className="acc-input"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Repeat new password"
                />
                {confirmPw && newPw !== confirmPw && (
                  <span className="acc-input-hint" style={{ color: "#be123c" }}>
                    Passwords don't match
                  </span>
                )}
              </div>
            </div>
            <div className="acc-form-actions" style={{ borderTop: "none", paddingTop: 0 }}>
              {pwError && <span className="acc-save-error">{pwError}</span>}
              {pwSavedOk && <span className="acc-save-success">Password changed</span>}
              <button
                className="acc-save-btn"
                onClick={handlePwSubmit}
                disabled={pwMutation.isPending}
              >
                {pwMutation.isPending ? "Updating…" : "Update password"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="acc-card">
          <div className="acc-card-head">
            <h2 className="acc-card-title">Change password</h2>
          </div>
          <div className="acc-card-body">
            <p style={{ fontSize: "0.83rem", color: "#5f6f86", margin: 0 }}>
              Your account uses Google sign-in. Password management is handled by Google.
              To reset your password, use the{" "}
              <a
                href="https://accounts.google.com/signin/recovery"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#2563eb" }}
              >
                Google account recovery page
              </a>.
            </p>
          </div>
        </div>
      )}

      {/* ── Phone verification ────────────────────────────────────────────── */}
      <PhoneVerifySection
        currentPhone={user?.phone_number ?? null}
        currentVerified={user?.phone_verified ?? false}
        token={token}
        onSaved={refreshUser}
      />

      {/* ── Danger zone ────────────────────────────────────────────────────── */}
      <div className="acc-danger-zone">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">Danger zone</h2>
            <p className="acc-card-subtitle">Irreversible actions for your account</p>
          </div>
        </div>
        <div className="acc-card-body">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#122033", margin: 0 }}>
                Delete account
              </p>
              <p style={{ fontSize: "0.78rem", color: "#5f6f86", margin: "0.2rem 0 0" }}>
                Permanently removes your workspace, data, and subscription
              </p>
            </div>
            <button
              className="acc-danger-btn"
              onClick={() => window.location.href = "/dashboard/account/delete"}
            >
              Delete my account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function prefetchData() {
  return undefined;
}
