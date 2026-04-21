import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { changePassword, updateMyProfile } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import "./../account.css";

const MOCK_OTP = "0000";

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

type PhoneStep = "idle" | "sent" | "verifying" | "done" | "error";

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
  const [step, setStep] = useState<PhoneStep>(currentVerified ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);

  const sendOtp = () => {
    setError(null);
    const normalized = phone.trim();
    if (!normalized.startsWith("+") || normalized.length < 8) {
      setError("Enter phone in international format: +91XXXXXXXXXX");
      return;
    }
    // Mock: advance to OTP entry — no real SMS sent yet
    setStep("sent");
  };

  const verifyOtp = async () => {
    setError(null);
    if (otp.trim() !== MOCK_OTP) {
      setError(`Incorrect OTP. (Use ${MOCK_OTP} during testing.)`);
      return;
    }
    setStep("verifying");
    try {
      await updateMyProfile(token, { phoneNumber: phone.trim(), phoneVerified: true });
      await onSaved();
      setStep("done");
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      setStep("sent");
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
          <div className="acc-form-actions" style={{ borderTop: "none", paddingTop: 0, marginTop: "0.75rem" }}>
            <button
              className="acc-secondary-btn"
              onClick={() => { setStep("idle"); setOtp(""); setError(null); }}
            >
              Change number
            </button>
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
              <button className="acc-save-btn" onClick={sendOtp}>
                Send OTP
              </button>
            </div>
          </>
        )}

        {(step === "sent" || step === "verifying") && (
          <>
            <p style={{ fontSize: "0.83rem", color: "#334155" }}>
              OTP sent to <strong>{phone}</strong>. Enter the 4-digit code below.
            </p>
            <div className="acc-form-row">
              <label className="acc-label" htmlFor="prf-otp">One-time code</label>
              <input
                id="prf-otp"
                className="acc-input"
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="0000"
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
                disabled={step === "verifying" || otp.length !== 4}
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
  }, [user?.id]);

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
      if (newPw.length < 8) throw new Error("New password must be at least 8 characters.");
      if (newPw !== confirmPw) throw new Error("Passwords do not match.");
      await changePassword(token, { currentPassword: currentPw, newPassword: newPw });
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
      if (msg.toLowerCase().includes("current password is incorrect")) {
        setPwError("Current password is incorrect.");
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
                {profileMutation.error instanceof Error ? profileMutation.error.message : "Save failed"}
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
            <span className="acc-provider-pill">Local account session</span>
          </div>
        </div>
      </div>

      {/* ── Password change ────────────────────────────────────────────────── */}
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
