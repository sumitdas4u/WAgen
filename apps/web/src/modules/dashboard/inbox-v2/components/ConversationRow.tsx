import { formatDistanceToNowStrict } from "date-fns";
import type { Conversation, Label } from "../store/convStore";

const AVATAR_COLORS = ["blue", "green", "purple", "amber", "rose", "teal"] as const;

export function getAvatarColor(phone: string): string {
  const n = parseInt(phone.replace(/\D/g, "").slice(-1)) || 0;
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

function getInitials(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-2);
}

function relativeTime(ts: string | null): string {
  if (!ts) return "";
  try {
    return formatDistanceToNowStrict(new Date(ts), { addSuffix: false });
  } catch {
    return "";
  }
}

interface Props {
  conv: Conversation;
  labels: Label[];
  active: boolean;
  onClick: () => void;
}

export function ConversationRow({ conv, labels, active, onClick }: Props) {
  const avatarColor = getAvatarColor(conv.phone_number);
  const initials = getInitials(conv.phone_number);
  const convLabels = labels.filter((l) => (conv as unknown as Record<string, string[]>).label_ids?.includes(l.id));

  const channelClass = conv.channel_type === "api" ? "iv-ch-api" : conv.channel_type === "web" ? "iv-ch-web" : "iv-ch-qr";
  const channelLabel = conv.channel_type === "api" ? "A" : conv.channel_type === "web" ? "W" : "Q";

  const priorityDot = conv.priority === "urgent" || conv.priority === "high"
    ? <span className={conv.priority === "urgent" ? "iv-priority-urgent" : "iv-priority-high"}>!!</span>
    : null;

  return (
    <div className={`iv-crow${active ? " active" : ""}`} onClick={onClick}>
      <div className="iv-crow-avatar-wrap">
        <div className={`iv-avatar av-${avatarColor}`}>{initials}</div>
        <div className={`iv-channel-dot ${channelClass}`}>{channelLabel}</div>
      </div>

      <div className="iv-crow-body">
        <div className="iv-crow-source">⊙ {conv.channel_type === "api" ? "WhatsApp API" : conv.channel_type === "web" ? "Web Widget" : "WhatsApp QR"}</div>
        <div className="iv-crow-name">{conv.phone_number}</div>
        <div className="iv-crow-snippet">
          {conv.last_message ?? "No messages yet"}
        </div>
        {convLabels.length > 0 && (
          <div className="iv-crow-labels">
            {convLabels.slice(0, 2).map((l) => (
              <span key={l.id} className="iv-label-item">
                <span className="iv-label-dot" style={{ background: l.color }} />
                {l.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="iv-crow-right">
        <span className="iv-crow-time">{relativeTime(conv.last_message_at)}</span>
        {(conv.unread_count ?? 0) > 0 && (
          <span className="iv-unread-badge">{conv.unread_count > 9 ? "9+" : conv.unread_count}</span>
        )}
        {priorityDot}
        {conv.ai_paused && <span className="iv-ai-paused">⏸</span>}
      </div>
    </div>
  );
}
