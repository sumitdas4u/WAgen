import { formatDistanceToNowStrict } from "date-fns";
import type { Conversation, Label } from "../store/convStore";

const AVATAR_COLORS = ["blue", "green", "purple", "amber", "rose", "teal"] as const;

function seedChar(s: string): number {
  return s ? s.charCodeAt(0) : 0;
}

export function getAvatarColor(phone: string): string {
  const n = parseInt((phone ?? "").replace(/\D/g, "").slice(-1)) || 0;
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

export function getNameAvatarColor(name: string | null | undefined, phone: string): string {
  if (name) {
    const n = (seedChar(name[0] ?? "") + seedChar(name[name.length - 1] ?? "")) % AVATAR_COLORS.length;
    return AVATAR_COLORS[n];
  }
  return getAvatarColor(phone);
}

export function getNameInitials(name: string | null | undefined, phone: string): string {
  if (name) {
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) return `${words[0][0] ?? ""}${words[words.length - 1][0] ?? ""}`.toUpperCase();
    return (words[0] ?? "").slice(0, 2).toUpperCase();
  }
  return (phone ?? "").replace(/\D/g, "").slice(-2);
}

function relativeTime(ts: string | null): string {
  if (!ts) return "";
  try {
    return formatDistanceToNowStrict(new Date(ts), { addSuffix: false });
  } catch {
    return "";
  }
}

function getScoreBand(score: number): "hot" | "warm" | "cold" {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

interface Props {
  conv: Conversation;
  labels: Label[];
  active: boolean;
  onClick: () => void;
  selected?: boolean;
  hasSelection?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
}

export function ConversationRow({ conv, labels, active, onClick, selected, hasSelection, onToggleSelect }: Props) {
  const avatarColor = getNameAvatarColor(conv.contact_name, conv.phone_number);
  const initials = getNameInitials(conv.contact_name, conv.phone_number);
  const displayName = conv.contact_name || conv.phone_number;
  const convLabels = labels.filter((l) => conv.label_ids?.includes(l.id));

  const channelClass = conv.channel_type === "api" ? "iv-ch-api" : conv.channel_type === "web" ? "iv-ch-web" : "iv-ch-qr";
  const channelLabel = conv.channel_type === "api" ? "A" : conv.channel_type === "web" ? "W" : "Q";

  const priorityDot = conv.priority === "urgent" || conv.priority === "high"
    ? <span className={conv.priority === "urgent" ? "iv-priority-urgent" : "iv-priority-high"}>!!</span>
    : null;

  return (
    <div className={`iv-crow${active ? " active" : ""}${selected ? " selected" : ""}`} onClick={onClick}>
      {(hasSelection || selected) && (
        <div
          className="iv-crow-check"
          onClick={onToggleSelect}
        >
          <div className={`iv-checkbox${selected ? " checked" : ""}`} />
        </div>
      )}
      <div className="iv-crow-avatar-wrap">
        <div className={`iv-avatar av-${avatarColor}`}>{initials}</div>
        <div className={`iv-channel-dot ${channelClass}`}>{channelLabel}</div>
      </div>

      <div className="iv-crow-body">
        <div className="iv-crow-source">⊙ {conv.channel_type === "api" ? "WhatsApp API" : conv.channel_type === "web" ? "Web Widget" : "WhatsApp QR"}</div>
        <div className="iv-crow-name">{displayName}</div>
        <div className="iv-crow-snippet">
          {typeof conv.last_message === "string" ? conv.last_message : "No messages yet"}
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
        {conv.score > 0 && (
          <span className={`iv-score-chip iv-score-${getScoreBand(conv.score)}`}>{conv.score}</span>
        )}
      </div>
    </div>
  );
}
