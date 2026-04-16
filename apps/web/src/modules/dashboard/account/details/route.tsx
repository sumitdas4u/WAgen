import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { updateMyProfile } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import "./../account.css";

const PLAN_LABELS: Record<string, string> = {
  trial: "Trial",
  starter: "Starter",
  pro: "Pro",
  business: "Business"
};

function getBasics(raw: Record<string, unknown>) {
  return {
    companyName: typeof raw.companyName === "string" ? raw.companyName : "",
    websiteUrl: typeof raw.websiteUrl === "string" ? raw.websiteUrl : "",
    supportEmail: typeof raw.supportEmail === "string" ? raw.supportEmail : ""
  };
}

export function Component() {
  const { user, refreshUser } = useAuth();
  const { bootstrap, token, refetchBootstrap } = useDashboardShell();

  const basics = getBasics((user?.business_basics as Record<string, unknown>) ?? {});

  const [name, setName] = useState(user?.name ?? "");
  const [companyName, setCompanyName] = useState(
    basics.companyName || bootstrap?.userSummary?.name || ""
  );
  const [businessType, setBusinessType] = useState(user?.business_type ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(basics.websiteUrl);
  const [supportEmail, setSupportEmail] = useState(basics.supportEmail);
  const [savedOk, setSavedOk] = useState(false);

  // Re-seed when auth user loads (async)
  useEffect(() => {
    if (!user) return;
    const b = getBasics((user.business_basics as Record<string, unknown>) ?? {});
    setName(user.name);
    setCompanyName(b.companyName || bootstrap?.userSummary?.name || "");
    setBusinessType(user.business_type ?? "");
    setWebsiteUrl(b.websiteUrl);
    setSupportEmail(b.supportEmail);
  }, [user?.id]); // intentionally only re-seed on user identity change

  const mutation = useMutation({
    mutationFn: () =>
      updateMyProfile(token, { name, companyName, businessType, websiteUrl, supportEmail }),
    onSuccess: async () => {
      await Promise.all([refreshUser(), refetchBootstrap()]);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    }
  });

  const planCode = bootstrap?.planEntitlements.planCode ?? "trial";
  const accountId = bootstrap?.userSummary.id ?? user?.id ?? "—";

  return (
    <div className="acc-page">
      <div className="acc-page-header">
        <h1 className="acc-page-title">Account Details</h1>
      </div>

      {/* ── Workspace card ───────────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">Workspace</h2>
            <p className="acc-card-subtitle">Your company profile visible to customers</p>
          </div>
          <span className={`acc-plan-pill plan-${planCode}`}>
            {PLAN_LABELS[planCode] ?? planCode}
          </span>
        </div>
        <div className="acc-card-body">
          <div className="acc-form-row-inline">
            <div className="acc-form-row">
              <label className="acc-label" htmlFor="acc-company-name">Workspace name</label>
              <input
                id="acc-company-name"
                className="acc-input"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Acme Corp"
              />
              <span className="acc-input-hint">Used in automated messages sent to customers</span>
            </div>
            <div className="acc-form-row">
              <label className="acc-label" htmlFor="acc-business-type">Business type</label>
              <input
                id="acc-business-type"
                className="acc-input"
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                placeholder="e.g. E-commerce, Healthcare, Education"
              />
            </div>
          </div>
          <div className="acc-form-row-inline">
            <div className="acc-form-row">
              <label className="acc-label" htmlFor="acc-website">Website URL</label>
              <input
                id="acc-website"
                className="acc-input"
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://yourcompany.com"
              />
            </div>
            <div className="acc-form-row">
              <label className="acc-label" htmlFor="acc-support-email">Support email</label>
              <input
                id="acc-support-email"
                className="acc-input"
                type="email"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                placeholder="support@yourcompany.com"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Account owner card ───────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">Account Owner</h2>
            <p className="acc-card-subtitle">Your display name and login email</p>
          </div>
        </div>
        <div className="acc-card-body">
          <div className="acc-form-row-inline">
            <div className="acc-form-row">
              <label className="acc-label" htmlFor="acc-owner-name">Your name</label>
              <input
                id="acc-owner-name"
                className="acc-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="acc-form-row">
              <label className="acc-label" htmlFor="acc-email">Email address</label>
              <input
                id="acc-email"
                className="acc-input acc-input-readonly"
                value={user?.email ?? ""}
                readOnly
              />
              <span className="acc-input-hint">Contact support to change your login email</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Read-only info ───────────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <h2 className="acc-card-title">Account Info</h2>
        </div>
        <div className="acc-card-body">
          <div className="acc-info-grid">
            <span className="acc-info-key">Account ID</span>
            <span className="acc-info-value acc-info-mono">{accountId}</span>
            <span className="acc-info-key">Current plan</span>
            <span className="acc-info-value">
              <span className={`acc-plan-pill plan-${planCode}`}>
                {PLAN_LABELS[planCode] ?? planCode}
              </span>
            </span>
            <span className="acc-info-key">AI active</span>
            <span className="acc-info-value">
              {bootstrap?.userSummary.aiActive ? (
                <span className="acc-status-dot acc-status-dot--on">On</span>
              ) : (
                <span className="acc-status-dot acc-status-dot--off">Off</span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* ── Save row ─────────────────────────────────────────────────────── */}
      <div className="acc-form-actions" style={{ borderTop: "none", paddingTop: 0 }}>
        {mutation.isError && (
          <span className="acc-save-error">
            {mutation.error instanceof Error ? mutation.error.message : "Save failed"}
          </span>
        )}
        {savedOk && <span className="acc-save-success">Changes saved</span>}
        <button
          className="acc-save-btn"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

export function prefetchData() {
  return undefined;
}
