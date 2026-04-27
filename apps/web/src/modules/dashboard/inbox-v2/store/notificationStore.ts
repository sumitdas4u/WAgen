import { create } from "zustand";
import type { AgentNotification } from "../api";

interface NotificationStore {
  notifications: AgentNotification[];
  unreadCount: number;
  panelOpen: boolean;

  setNotifications: (items: AgentNotification[], count: number) => void;
  prependNotification: (n: AgentNotification) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  setPanelOpen: (open: boolean) => void;
  incrementUnread: () => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  unreadCount: 0,
  panelOpen: false,

  setNotifications: (items, count) => set({ notifications: items, unreadCount: count }),

  prependNotification: (n) => set((s) => ({
    notifications: [n, ...s.notifications].slice(0, 100),
    unreadCount: s.unreadCount + 1
  })),

  markRead: (id) => set((s) => ({
    notifications: s.notifications.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n),
    unreadCount: Math.max(0, s.unreadCount - (s.notifications.find((n) => n.id === id && !n.read_at) ? 1 : 0))
  })),

  markAllRead: () => set((s) => ({
    notifications: s.notifications.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
    unreadCount: 0
  })),

  setPanelOpen: (open) => set({ panelOpen: open }),
  incrementUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 }))
}));
