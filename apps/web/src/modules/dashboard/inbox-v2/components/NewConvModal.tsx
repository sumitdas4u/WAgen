import { useState } from "react";
import { useAuth } from "../../../../lib/auth-context";
import { createOutboundConversation } from "../api";

interface Props {
  onClose: () => void;
  onCreated: (convId: string) => void;
}

export function NewConvModal({ onClose, onCreated }: Props) {
  const { token } = useAuth();
  const [phone, setPhone] = useState("");
  const [channelType, setChannelType] = useState<"api" | "qr">("api");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    const trimPhone = phone.trim();
    if (!trimPhone) { setError("Phone number is required"); return; }
    setLoading(true); setError("");
    try {
      const result = await createOutboundConversation(token!, { phone: trimPhone, channelType, initialMessage: message.trim() || undefined });
      onCreated(result.conversationId);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };

  return (
    <div className="iv-modal-overlay" onClick={onClose}>
      <div className="iv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="iv-tvd-head">
          <strong>New Conversation</strong>
          <button className="iv-tvd-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div className="iv-tvd-label">Phone Number</div>
            <input
              className="iv-tvd-input"
              style={{ width: "100%", boxSizing: "border-box" }}
              placeholder="+1234567890"
              value={phone}
              autoFocus
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
            />
          </div>
          <div>
            <div className="iv-tvd-label">Channel</div>
            <select
              style={{ width: "100%", height: 36, border: "1.5px solid #e2eaf4", borderRadius: 8, padding: "0 10px", fontSize: 13, fontFamily: "Manrope, sans-serif", outline: "none", background: "#fff" }}
              value={channelType}
              onChange={(e) => setChannelType(e.target.value as "api" | "qr")}
            >
              <option value="api">WhatsApp API</option>
              <option value="qr">WhatsApp QR</option>
            </select>
          </div>
          <div>
            <div className="iv-tvd-label">Initial Message (optional)</div>
            <textarea
              style={{ width: "100%", boxSizing: "border-box", height: 72, resize: "vertical", border: "1.5px solid #e2eaf4", borderRadius: 8, padding: "8px 10px", fontSize: 13, fontFamily: "Manrope, sans-serif", outline: "none", background: "#fff" }}
              placeholder="Hi, I wanted to reach out…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          {error && <div style={{ fontSize: 12, color: "#ef4444" }}>{error}</div>}
        </div>
        <div className="iv-tvd-footer">
          <button className="iv-tvd-cancel" onClick={onClose}>Cancel</button>
          <button className="iv-tvd-send" disabled={loading} onClick={() => void handleCreate()}>
            {loading ? "Creating…" : "Start Conversation"}
          </button>
        </div>
      </div>
    </div>
  );
}
