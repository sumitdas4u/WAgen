import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import { activateQrChannel, deactivateQrChannel, setQrChannelEnabled } from "../api";

function formatPhone(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) return value;
  return `+${digits}`;
}

function formatQrConnectionStatus(status: string, hasQr: boolean): string {
  if (status === "connected") return "Connected";
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

  const qrStatus = bootstrap?.channelSummary?.whatsapp?.status ?? "not_connected";
  const qrChannelEnabled = bootstrap?.channelSummary?.whatsapp?.enabled ?? true;
  const qrConnected = qrStatus === "connected";
  const qrPhoneNumber = bootstrap?.channelSummary?.whatsapp?.phoneNumber ?? null;
  const qrHasQr = Boolean(bootstrap?.channelSummary?.whatsapp?.hasQr);
  const qrConnectionLabel = formatQrConnectionStatus(qrStatus, qrHasQr);
  const canDisconnect = qrConnected || qrStatus === "connecting" || qrHasQr || Boolean(qrPhoneNumber);

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
        ? "QR channel paused. The WhatsApp connection stays alive, but automated replies are temporarily off."
        : "QR channel resumed. The WhatsApp connection is still alive and automated replies are back on.";
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

  const controlsBusy = toggleMutation.isPending || reconnectMutation.isPending || disconnectMutation.isPending;

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
          <div>
            <h3>Session</h3>
            <p>{qrHasQr ? "QR generated" : "Not generated"}</p>
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
