import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { MetaBusinessConfig, MetaBusinessStatus } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import {
  completeMetaSignup,
  deactivateMetaChannel,
  fetchSettingsMetaStatus
} from "../api";
import { useSettingsMetaConfigQuery, useSettingsMetaStatusQuery } from "../queries";

const FACEBOOK_SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

type EmbeddedSignupSnapshot = {
  metaBusinessId?: string;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
};

type FacebookLoginResponse = {
  authResponse?: { code?: string };
  status?: string;
};

type WhatsAppBusinessProfileDraft = {
  displayPictureUrl: string;
  address: string;
  businessDescription: string;
  email: string;
  vertical: string;
  websiteUrl: string;
  about: string;
};

const DEFAULT_PROFILE_DRAFT: WhatsAppBusinessProfileDraft = {
  displayPictureUrl: "",
  address: "",
  businessDescription: "",
  email: "",
  vertical: "Restaurant",
  websiteUrl: "",
  about: ""
};

declare global {
  interface Window {
    FB?: {
      init: (options: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }) => void;
      login: (callback: (response: FacebookLoginResponse) => void, options?: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
    __wagenFacebookSdkPromise?: Promise<void>;
  }
}

function formatPhone(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) return value;
  return `+${digits}`;
}

function formatMetaStatusLabel(value: string | null | undefined, fallback = "Not available"): string {
  const raw = value?.trim();
  if (!raw) return fallback;
  if (/^TIER_/i.test(raw)) return raw.toUpperCase();
  return raw.replace(/[_-]+/g, " ").split(/\s+/).map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).join(" ");
}

function parseMetaTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : null;
}

function getNestedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function readMetaString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  if (typeof value === "string") { const t = value.trim(); return t.length > 0 ? t : null; }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function parseEmbeddedSignupEventData(rawData: unknown): EmbeddedSignupSnapshot | null {
  let payload: unknown = rawData;
  if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { return null; } }
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const candidate = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  const read = (v: unknown) => { if (typeof v !== "string") return undefined; const t = v.trim(); return t || undefined; };
  const snapshot: EmbeddedSignupSnapshot = {
    metaBusinessId: read(candidate.business_id ?? candidate.businessId ?? candidate.meta_business_id),
    wabaId: read(candidate.waba_id ?? candidate.whatsapp_business_account_id),
    phoneNumberId: read(candidate.phone_number_id ?? candidate.phoneNumberId),
    displayPhoneNumber: read(candidate.display_phone_number ?? candidate.displayPhoneNumber)
  };
  if (!snapshot.metaBusinessId && !snapshot.wabaId && !snapshot.phoneNumberId && !snapshot.displayPhoneNumber) return null;
  return snapshot;
}

async function ensureFacebookSdk(appId: string, graphVersion: string): Promise<void> {
  if (typeof window === "undefined") throw new Error("Facebook SDK is only available in browser.");
  const initSdk = () => {
    if (!window.FB) throw new Error("Facebook SDK failed to initialize.");
    window.FB.init({ appId, cookie: true, xfbml: false, version: graphVersion });
  };
  if (window.FB) { initSdk(); return; }
  if (!window.__wagenFacebookSdkPromise) {
    window.__wagenFacebookSdkPromise = new Promise<void>((resolve, reject) => {
      window.fbAsyncInit = () => { try { initSdk(); resolve(); } catch (e) { reject(e); } };
      const existing = document.querySelector<HTMLScriptElement>("script[data-wagen-facebook-sdk='true']");
      if (existing) {
        existing.addEventListener("load", () => window.fbAsyncInit?.());
        existing.addEventListener("error", () => reject(new Error("Failed to load Facebook SDK script.")));
        return;
      }
      const script = document.createElement("script");
      script.async = true; script.defer = true; script.crossOrigin = "anonymous";
      script.src = FACEBOOK_SDK_URL; script.dataset.wagenFacebookSdk = "true";
      script.onload = () => window.fbAsyncInit?.();
      script.onerror = () => reject(new Error("Failed to load Facebook SDK script."));
      document.body.appendChild(script);
    });
  }
  await window.__wagenFacebookSdkPromise;
  initSdk();
}

