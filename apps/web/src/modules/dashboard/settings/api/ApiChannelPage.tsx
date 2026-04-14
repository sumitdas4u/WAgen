import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  fetchPublishedFlows,
  type ChannelDefaultReplyConfig,
  type MetaBusinessConfig,
  type MetaBusinessConnection,
  type MetaBusinessStatus,
  type PublishedFlowSummary
} from "../../../../lib/api";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { getConnectionActiveLabel, isMetaConnectionActive } from "../../../../shared/dashboard/meta-connection-selector";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import {
  completeMetaSignup,
  deactivateMetaChannel,
  fetchSettingsChannelDefaultReply,
  fetchSettingsMetaStatus,
  saveSettingsChannelDefaultReply,
  setApiChannelEnabled,
} from "../api";
import { useSettingsMetaConfigQuery, useSettingsMetaConnectionsQuery, useSettingsMetaStatusQuery } from "../queries";

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
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInactiveChannels, setShowInactiveChannels] = useState(false);
  const [defaultReplyConfig, setDefaultReplyConfig] = useState<ChannelDefaultReplyConfig | null>(null);
  const [defaultReplyFlows, setDefaultReplyFlows] = useState<PublishedFlowSummary[]>([]);
  const [defaultReplySaving, setDefaultReplySaving] = useState(false);

  const metaConfigQuery = useSettingsMetaConfigQuery(token);
  const metaStatusQuery = useSettingsMetaStatusQuery(token);
  const metaConnectionsQuery = useSettingsMetaConnectionsQuery(token);
  const metaStatus: MetaBusinessStatus = metaStatusQuery.data ?? bootstrap?.channelSummary.metaApi ?? ({ connected: false, enabled: false, connection: null } as MetaBusinessStatus);
  const connections = metaConnectionsQuery.data ?? metaStatus.connections ?? [];
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(() => metaStatus.connection?.id ?? connections[0]?.id ?? "");
  useEffect(() => {
    setSelectedConnectionId((current) => {
      if (current && connections.some((connection) => connection.id === current)) {
        return current;
      }
      return metaStatus.connection?.id ?? connections[0]?.id ?? "";
    });
  }, [connections, metaStatus.connection?.id]);
  const selectedConnection: MetaBusinessConnection | null =
    connections.find((connection) => connection.id === selectedConnectionId) ??
    metaStatus.connection ??
    null;
  const activeConnections = connections.filter((connection) => isMetaConnectionActive(connection));
  const inactiveConnections = connections.filter((connection) => !isMetaConnectionActive(connection));
  const visibleConnections = showInactiveChannels ? connections : activeConnections;

  useEffect(() => {
    if (showInactiveChannels) {
      return;
    }
    if (!selectedConnection || isMetaConnectionActive(selectedConnection)) {
      return;
    }
    if (activeConnections.length > 0) {
      setSelectedConnectionId(activeConnections[0].id);
    }
  }, [activeConnections, selectedConnection, showInactiveChannels]);

  const metaConfig = metaConfigQuery.data ?? null;
  const hasConnection = Boolean(selectedConnection);
  const isConnected = Boolean(isMetaConnectionActive(selectedConnection));
  const channelEnabled = selectedConnection?.enabled ?? metaStatus.enabled;

  const metaHealthRecord = getNestedRecord(selectedConnection?.metadata?.metaHealth);
  const businessVerificationStatus = readMetaString(metaHealthRecord, "businessVerificationStatus");
  const messagingLimitTier = readMetaString(metaHealthRecord, "messagingLimitTier");
  const nameStatus = readMetaString(metaHealthRecord, "nameStatus");
  const verifiedName = readMetaString(metaHealthRecord, "verifiedName");
  const lastMetaSyncLabel = parseMetaTimestamp(readMetaString(metaHealthRecord, "syncedAt"));
  const businessVerificationLower = (businessVerificationStatus ?? "").toLowerCase();
  const businessVerificationPending = !/(verified|approved|complete)/.test(businessVerificationLower);
  const sharedBillingSupported = Boolean(metaConfig?.sharedBillingSupported);
  const billingStatusLabel = formatMetaStatusLabel(
    selectedConnection?.billingStatus,
    sharedBillingSupported ? "Pending" : "Not configured"
  );
  const defaultReplyMode = defaultReplyConfig?.mode ?? "manual";
  const defaultReplyFlowId = defaultReplyConfig?.flowId ?? "";

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchSettingsChannelDefaultReply(token, "api"),
      fetchPublishedFlows(token)
    ])
      .then(([configResponse, flowsResponse]) => {
        if (cancelled) {
          return;
        }
        setDefaultReplyConfig(configResponse.config);
        setDefaultReplyFlows(flowsResponse.filter((flow) => flow.channel === "api"));
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("[ApiChannelPage] Failed to load default reply settings", err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const updateShellState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsRoot }),
      refetchBootstrap()
    ]);
  };

  const disconnectMutation = useMutation({
    mutationFn: () => deactivateMetaChannel(token, selectedConnection?.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsMetaStatus }),
        updateShellState()
      ]);
      setInfo("Official WhatsApp API channel disconnected.");
    },
    onError: (err) => setError((err as Error).message)
  });

  const toggleMutation = useMutation({
    mutationFn: async () => {
      await setApiChannelEnabled(token, !channelEnabled, selectedConnection?.id);
      return channelEnabled
        ? "Official WhatsApp API channel paused. The Meta connection stays linked, but automated replies are temporarily off."
        : "Official WhatsApp API channel resumed. The Meta connection stays linked and automated replies are back on.";
    },
    onSuccess: async (message) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsMetaStatus }),
        updateShellState()
      ]);
      setInfo(message);
    },
    onError: (err) => setError((err as Error).message)
  });

  const currentBusy = busy || setupLoading || disconnectMutation.isPending || toggleMutation.isPending;

  const openBusinessApiSetup = async (options?: { skipInitialLoading?: boolean }) => {
    if (!options?.skipInitialLoading) {
      setBusy(true);
      setSetupLoading(true);
      setSetupLoadingText("Opening Facebook login...");
      setError(null);
      setInfo(null);
    }
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
        const result = await completeMetaSignup(token, { code, redirectUri, ...captured });
        setSelectedConnectionId(result.connection.id);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsMetaStatus }),
          queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsMetaConnections })
        ]);
        await updateShellState();
        setSelectedConnectionId(result.connection.id);
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

  const handleConnectOrReconnect = async () => {
    if (isConnected) {
      if (!window.confirm("Reconnect Official WhatsApp API? This will disconnect the current API connection before starting a fresh connection flow.")) {
        return;
      }
      setBusy(true);
      setSetupLoading(true);
      setSetupLoadingText("Disconnecting current API connection...");
      setError(null);
      setInfo(null);
      try {
        await deactivateMetaChannel(token, selectedConnection?.id);
        await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsMetaStatus });
        await updateShellState();
        await openBusinessApiSetup({ skipInitialLoading: true });
      } catch (err) {
        setError((err as Error).message);
        setBusy(false);
        setSetupLoading(false);
        setSetupLoadingText(null);
      }
      return;
    }

    await openBusinessApiSetup();
  };

  const handleDisconnect = () => {
    if (!window.confirm("Disconnect Official WhatsApp API? This will remove the current API connection until you connect again.")) {
      return;
    }
    setError(null);
    setInfo(null);
    disconnectMutation.mutate();
  };

  const handleAddNew = async () => {
    await openBusinessApiSetup();
  };

  const handleSaveDefaultReply = async () => {
    if (!defaultReplyConfig) {
      return;
    }
    if (defaultReplyConfig.mode === "flow" && !defaultReplyConfig.flowId) {
      setError("Select a published API flow before saving default reply settings.");
      setInfo(null);
      return;
    }

    setDefaultReplySaving(true);
    setError(null);
    setInfo(null);
    try {
      const response = await saveSettingsChannelDefaultReply(token, "api", {
        mode: defaultReplyConfig.mode,
        flowId: defaultReplyConfig.mode === "flow" ? defaultReplyConfig.flowId : null
      });
      setDefaultReplyConfig(response.config);
      setInfo("Default reply settings saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDefaultReplySaving(false);
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h3>Official WhatsApp API Channel</h3>
              <p>Connect Meta Embedded Signup for stable production messaging at scale, then pause or resume replies without disconnecting the API number.</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <button type="button" className="ghost-btn" disabled={currentBusy} onClick={() => void handleAddNew()}>
                Add New
              </button>
              <button
                type="button"
                className={channelEnabled ? "go-live-switch on" : "go-live-switch"}
                disabled={currentBusy || !hasConnection}
                onClick={() => { setError(null); setInfo(null); toggleMutation.mutate(); }}
                title={channelEnabled ? "Pause API channel replies" : "Resume API channel replies"}
              >
                <span />
              </button>
            </div>
          </div>
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

        <div
          style={{
            border: "1px solid #dbe4ee",
            borderRadius: "16px",
            padding: "1rem 1.1rem",
            background: "#f8fafc",
            marginBottom: "1rem",
            display: "grid",
            gap: "0.8rem"
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "1rem", color: "#0f172a" }}>Default Reply</h3>
            <p style={{ margin: "0.25rem 0 0", color: "#475569", fontSize: "0.9rem" }}>
              Choose what should happen when no flow matches, or when a flow gets invalid replies twice.
            </p>
          </div>
          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span style={{ fontSize: "0.8rem", color: "#475569", fontWeight: 600 }}>Reply mode</span>
              <select
                value={defaultReplyMode}
                disabled={defaultReplySaving}
                onChange={(event) =>
                  setDefaultReplyConfig((current) =>
                    current
                      ? {
                          ...current,
                          mode: event.target.value as ChannelDefaultReplyConfig["mode"],
                          flowId: event.target.value === "flow" ? current.flowId : null
                        }
                      : current
                  )
                }
                style={{ minHeight: "42px", borderRadius: "10px", border: "1px solid #cbd5e1", padding: "0 0.8rem" }}
              >
                <option value="manual">Manual reply</option>
                <option value="flow">Flow</option>
                <option value="ai">AI</option>
              </select>
            </label>

            {defaultReplyMode === "flow" ? (
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span style={{ fontSize: "0.8rem", color: "#475569", fontWeight: 600 }}>Default flow</span>
                <select
                  value={defaultReplyFlowId}
                  disabled={defaultReplySaving}
                  onChange={(event) =>
                    setDefaultReplyConfig((current) =>
                      current
                        ? {
                            ...current,
                            flowId: event.target.value || null
                          }
                        : current
                    )
                  }
                  style={{ minHeight: "42px", borderRadius: "10px", border: "1px solid #cbd5e1", padding: "0 0.8rem" }}
                >
                  <option value="">Select published API flow</option>
                  {defaultReplyFlows.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.82rem" }}>
              {defaultReplyMode === "manual"
                ? "Manual means the bot stays silent until a human replies."
                : defaultReplyMode === "ai"
                  ? "AI uses your active bot profile for this channel."
                  : "Flow mode sends the selected published flow as the fallback reply."}
            </p>
            <button
              type="button"
              className="primary-btn"
              disabled={defaultReplySaving || (defaultReplyMode === "flow" && !defaultReplyFlowId)}
              onClick={() => void handleSaveDefaultReply()}
            >
              {defaultReplySaving ? "Saving..." : "Save default reply"}
            </button>
          </div>
        </div>

        {connections.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem", marginBottom: "1rem" }}>
            {visibleConnections.length > 0 ? visibleConnections.map((connection) => {
              const active = isMetaConnectionActive(connection);
              const selected = selectedConnection?.id === connection.id;
              return (
                <button
                  key={connection.id}
                  type="button"
                  onClick={() => setSelectedConnectionId(connection.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 0.8fr 0.8fr 0.8fr auto",
                    gap: "1rem",
                    alignItems: "center",
                    width: "100%",
                    textAlign: "left",
                    padding: "1rem 1.1rem",
                    borderRadius: "14px",
                    border: selected
                      ? (active ? "1.5px solid #16a34a" : "1.5px solid #2563eb")
                      : active ? "1px solid #bbf7d0" : "1px solid #dbe4ee",
                    background: selected
                      ? (active ? "#f0fdf4" : "#eff6ff")
                      : active ? "#f7fee7" : "#fff"
                  }}
                >
                  <div>
                    <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Phone number</div>
                    <div style={{ fontWeight: 700, color: "#0f172a" }}>{formatPhone(connection.linkedNumber ?? connection.displayPhoneNumber ?? "Unknown")}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Business Manager ID</div>
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>{connection.metaBusinessId ?? "Not available"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Status</div>
                    <div style={{ fontWeight: 600, color: active ? "#15803d" : "#b45309" }}>{getConnectionActiveLabel(connection)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Billing</div>
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>{formatMetaStatusLabel(connection.billingStatus, "Pending")}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Limit</div>
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>{formatMetaStatusLabel(readMetaString(getNestedRecord(connection.metadata?.metaHealth), "messagingLimitTier"), "Unknown")}</div>
                  </div>
                  <div style={{ justifySelf: "end", fontSize: "0.78rem", color: active ? "#15803d" : "#92400e" }}>
                    {selected ? "Selected" : "Select"}
                  </div>
                </button>
              );
            }) : (
              <div
                style={{
                  border: "1px dashed #cbd5e1",
                  borderRadius: "14px",
                  padding: "0.9rem 1rem",
                  background: "#f8fafc",
                  color: "#475569",
                  fontSize: "0.92rem"
                }}
              >
                No active channels found.
              </div>
            )}
            {inactiveConnections.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowInactiveChannels((current) => !current)}
                style={{
                  justifySelf: "start",
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  color: "#475569",
                  fontSize: "0.84rem",
                  textDecoration: "underline",
                  cursor: "pointer"
                }}
              >
                {showInactiveChannels
                  ? "Hide inactive channels"
                  : `Show inactive channels (${inactiveConnections.length})`}
              </button>
            ) : null}
          </div>
        ) : null}

        {!isConnected ? (
          <div className="api-setup-alert">
            <strong>WhatsApp API is not connected</strong>
            <p>
              Connect your Meta WhatsApp Business number first. After onboarding is completed successfully, the channel details will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="clone-channel-meta">
              <div><h3>Connected Number</h3><p>{selectedConnection?.linkedNumber ? formatPhone(selectedConnection.linkedNumber) : (selectedConnection?.displayPhoneNumber ?? "Not linked")}</p></div>
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
              <div><h3>Channel</h3><p>{channelEnabled ? "Active" : "Inactive"}</p></div>
              <div><h3>Connection</h3><p>{selectedConnection?.status ?? "connected"}</p></div>
              <div><h3>Message Limit</h3><p>{formatMetaStatusLabel(messagingLimitTier)}</p></div>
              <div><h3>Last Meta Sync</h3><p>{lastMetaSyncLabel ?? "Not synced"}</p></div>
            </div>

            {(selectedConnection?.billingError || sharedBillingSupported) ? (
              <div className="api-setup-alert">
                <strong>Billing</strong>
                <p>
                  {selectedConnection?.billingError
                    ? selectedConnection.billingError
                    : `Mode: ${formatMetaStatusLabel(selectedConnection?.billingMode, sharedBillingSupported ? "Partner" : "None")} | Status: ${billingStatusLabel} | Currency: ${selectedConnection?.billingCurrency ?? metaConfig?.sharedBillingCurrency ?? "Not set"}`}
                </p>
              </div>
            ) : null}
          </>
        )}

        <div className="clone-hero-actions">
          <button type="button" className="primary-btn" disabled={currentBusy} onClick={() => void handleConnectOrReconnect()}>
            {isConnected ? "Reconnect API" : "Connect now"}
          </button>
          {isConnected ? (
            <>
              <button type="button" className="ghost-btn" disabled={currentBusy} onClick={() => void refreshMetaStatus()}>
                Refresh status
              </button>
              <button type="button" className="ghost-btn" disabled={currentBusy} onClick={handleDisconnect}>
                Disconnect
              </button>
            </>
          ) : null}
        </div>
        <p className="tiny-note">
          {isConnected
            ? "Use Add New to start onboarding another number. Toggle only pauses replies. Reconnect or Disconnect resets only the selected API connection."
            : "This channel is currently disconnected. Connect now to start the Meta onboarding flow again."}
        </p>
      </article>
    </section>
  );
}
