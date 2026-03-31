import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import { activateQrChannel, deactivateQrChannel } from "../api";

function formatPhone(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) return value;
  return `+${digits}`;
}

export function QrChannelPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token, bootstrap, refetchBootstrap } = useDashboardShell();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qrStatus = bootstrap?.channelSummary?.whatsapp?.status ?? "not_connected";
  const qrConnected = qrStatus === "connected";
  const qrPhoneNumber = bootstrap?.channelSummary?.whatsapp?.phoneNumber ?? null;
  const qrHasQr = Boolean(bootstrap?.channelSummary?.whatsapp?.hasQr);

  const updateShellState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsRoot }),
      refetchBootstrap()
    ]);
  };

  const toggleMutation = useMutation({
    mutationFn: async () => {
      if (qrConnected) {
        await deactivateQrChannel(token);
        return "QR channel deactivated.";
      }
      await activateQrChannel(token);
      return "QR channel activated. Open QR setup to scan and complete connection.";
    },
    onSuccess: async (message) => {
      await updateShellState();
      setInfo(message);
    },
    onError: (err) => setError((err as Error).message)
  });

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
              <p>Connect WhatsApp quickly for starter usage. Best for testing and small-scale automation.</p>
            </div>
            <button
              type="button"
              className={qrConnected ? "go-live-switch on" : "go-live-switch"}
              disabled={toggleMutation.isPending}
              onClick={() => { setError(null); setInfo(null); toggleMutation.mutate(); }}
              title={qrConnected ? "Deactivate QR channel" : "Activate QR channel"}
            >
              <span />
            </button>
          </div>
        </header>

        <div className="clone-channel-meta">
          <div>
            <h3>Status</h3>
            <p>{qrStatus}</p>
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
            disabled={toggleMutation.isPending}
            onClick={() => { setError(null); setInfo(null); toggleMutation.mutate(); }}
          >
            Reconnect
          </button>
        </div>
        <p className="tiny-note">QR mode is ideal for testing and early-stage businesses. For long-term growth, use Official API mode.</p>
      </article>
    </section>
  );
}
