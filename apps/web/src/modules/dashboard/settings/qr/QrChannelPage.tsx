import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchPublishedFlows,
  type ChannelDefaultReplyConfig,
  type PublishedFlowSummary
} from "../../../../lib/api";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import {
  activateQrChannel,
  deactivateQrChannel,
  fetchSettingsChannelDefaultReply,
  saveSettingsChannelDefaultReply,
  setQrChannelEnabled
} from "../api";

function formatPhone(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) return value;
  return `+${digits}`;
}

function formatQrConnectionStatus(status: string, hasQr: boolean): string {
  if (status === "connected") return "Connected";
  if (status === "degraded") return "Needs re-link";
  if (status === "connecting" && hasQr) return "Waiting for scan";
  if (status === "connecting") return "Connecting";
  return "Disconnected";
}

export function QrChannelPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token, bootstrap, refetchBootstrap } = useDashboardShell();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defaultReplyConfig, setDefaultReplyConfig] = useState<ChannelDefaultReplyConfig | null>(null);
  const [defaultReplyFlows, setDefaultReplyFlows] = useState<PublishedFlowSummary[]>([]);
  const [defaultReplySaving, setDefaultReplySaving] = useState(false);

  const qrStatus = bootstrap?.channelSummary?.whatsapp?.status ?? "not_connected";
  const qrChannelEnabled = bootstrap?.channelSummary?.whatsapp?.enabled ?? true;
  const qrConnected = qrStatus === "connected";
  const qrPhoneNumber = bootstrap?.channelSummary?.whatsapp?.phoneNumber ?? null;
  const qrHasQr = Boolean(bootstrap?.channelSummary?.whatsapp?.hasQr);
  const qrNeedsRelink = Boolean(bootstrap?.channelSummary?.whatsapp?.needsRelink);
  const qrStatusMessage = bootstrap?.channelSummary?.whatsapp?.statusMessage ?? null;
  const qrConnectionLabel = formatQrConnectionStatus(qrStatus, qrHasQr);
  const canDisconnect = qrConnected || qrStatus === "connecting" || qrHasQr || Boolean(qrPhoneNumber);
  const defaultReplyMode = defaultReplyConfig?.mode ?? "manual";
  const defaultReplyFlowId = defaultReplyConfig?.flowId ?? "";

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchSettingsChannelDefaultReply(token, "qr"),
      fetchPublishedFlows(token)
    ])
      .then(([configResponse, flowsResponse]) => {
        if (cancelled) {
          return;
        }
        setDefaultReplyConfig(configResponse.config);
        setDefaultReplyFlows(flowsResponse.filter((flow) => flow.channel === "qr"));
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("[QrChannelPage] Failed to load default reply settings", err);
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

  const toggleMutation = useMutation({
    mutationFn: async () => {
      await setQrChannelEnabled(token, !qrChannelEnabled);
      return qrChannelEnabled
        ? "QR channel paused. Any active QR session stays alive, but automated replies are temporarily off."
        : "QR channel resumed. Any active QR session stays alive and automated replies are back on.";
    },
    onSuccess: async (message) => {
      await updateShellState();
      setInfo(message);
    },
    onError: (err) => setError((err as Error).message)
  });

  const reconnectMutation = useMutation({
    mutationFn: async () => {
      await activateQrChannel(token, { resetAuth: true });
      return "Current QR connection disconnected. A fresh QR session is starting now. Open QR setup to scan again.";
    },
    onSuccess: async (message) => {
      await updateShellState();
      setInfo(message);
    },
    onError: (err) => setError((err as Error).message)
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      await deactivateQrChannel(token);
      return "QR channel disconnected.";
    },
    onSuccess: async (message) => {
      await updateShellState();
      setInfo(message);
    },
    onError: (err) => setError((err as Error).message)
  });

  const handleReconnect = () => {
    if (!window.confirm("Reconnect QR channel? This will disconnect the current QR session and generate a fresh QR code.")) {
      return;
    }
    setError(null);
    setInfo(null);
    reconnectMutation.mutate();
  };

  const handleDisconnect = () => {
    if (!window.confirm("Disconnect QR channel? This will remove the current QR session until you connect again.")) {
      return;
    }
    setError(null);
    setInfo(null);
    disconnectMutation.mutate();
  };

  const handleSaveDefaultReply = async () => {
    if (!defaultReplyConfig) {
      return;
    }
    if (defaultReplyConfig.mode === "flow" && !defaultReplyConfig.flowId) {
      setError("Select a published QR flow before saving default reply settings.");
      setInfo(null);
      return;
    }

    setDefaultReplySaving(true);
    setError(null);
    setInfo(null);
    try {
      const response = await saveSettingsChannelDefaultReply(token, "qr", {
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

  const controlsBusy = toggleMutation.isPending || reconnectMutation.isPending || disconnectMutation.isPending;

  return (
    <section className="finance-shell">
      {(info || error) && (
        <article className="finance-panel">
          {info ? <p className="info-text">{info}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </article>
      )}

      {qrNeedsRelink && qrStatusMessage ? (
        <article className="finance-panel">
          <p className="error-text">{qrStatusMessage}</p>
          <p className="tiny-note">Keep the main phone online, remove the stale linked device in WhatsApp, then reconnect and scan a fresh QR.</p>
        </article>
      ) : null}

      <article className="channel-setup-panel">
        <header>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h3>WhatsApp QR Channel</h3>
              <p>Connect WhatsApp quickly for starter usage. Use the toggle to pause or resume replies without breaking the QR session.</p>
            </div>
            <button
              type="button"
              className={qrChannelEnabled ? "go-live-switch on" : "go-live-switch"}
              disabled={controlsBusy}
              onClick={() => { setError(null); setInfo(null); toggleMutation.mutate(); }}
              title={qrChannelEnabled ? "Pause QR channel replies" : "Resume QR channel replies"}
            >
              <span />
            </button>
          </div>
        </header>

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
              Choose what should happen when no QR flow matches, or when a flow gets invalid replies twice.
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
                  <option value="">Select published QR flow</option>
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

        <div className="clone-channel-meta">
          <div>
            <h3>Channel</h3>
            <p>{qrChannelEnabled ? "Active" : "Inactive"}</p>
          </div>
          <div>
            <h3>Connection</h3>
            <p>{qrConnectionLabel}</p>
          </div>
          <div>
            <h3>Linked Number</h3>
            <p>{qrPhoneNumber ? formatPhone(qrPhoneNumber) : "Not linked"}</p>
          </div>
        </div>

        <div className="clone-hero-actions">
          <button type="button" className="primary-btn" onClick={() => navigate("/onboarding/qr")}>
            Setup QR
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={controlsBusy}
            onClick={handleReconnect}
          >
            Reconnect
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={controlsBusy || !canDisconnect}
            onClick={handleDisconnect}
          >
            Disconnect
          </button>
        </div>
        <p className="tiny-note">QR mode is ideal for testing and early-stage businesses. Toggle only pauses replies. Reconnect or Disconnect will reset the actual QR connection.</p>
      </article>
    </section>
  );
}
