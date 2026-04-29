import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useNotificationStore } from "../store/notificationStore";
import { listAgentNotifications, markNotificationRead, markAllNotificationsRead } from "../api";
import { useAuth } from "../../../../lib/auth-context";

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const TYPE_ICON: Record<string, string> = {
  mention: "@",
  message: "💬",
  assigned: "👤",
  unassigned: "🔓",
  bot_alert: "⚡",
  system: "ℹ️"
};

export function NotificationsPanel() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { panelOpen, setPanelOpen, setNotifications, markRead, markAllRead, unreadCount } = useNotificationStore();

  const query = useQuery({
    queryKey: ["iv2-notifications"],
    queryFn: () => listAgentNotifications(token!, { limit: 50 }),
    enabled: Boolean(token && panelOpen),
    staleTime: 30_000
  });

  useEffect(() => {
    if (query.data) {
      setNotifications(query.data.notifications, query.data.unreadCount);
    }
  }, [query.data, setNotifications]);

  const readMut = useMutation({
    mutationFn: (id: string) => markNotificationRead(token!, id),
    onSuccess: (_data, id) => { markRead(id); void qc.invalidateQueries({ queryKey: ["iv2-notifications"] }); }
  });

  const readAllMut = useMutation({
    mutationFn: () => markAllNotificationsRead(token!),
    onSuccess: () => { markAllRead(); void qc.invalidateQueries({ queryKey: ["iv2-notifications"] }); }
  });

  const { notifications } = useNotificationStore();

  if (!panelOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="iv-notif-backdrop" onClick={() => setPanelOpen(false)} />
      <div className="iv-notif-panel">
        <div className="iv-notif-head">
          <span>Notifications</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {unreadCount > 0 && (
              <button className="iv-notif-readall" disabled={readAllMut.isPending} onClick={() => readAllMut.mutate()}>
                Mark all read
              </button>
            )}
            <button className="iv-notif-close" onClick={() => setPanelOpen(false)}>✕</button>
          </div>
        </div>

        <div className="iv-notif-list">
          {query.isLoading ? (
            <div className="iv-notif-empty">Loading…</div>
          ) : notifications.length === 0 ? (
            <div className="iv-notif-empty">No notifications yet</div>
          ) : notifications.map((n) => (
            <div
              key={n.id}
              className={`iv-notif-item${!n.read_at ? " unread" : ""}`}
              onClick={() => {
                if (!n.read_at) readMut.mutate(n.id);
                if (n.conversation_id) {
                  setPanelOpen(false);
                  navigate(`/dashboard/inbox-v2/${n.conversation_id}`);
                }
              }}
            >
              <div className="iv-notif-icon">{TYPE_ICON[n.type] ?? "🔔"}</div>
              <div className="iv-notif-body">
                {n.actor_name && <span className="iv-notif-actor">{n.actor_name}</span>}
                <span className="iv-notif-text">{n.body}</span>
                <span className="iv-notif-time">{timeAgo(n.created_at)}</span>
              </div>
              {!n.read_at && <div className="iv-notif-dot" />}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function NotificationBell() {
  const { token } = useAuth();
  const { unreadCount, setPanelOpen, panelOpen, setNotifications } = useNotificationStore();

  // Bootstrap unread count on mount
  const bootstrapQuery = useQuery({
    queryKey: ["iv2-notifications-unread"],
    queryFn: () => listAgentNotifications(token!, { unread: true, limit: 1 }),
    enabled: Boolean(token),
    staleTime: 60_000
  });

  useEffect(() => {
    if (bootstrapQuery.data) {
      setNotifications([], bootstrapQuery.data.unreadCount);
    }
  }, [bootstrapQuery.data, setNotifications]);

  return (
    <button
      className={`iv-bell-btn${unreadCount > 0 ? " has-unread" : ""}`}
      title="Notifications"
      onClick={() => setPanelOpen(!panelOpen)}
    >
      🔔
      {unreadCount > 0 && (
        <span className="iv-bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
      )}
    </button>
  );
}
