import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useNotificationStore } from "../store/notificationStore";
import { listAgentNotifications, markNotificationRead, markAllNotificationsRead } from "../api";
import { useAuth } from "../../../../lib/auth-context";
import type { AgentNotification } from "../api";

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

interface NotificationGroup {
  key: string;
  conversationId: string | null;
  actorName: string | null;
  latest: AgentNotification;
  items: AgentNotification[];
  unreadItems: AgentNotification[];
}

function groupNotifications(items: AgentNotification[]): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();

  for (const item of items) {
    const key = item.conversation_id ? `conv:${item.conversation_id}` : `notif:${item.id}`;
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(item);
      if (!item.read_at) existing.unreadItems.push(item);
      if (Date.parse(item.created_at) > Date.parse(existing.latest.created_at)) {
        existing.latest = item;
      }
      if (!existing.actorName && item.actor_name) existing.actorName = item.actor_name;
      continue;
    }

    groups.set(key, {
      key,
      conversationId: item.conversation_id,
      actorName: item.actor_name,
      latest: item,
      items: [item],
      unreadItems: item.read_at ? [] : [item]
    });
  }

  return Array.from(groups.values()).sort((a, b) => Date.parse(b.latest.created_at) - Date.parse(a.latest.created_at));
}

function groupTitle(group: NotificationGroup): string {
  const name = group.actorName ?? "Conversation";
  const unreadCount = group.unreadItems.length;

  if (unreadCount > 0) return `${unreadCount} unread from ${name}`;
  if (group.items.length > 1) return `${group.items.length} updates from ${name}`;
  return name;
}

export function NotificationsPanel() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { panelOpen, setPanelOpen, setNotifications, markManyRead, markAllRead, unreadCount } = useNotificationStore();

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

  const readGroupMut = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => markNotificationRead(token!, id))),
    onSuccess: (_data, ids) => { markManyRead(ids); void qc.invalidateQueries({ queryKey: ["iv2-notifications"] }); }
  });

  const readAllMut = useMutation({
    mutationFn: () => markAllNotificationsRead(token!),
    onSuccess: () => { markAllRead(); void qc.invalidateQueries({ queryKey: ["iv2-notifications"] }); }
  });

  const { notifications } = useNotificationStore();
  const groupedNotifications = groupNotifications(notifications);

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
          ) : groupedNotifications.length === 0 ? (
            <div className="iv-notif-empty">No notifications yet</div>
          ) : groupedNotifications.map((group) => {
            const n = group.latest;
            return (
            <div
              key={group.key}
              className={`iv-notif-item${group.unreadItems.length > 0 ? " unread" : ""}`}
              onClick={() => {
                const unreadIds = group.unreadItems.map((n) => n.id);
                if (unreadIds.length > 0) readGroupMut.mutate(unreadIds);
                if (group.conversationId) {
                  setPanelOpen(false);
                  navigate(`/dashboard/inbox-v2/${group.conversationId}`);
                }
              }}
            >
              <div className="iv-notif-icon">{TYPE_ICON[n.type] ?? "🔔"}</div>
              <div className="iv-notif-body">
                <div className="iv-notif-row-top">
                  <span className="iv-notif-actor">{groupTitle(group)}</span>
                  {group.unreadItems.length > 1 && <span className="iv-notif-count">{group.unreadItems.length}</span>}
                </div>
                <span className="iv-notif-text">{group.latest.body}</span>
                {group.items.length > 1 && (
                  <div className="iv-notif-snippets">
                    {group.items
                      .filter((n) => n.id !== group.latest.id)
                      .slice(0, 2)
                      .map((n) => (
                        <span key={n.id} className="iv-notif-snippet">{TYPE_ICON[n.type] ?? "-"} {n.body}</span>
                      ))}
                  </div>
                )}
                <span className="iv-notif-time">{timeAgo(group.latest.created_at)}</span>
              </div>
              {group.unreadItems.length > 0 && <div className="iv-notif-dot" />}
            </div>
            );
          })}
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
