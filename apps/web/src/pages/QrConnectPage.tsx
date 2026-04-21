import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { useNavigate } from "react-router-dom";
import { connectWhatsApp, fetchWhatsAppStatus } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useRealtime } from "../lib/use-realtime";

type ConnectionStatus = "not_connected" | "connecting" | "waiting_scan" | "connected" | "degraded";

export function QrConnectPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ConnectionStatus>("not_connected");
  const [qrText, setQrText] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) {
      return;
    }
    const response = await fetchWhatsAppStatus(token);
    if (response.status === "connected") {
      setStatus("connected");
      setQrText(null);
      setStatusMessage(null);
      return;
    }
    if (response.status === "degraded") {
      setStatus("degraded");
      setQrText(null);
      setStatusMessage(response.statusMessage ?? "QR session needs re-link. Scan a fresh QR code.");
      return;
    }
    if (response.status === "connecting") {
      setStatus(response.qr ? "waiting_scan" : "connecting");
      setQrText(response.qr);
      setStatusMessage(null);
      return;
    }
    setStatus("not_connected");
    setQrText(null);
    setStatusMessage(null);
  }, [token]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useRealtime(
    token,
    useCallback((event) => {
      if (event.event === "whatsapp.qr") {
        const payload = event.data as { qr?: string };
        if (payload.qr) {
          setStatus("waiting_scan");
          setQrText(payload.qr);
          setStatusMessage(null);
        }
      }

      if (event.event === "whatsapp.status") {
        const payload = event.data as { status?: string; statusMessage?: string | null };
        if (payload.status === "connected") {
          setStatus("connected");
          setQrText(null);
          setStatusMessage(null);
        } else if (payload.status === "degraded") {
          setStatus("degraded");
          setQrText(null);
          setStatusMessage(payload.statusMessage ?? "QR session needs re-link. Scan a fresh QR code.");
        } else if (payload.status === "connecting") {
          setStatus("connecting");
          setStatusMessage(null);
        } else if (payload.status === "disconnected") {
          setStatus("not_connected");
          setQrText(null);
          setStatusMessage(null);
        }
      }
    }, [])
  );

  useEffect(() => {
    if (!qrText) {
      setQrImage(null);
      return;
    }
    void QRCode.toDataURL(qrText, {
      margin: 1,
      color: {
        dark: "#0d1a30",
        light: "#f6fbff"
      }
    }).then(setQrImage);
  }, [qrText]);

  const statusLabel = useMemo(() => {
    if (status === "connected") {
      return "Connected";
    }
    if (status === "waiting_scan") {
      return "Waiting for scan";
    }
    if (status === "connecting") {
      return "Generating QR...";
    }
    if (status === "degraded") {
      return "Needs re-link";
    }
    return "Not connected";
  }, [status]);

  const handleGenerateQr = async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await connectWhatsApp(token, { resetAuth: status === "degraded" });
      setQrText(null);
      setQrImage(null);
      setStatusMessage(null);
      setStatus("connecting");
    } catch (connectError) {
      setError((connectError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="qr-module-shell">
      <section className="qr-module-card">
        <header>
          <p>Separate Module</p>
          <h1>QR Scan Setup</h1>
          <small>Use this module when you are ready to connect WhatsApp Web by QR.</small>
        </header>

        <div className={`qr-module-frame status-${status}`}>
          {qrImage ? <img src={qrImage} alt="WhatsApp QR code" /> : <div className="qr-module-placeholder">QR will appear here</div>}
        </div>

        <p className={`status-pill status-${status}`}>{statusLabel}</p>
        {statusMessage ? <p className="error-text">{statusMessage}</p> : null}

        <div className="journey-actions center">
          <button type="button" className="primary-btn" disabled={loading} onClick={() => void handleGenerateQr()}>
            {loading ? "Generating..." : status === "degraded" ? "Generate Fresh QR" : "Generate QR"}
          </button>
          <button type="button" className="ghost-btn" onClick={() => void refresh()}>
            Refresh status
          </button>
          <button type="button" className="link-btn" onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}
