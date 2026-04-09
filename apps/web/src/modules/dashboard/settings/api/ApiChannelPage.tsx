import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { MetaBusinessConfig, MetaBusinessProfile, MetaBusinessStatus } from "../../../../lib/api";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import {
  completeMetaSignup,
  deactivateMetaChannel,
  fetchSettingsMetaProfile,
  fetchSettingsMetaStatus,
  saveSettingsMetaProfile,
  uploadSettingsMetaProfileLogo
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

const PROFILE_QUERY_KEY = [...dashboardQueryKeys.settingsMetaStatus, "profile"] as const;
const PROFILE_VERTICAL_OPTIONS = ["Restaurant", "Retail", "Education", "Healthcare", "Services", "Other"];

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
  const { token, bootstrap, refetchBootstrap } = useDashboardShell();
  const [busy, setBusy] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupLoadingText, setSetupLoadingText] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState(DEFAULT_PROFILE_DRAFT);
  const [profilePictureHandle, setProfilePictureHandle] = useState<string | null>(null);
  const [profilePicturePreviewUrl, setProfilePicturePreviewUrl] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const metaConfigQuery = useSettingsMetaConfigQuery(token);
  const metaStatusQuery = useSettingsMetaStatusQuery(token);
  const metaStatus: MetaBusinessStatus = metaStatusQuery.data ?? bootstrap?.channelSummary.metaApi ?? ({ connected: false, connection: null } as MetaBusinessStatus);
  const metaConfig = metaConfigQuery.data ?? null;
  const connectionId = metaStatus.connection?.id;
  const isConnected = Boolean(metaStatus.connection);

  const metaHealthRecord = getNestedRecord(metaStatus.connection?.metadata?.metaHealth);
  const businessVerificationStatus = readMetaString(metaHealthRecord, "businessVerificationStatus");
  const messagingLimitTier = readMetaString(metaHealthRecord, "messagingLimitTier");
  const nameStatus = readMetaString(metaHealthRecord, "nameStatus");
  const verifiedName = readMetaString(metaHealthRecord, "verifiedName");
  const lastMetaSyncLabel = parseMetaTimestamp(readMetaString(metaHealthRecord, "syncedAt"));
  const businessVerificationLower = (businessVerificationStatus ?? "").toLowerCase();
  const businessVerificationPending = !/(verified|approved|complete)/.test(businessVerificationLower);
  const sharedBillingSupported = Boolean(metaConfig?.sharedBillingSupported);
  const sharedBillingRequired = Boolean(metaConfig?.sharedBillingRequired);
  const billingStatusLabel = formatMetaStatusLabel(
    metaStatus.connection?.billingStatus,
    sharedBillingSupported ? "Pending" : "Not configured"
  );
  const profileQuery = useQuery({
    queryKey: [...PROFILE_QUERY_KEY, connectionId ?? "none"],
    enabled: Boolean(connectionId),
    queryFn: async () => {
      const response = await fetchSettingsMetaProfile(token, connectionId);
      return response.profile;
    }
  });

  useEffect(() => {
    if (!connectionId) {
      setProfileDraft(DEFAULT_PROFILE_DRAFT);
      setProfilePictureHandle(null);
      setProfilePicturePreviewUrl(null);
      return;
    }
    const profile = profileQuery.data;
    if (!profile) {
      return;
    }
    setProfileDraft({
      displayPictureUrl: profile.displayPictureUrl ?? "",
      address: profile.address ?? "",
      businessDescription: profile.businessDescription ?? "",
      email: profile.email ?? "",
      vertical: profile.vertical ?? DEFAULT_PROFILE_DRAFT.vertical,
      websiteUrl: profile.websites[0] ?? "",
      about: profile.about ?? ""
    });
    setProfilePictureHandle(null);
    setProfilePicturePreviewUrl(null);
  }, [connectionId, profileQuery.data]);

  const updateShellState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsRoot }),
      refetchBootstrap()
    ]);
  };

  const disconnectMutation = useMutation({
    mutationFn: () => deactivateMetaChannel(token, metaStatus.connection?.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsMetaStatus }),
        queryClient.removeQueries({ queryKey: PROFILE_QUERY_KEY }),
        updateShellState()
      ]);
      setInfo("Official WhatsApp API channel deactivated.");
    },
    onError: (err) => setError((err as Error).message)
  });
  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      const response = await saveSettingsMetaProfile(token, {
        connectionId,
        address: profileDraft.address,
        businessDescription: profileDraft.businessDescription,
        email: profileDraft.email,
        vertical: profileDraft.vertical,
        websiteUrl: profileDraft.websiteUrl,
        about: profileDraft.about,
        profilePictureHandle
      });
      return response.profile;
    },
    onSuccess: async (profile) => {
      queryClient.setQueryData([...PROFILE_QUERY_KEY, connectionId ?? "none"], profile);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsMetaStatus }),
        updateShellState()
      ]);
      setProfilePictureHandle(null);
      setProfileDraft({
        displayPictureUrl: profile.displayPictureUrl ?? "",
        address: profile.address ?? "",
        businessDescription: profile.businessDescription ?? "",
        email: profile.email ?? "",
        vertical: profile.vertical ?? DEFAULT_PROFILE_DRAFT.vertical,
        websiteUrl: profile.websites[0] ?? "",
        about: profile.about ?? ""
      });
      setInfo("WhatsApp Business profile updated on Meta.");
    },
    onError: (err) => setError((err as Error).message)
  });
  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const response = await uploadSettingsMetaProfileLogo(token, file, connectionId);
      return { file, handle: response.handle };
    },
    onSuccess: ({ file, handle }) => {
      const previewUrl = URL.createObjectURL(file);
      if (profilePicturePreviewUrl) {
        URL.revokeObjectURL(profilePicturePreviewUrl);
      }
      setProfilePicturePreviewUrl(previewUrl);
      setProfilePictureHandle(handle);
      setProfileDraft((current) => ({ ...current, displayPictureUrl: previewUrl }));
      setInfo("Logo uploaded. Click Apply to publish it to Meta.");
    },
    onError: (err) => setError((err as Error).message)
  });

  const currentBusy = busy || setupLoading || disconnectMutation.isPending;

  const resetProfileDraft = (profile?: MetaBusinessProfile | null) => {
    const nextProfile = profile ?? profileQuery.data ?? null;
    if (!nextProfile) {
      setProfileDraft(DEFAULT_PROFILE_DRAFT);
      setProfilePictureHandle(null);
      if (profilePicturePreviewUrl) {
        URL.revokeObjectURL(profilePicturePreviewUrl);
      }
      setProfilePicturePreviewUrl(null);
      return;
    }
    if (profilePicturePreviewUrl) {
      URL.revokeObjectURL(profilePicturePreviewUrl);
    }
    setProfileDraft({
      displayPictureUrl: nextProfile.displayPictureUrl ?? "",
      address: nextProfile.address ?? "",
      businessDescription: nextProfile.businessDescription ?? "",
      email: nextProfile.email ?? "",
      vertical: nextProfile.vertical ?? DEFAULT_PROFILE_DRAFT.vertical,
      websiteUrl: nextProfile.websites[0] ?? "",
      about: nextProfile.about ?? ""
    });
    setProfilePictureHandle(null);
    setProfilePicturePreviewUrl(null);
  };

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
            redirect_uri: redirectUri,
            extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" }
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

        {!isConnected && sharedBillingSupported ? (
          <div className="api-setup-alert">
            <strong>Shared Meta Billing Enabled</strong>
            <p>
              New numbers onboarded here will try to use WAgen&apos;s Meta billing in {metaConfig?.sharedBillingCurrency ?? "your configured currency"}.
              {sharedBillingRequired ? " If billing attachment fails, the API channel can still connect and the billing issue will be shown separately." : ""}
            </p>
          </div>
        ) : null}

        {setupLoading && (
          <div className="dashboard-connection-loading api-setup-loading-card" role="status" aria-live="polite">
            <p className="dashboard-connection-loading-title">Syncing Meta channel...</p>
            <p className="dashboard-connection-loading-subtitle">{setupLoadingText ?? "Fetching latest number and verification status."}</p>
            <div className="dashboard-connection-loading-track" aria-hidden="true">
              <span className="dashboard-connection-loading-value" />
            </div>
          </div>
        )}

        {!isConnected ? (
          <div className="api-setup-alert">
            <strong>WhatsApp API is not connected</strong>
            <p>
              Connect your Meta WhatsApp Business number to start sending messages, syncing your profile, and managing your API channel from this page.
            </p>
          </div>
        ) : (
          <>
            <div className="clone-channel-meta">
              <div><h3>Connected Number</h3><p>{metaStatus.connection?.linkedNumber ? formatPhone(metaStatus.connection.linkedNumber) : (metaStatus.connection?.displayPhoneNumber ?? "Not linked")}</p></div>
              <div><h3>Display Name</h3><p>{verifiedName ?? "Not available"}</p></div>
              <div><h3>Name Approval</h3><p>{formatMetaStatusLabel(nameStatus, "Pending")}</p></div>
            </div>

            <div className="api-setup-alert">
              <strong>Facebook Business Verification — {formatMetaStatusLabel(businessVerificationStatus, "Pending")}</strong>
              <p>
                {businessVerificationPending
                  ? "Please complete Meta business verification to unlock higher messaging limits and stable deliverability."
                  : "Business verification is in a healthy state. Keep profile and compliance details updated in Meta."}
              </p>
            </div>

            <div className="clone-channel-meta">
              <div><h3>Status</h3><p>{metaStatus.connection?.status ?? "connected"}</p></div>
              <div><h3>Message Limit</h3><p>{formatMetaStatusLabel(messagingLimitTier)}</p></div>
              <div><h3>Last Meta Sync</h3><p>{lastMetaSyncLabel ?? "Not synced"}</p></div>
            </div>

            {(metaStatus.connection?.billingError || sharedBillingSupported) ? (
              <div className="api-setup-alert">
                <strong>Billing</strong>
                <p>
                  {metaStatus.connection?.billingError
                    ? metaStatus.connection.billingError
                    : `Mode: ${formatMetaStatusLabel(metaStatus.connection?.billingMode, sharedBillingSupported ? "Partner" : "None")} | Status: ${billingStatusLabel} | Currency: ${metaStatus.connection?.billingCurrency ?? metaConfig?.sharedBillingCurrency ?? "Not set"}`}
                </p>
              </div>
            ) : null}

            <div className="api-setup-alert">
              <strong>Profile</strong>
              <p>
                Update your business logo and profile details here. Display name review and Official Business Account approval still follow Meta&apos;s own review process.
              </p>
            </div>

            <form className="api-profile-form" onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              setInfo(null);
              saveProfileMutation.mutate();
            }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    return;
                  }
                  setError(null);
                  setInfo(null);
                  uploadLogoMutation.mutate(file);
                  event.currentTarget.value = "";
                }}
              />
              <label>
                WhatsApp Display Picture
                <div className="clone-hero-actions" style={{ alignItems: "center" }}>
                  <input value={profileDraft.displayPictureUrl} readOnly placeholder="Upload logo to generate Meta profile image handle" />
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={!connectionId || uploadLogoMutation.isPending}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploadLogoMutation.isPending ? "Uploading..." : "Upload logo"}
                  </button>
                </div>
                {profileDraft.displayPictureUrl ? (
                  <div style={{ marginTop: 12 }}>
                    <img
                      src={profileDraft.displayPictureUrl}
                      alt="WhatsApp business logo preview"
                      style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 12, border: "1px solid rgba(15, 23, 42, 0.12)" }}
                    />
                  </div>
                ) : null}
              </label>
              <label>Category
                <select value={profileDraft.vertical} onChange={(e) => setProfileDraft((c) => ({ ...c, vertical: e.target.value }))}>
                  {PROFILE_VERTICAL_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label>Description<textarea rows={3} maxLength={256} value={profileDraft.businessDescription} onChange={(e) => setProfileDraft((c) => ({ ...c, businessDescription: e.target.value }))} placeholder="Tell customers what your business does" /></label>
              <label>Address<textarea rows={2} maxLength={256} value={profileDraft.address} onChange={(e) => setProfileDraft((c) => ({ ...c, address: e.target.value }))} placeholder="Enter address" /></label>
              <label>Email<input type="email" maxLength={128} value={profileDraft.email} onChange={(e) => setProfileDraft((c) => ({ ...c, email: e.target.value }))} placeholder="Enter email" /></label>
              <label>Website URL<input value={profileDraft.websiteUrl} onChange={(e) => setProfileDraft((c) => ({ ...c, websiteUrl: e.target.value }))} placeholder="https://your-website.com" /></label>
              <label>About<input maxLength={139} value={profileDraft.about} onChange={(e) => setProfileDraft((c) => ({ ...c, about: e.target.value }))} placeholder="Official WhatsApp Business Account" /></label>
              <div className="clone-hero-actions">
                <button type="submit" className="primary-btn" disabled={!connectionId || saveProfileMutation.isPending || uploadLogoMutation.isPending}>
                  {saveProfileMutation.isPending ? "Applying..." : "Save Profile"}
                </button>
                <button type="button" className="ghost-btn" disabled={!connectionId} onClick={() => resetProfileDraft()}>
                  Reset
                </button>
              </div>
            </form>
          </>
        )}

        <div className="clone-hero-actions">
          <button type="button" className="primary-btn" disabled={currentBusy} onClick={() => void openBusinessApiSetup()}>
            {isConnected ? "Reconnect API" : "Connect WhatsApp API"}
          </button>
          <button type="button" className="ghost-btn" disabled={currentBusy || !isConnected} onClick={() => void refreshMetaStatus()}>
            Refresh status
          </button>
          <button type="button" className="ghost-btn" disabled={currentBusy || !isConnected} onClick={() => { setError(null); setInfo(null); disconnectMutation.mutate(); }}>
            Disconnect
          </button>
        </div>
        <p className="tiny-note">
          {isConnected
            ? "Your API channel is connected. Use this page to manage the Meta profile and channel health."
            : "Connect first. After that, this page will show only the information needed to manage your WhatsApp API channel."}
        </p>
        {profileQuery.isFetching && connectionId ? <p className="tiny-note">Refreshing business profile from Meta...</p> : null}
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