export function ApiChannelPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { token, bootstrap, refetchBootstrap } = useDashboardShell();
  const [busy, setBusy] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupLoadingText, setSetupLoadingText] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState(DEFAULT_PROFILE_DRAFT);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const metaConfigQuery = useSettingsMetaConfigQuery(token);
  const metaStatusQuery = useSettingsMetaStatusQuery(token);
  const metaStatus: MetaBusinessStatus = metaStatusQuery.data ?? bootstrap?.channelSummary.metaApi ?? ({ connected: false, connection: null } as MetaBusinessStatus);
  const metaConfig = metaConfigQuery.data ?? null;

  const metaHealthRecord = getNestedRecord(metaStatus.connection?.metadata?.metaHealth);
  const businessVerificationStatus = readMetaString(metaHealthRecord, "businessVerificationStatus");
  const wabaReviewStatus = readMetaString(metaHealthRecord, "wabaReviewStatus");
  const qualityRating = readMetaString(metaHealthRecord, "phoneQualityRating");
  const messagingLimitTier = readMetaString(metaHealthRecord, "messagingLimitTier");
  const codeVerificationStatus = readMetaString(metaHealthRecord, "codeVerificationStatus");
  const nameStatus = readMetaString(metaHealthRecord, "nameStatus");
  const lastMetaSyncLabel = parseMetaTimestamp(readMetaString(metaHealthRecord, "syncedAt"));
  const businessVerificationLower = (businessVerificationStatus ?? "").toLowerCase();
  const businessVerificationPending = !/(verified|approved|complete)/.test(businessVerificationLower);

  const updateShellState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsRoot }),
      refetchBootstrap()
    ]);
  };

  const disconnectMutation = useMutation({
    mutationFn: () => deactivateMetaChannel(token, metaStatus.connection?.id),
    onSuccess: async () => { await updateShellState(); setInfo("Official WhatsApp API channel deactivated."); },
    onError: (err) => setError((err as Error).message)
  });

  const currentBusy = busy || setupLoading || disconnectMutation.isPending;

  const openBusinessApiSetup = async () => {
    setBusy(true); setSetupLoading(true); setSetupLoadingText("Opening Facebook login..."); setError(null); setInfo(null);
    try {
      const config: MetaBusinessConfig | null =
        metaConfig ?? (await queryClient.fetchQuery({
          queryKey: dashboardQueryKeys.settingsMetaConfig,
          queryFn: () => metaConfigQuery.refetch().then((r) => r.data ?? null)
        }));
      if (!config || !config.configured || !config.appId || !config.embeddedSignupConfigId) {
        throw new Error("Business API onboarding is not configured yet. Add Meta App settings in backend environment first.");
      }
      await ensureFacebookSdk(config.appId, config.graphVersion);
      setSetupLoadingText("Waiting for Facebook authorization...");
      const captured: EmbeddedSignupSnapshot = {};
      const redirectUri = config.redirectUri || `${window.location.origin}/meta-callback`;
      const messageListener = (event: MessageEvent) => {
        const originHost = (() => { try { return new URL(event.origin).hostname; } catch { return ""; } })();
        if (!originHost.endsWith("facebook.com") && !originHost.endsWith("fbcdn.net")) return;
        const details = parseEmbeddedSignupEventData(event.data);
        if (details) Object.assign(captured, details);
      };
      window.addEventListener("message", messageListener);
      try {
        const response = await new Promise<FacebookLoginResponse>((resolve) => {
          window.FB?.login((r) => resolve(r ?? {}), {
            config_id: config.embeddedSignupConfigId,
            response_type: "code",
            override_default_response_type: true,
            redirect_uri: redirectUri
          });
        });
        const code = response.authResponse?.code?.trim();
        if (!code) throw new Error("Meta signup was cancelled or did not return an authorization code.");
        setSetupLoadingText("Connecting number and syncing Meta status...");
        await completeMetaSignup(token, { code, redirectUri, ...captured });
        await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsMetaStatus });
        await updateShellState();
        setInfo("Official WhatsApp Business API connected successfully.");
      } finally {
        window.removeEventListener("message", messageListener);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false); setSetupLoading(false); setSetupLoadingText(null);
    }
  };

  const refreshMetaStatus = async () => {
    setBusy(true); setSetupLoading(true); setSetupLoadingText("Refreshing channel status from Meta..."); setError(null); setInfo(null);
    try {
      await fetchSettingsMetaStatus(token, true);
      await updateShellState();
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsMetaStatus });
      setInfo("Meta business details refreshed from API.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false); setSetupLoading(false); setSetupLoadingText(null);
    }
  };

  return (
    <section className="finance-shell">
      {(info || error) && (
        <article className="finance-panel">
          {info ? <p className="info-text">{info}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </article>
      )}

      <article className="channel-setup-panel">
        <header>
          <h3>Official WhatsApp API Channel</h3>
          <p>Connect Meta Embedded Signup for stable production messaging at scale, then configure business profile.</p>
        </header>

        {setupLoading && (
          <div className="dashboard-connection-loading api-setup-loading-card" role="status" aria-live="polite">
            <p className="dashboard-connection-loading-title">Syncing Meta channel...</p>
            <p className="dashboard-connection-loading-subtitle">{setupLoadingText ?? "Fetching latest number and verification status."}</p>
            <div className="dashboard-connection-loading-track" aria-hidden="true">
              <span className="dashboard-connection-loading-value" />
            </div>
          </div>
        )}

        <div className="api-setup-alert">
          <strong>Facebook Business Verification — {formatMetaStatusLabel(businessVerificationStatus, "Pending")}</strong>
          <p>
            {businessVerificationPending
              ? "Please complete Meta business verification to unlock higher messaging limits and stable deliverability."
              : "Business verification is in a healthy state. Keep profile and compliance details updated in Meta."}
          </p>
        </div>

        <div className="clone-channel-meta">
          <div><h3>Status</h3><p>{metaStatus.connection?.status ?? "disconnected"}</p></div>
          <div><h3>Linked Number</h3><p>{metaStatus.connection?.linkedNumber ? formatPhone(metaStatus.connection.linkedNumber) : (metaStatus.connection?.displayPhoneNumber ?? "Not linked")}</p></div>
          <div><h3>WABA ID</h3><p>{metaStatus.connection?.wabaId ?? "Not connected"}</p></div>
        </div>
        <div className="clone-channel-meta">
          <div><h3>Quality Rating</h3><p>{formatMetaStatusLabel(qualityRating)}</p></div>
          <div><h3>Message Limit</h3><p>{formatMetaStatusLabel(messagingLimitTier)}</p></div>
          <div><h3>Code Verification</h3><p>{formatMetaStatusLabel(codeVerificationStatus)}</p></div>
        </div>
        <div className="clone-channel-meta">
          <div><h3>Name Status</h3><p>{formatMetaStatusLabel(nameStatus)}</p></div>
          <div><h3>Account Review</h3><p>{formatMetaStatusLabel(wabaReviewStatus)}</p></div>
          <div><h3>Last Meta Sync</h3><p>{lastMetaSyncLabel ?? "Not synced"}</p></div>
        </div>

        <div className="api-profile-tabs">
          {["Profile", "Compliance Info", "Assignments", "Configuration", "Channel Logs"].map((tab) => (
            <button key={tab} type="button" className={tab === "Profile" ? "active" : ""}>{tab}</button>
          ))}
        </div>

        <form className="api-profile-form" onSubmit={(e) => {
          e.preventDefault();
          if (!user?.id) return;
          window.localStorage.setItem(`wagenai_whatsapp_business_profile_draft_${user.id}`, JSON.stringify(profileDraft));
          setInfo("WhatsApp Business profile draft saved.");
        }}>
          <label>WhatsApp Display Picture URL<input value={profileDraft.displayPictureUrl} onChange={(e) => setProfileDraft((c) => ({ ...c, displayPictureUrl: e.target.value }))} placeholder="https://..." /></label>
          <label>Address<textarea rows={2} maxLength={256} value={profileDraft.address} onChange={(e) => setProfileDraft((c) => ({ ...c, address: e.target.value }))} placeholder="Enter address" /></label>
          <label>Business Description<textarea rows={3} maxLength={256} value={profileDraft.businessDescription} onChange={(e) => setProfileDraft((c) => ({ ...c, businessDescription: e.target.value }))} placeholder="Message not available now, leave a message" /></label>
          <label>Email<input type="email" maxLength={128} value={profileDraft.email} onChange={(e) => setProfileDraft((c) => ({ ...c, email: e.target.value }))} placeholder="Enter email" /></label>
          <label>Vertical
            <select value={profileDraft.vertical} onChange={(e) => setProfileDraft((c) => ({ ...c, vertical: e.target.value }))}>
              {["Restaurant", "Retail", "Education", "Healthcare", "Services"].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label>Website URL<input value={profileDraft.websiteUrl} onChange={(e) => setProfileDraft((c) => ({ ...c, websiteUrl: e.target.value }))} placeholder="https://your-website.com" /></label>
          <label>About<input maxLength={139} value={profileDraft.about} onChange={(e) => setProfileDraft((c) => ({ ...c, about: e.target.value }))} placeholder="Official WhatsApp Business Account" /></label>
          <div className="clone-hero-actions">
            <button type="submit" className="primary-btn">Apply</button>
            <button type="button" className="ghost-btn" onClick={() => setProfileDraft(DEFAULT_PROFILE_DRAFT)}>Cancel</button>
          </div>
        </form>

        <div className="clone-hero-actions">
          <button type="button" className="primary-btn" disabled={currentBusy} onClick={() => void openBusinessApiSetup()}>
            {metaStatus.connection ? "Reconnect API" : "Connect API"}
          </button>
          <button type="button" className="ghost-btn" disabled={currentBusy || !metaStatus.connection} onClick={() => void refreshMetaStatus()}>
            Refresh status
          </button>
          <button type="button" className="ghost-btn" disabled={currentBusy || !metaStatus.connection} onClick={() => { setError(null); setInfo(null); disconnectMutation.mutate(); }}>
            Disconnect
          </button>
        </div>
        <p className="tiny-note">Official API channel is recommended for long-term growth and higher reliability.</p>
      </article>

      <article className="channel-setup-panel account-danger-panel">
        <header>
          <h3>Account Settings</h3>
          <p>Delete your account permanently. This revokes connected WhatsApp tokens, removes webhook subscriptions, and deletes associated business data.</p>
        </header>
        <div className="web-widget-row">
          <label>
            Type <strong>DELETE</strong> to confirm
            <input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="DELETE" />
          </label>
        </div>
        <div className="clone-hero-actions">
          <button
            type="button"
            className="account-danger-btn"
            disabled={currentBusy || deleting || deleteConfirmText.trim() !== "DELETE"}
            onClick={() => {
              if (deleteConfirmText.trim() !== "DELETE") { setError('Type "DELETE" to confirm.'); return; }
              if (!window.confirm("This will permanently delete your account. Continue?")) return;
              setDeleting(true);
            }}
          >
            {deleting ? "Deleting..." : "Delete Account"}
          </button>
        </div>
        <p className="tiny-note">This action is irreversible.</p>
      </article>
    </section>
  );
}
