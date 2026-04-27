import { format } from "date-fns";
import type { ConversationMessage } from "../store/convStore";
import { getAvatarColor } from "./ConversationRow";

interface Props {
  message: ConversationMessage;
  isFirst: boolean;
  showAvatar: boolean;
  convPhone: string;
  onRetry?: (msgId: string) => void;
  quotedMessage?: ConversationMessage | null;
}

function renderDelivery(status: string, retryCount: number, onRetry?: () => void) {
  if (status === "pending") return <span className="iv-delivery pending">⏳</span>;
  if (status === "sent") return <span className="iv-delivery sent">✓</span>;
  if (status === "delivered") return <span className="iv-delivery delivered">✓✓</span>;
  if (status === "read") return <span className="iv-delivery read">✓✓</span>;
  if (status === "failed") {
    const disabled = retryCount >= 3;
    return (
      <>
        <span className="iv-delivery failed">✗</span>
        <span
          className={`iv-retry-link${disabled ? " disabled" : ""}`}
          onClick={disabled ? undefined : onRetry}
          title={disabled ? "Contact support" : "Retry"}
        >
          · {disabled ? "Contact support" : "Retry"}
        </span>
      </>
    );
  }
  return null;
}

function formatTime(ts: string) {
  try { return format(new Date(ts), "HH:mm"); } catch { return ""; }
}

function renderContent(msg: ConversationMessage) {
  const type = msg.content_type ?? "text";
  const payload = msg.payload_json as Record<string, unknown> | null;

  switch (type) {
    case "image": {
      const url = (payload?.url as string) ?? msg.message_text;
      return (
        <div>
          <img src={url} alt="Image" style={{ maxWidth: 220, borderRadius: 8, cursor: "pointer" }} onClick={() => window.open(url, "_blank")} />
          {payload?.caption != null && <p style={{ marginTop: 4, fontSize: 13, color: "inherit" }}>{String(payload.caption)}</p>}
        </div>
      );
    }
    case "audio":
      return <audio controls src={(payload?.url as string) ?? msg.message_text} style={{ maxWidth: 220 }} />;
    case "video":
      return <video controls src={(payload?.url as string) ?? msg.message_text} style={{ maxWidth: 260, borderRadius: 8 }} />;
    case "document": {
      const url = (payload?.url as string) ?? msg.message_text;
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, color: "inherit" }}>
          <span>📄</span>
          <span style={{ fontSize: 13 }}>{(payload?.filename as string) ?? "Document"}</span>
        </a>
      );
    }
    case "location": {
      const lat = payload?.latitude as number;
      const lng = payload?.longitude as number;
      const label = (payload?.name as string) ?? msg.message_text;
      return (
        <a href={`https://maps.google.com/?q=${lat},${lng}`} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
          📍 {label}
        </a>
      );
    }
    case "activity":
      return null; // handled separately as pill
    default:
      return <span style={{ whiteSpace: "pre-wrap" }}>{msg.message_text}</span>;
  }
}

export function MessageBubble({ message, isFirst, showAvatar, convPhone, onRetry, quotedMessage }: Props) {
  const isOutbound = message.direction === "outbound";
  const isPrivate = message.is_private;
  const isActivity = message.content_type === "activity";
  const avatarColor = getAvatarColor(convPhone);

  if (isActivity) {
    return (
      <div className="iv-activity-pill">
        <span>{message.message_text}</span>
      </div>
    );
  }

  const bubbleClass = isPrivate ? "private" : isOutbound ? "outbound" : "inbound";
  const groupClass = isFirst ? " iv-bubble-group-first" : "";

  return (
    <div className={`iv-msg-row${isOutbound ? " outbound" : ""}`}>
      {!isOutbound && (
        showAvatar
          ? <div className={`iv-msg-avatar-sm iv-avatar av-${avatarColor}`} style={{ fontSize: 8 }}>
              {convPhone.replace(/\D/g, "").slice(-2)}
            </div>
          : <div className="iv-msg-avatar-space" />
      )}

      <div className={`iv-bubble ${bubbleClass}${groupClass}`}>
        {isPrivate && (
          <div className="iv-bubble-private-label">🔒 Private Note</div>
        )}
        {quotedMessage && (
          <div className="iv-reply-quote">
            {quotedMessage.message_text.slice(0, 100)}
          </div>
        )}
        {renderContent(message)}
        <div className="iv-bubble-footer">
          {isFirst && <span className="iv-bubble-time">{formatTime(message.created_at)}</span>}
          {isOutbound && renderDelivery(message.delivery_status, message.retry_count, () => onRetry?.(message.id))}
        </div>
      </div>
    </div>
  );
}
