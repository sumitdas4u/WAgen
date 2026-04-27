import { create } from "zustand";

export type ConvStatus = "open" | "pending" | "resolved" | "snoozed";
export type ConvPriority = "none" | "low" | "medium" | "high" | "urgent";
export type ConvFolder = "all" | "open" | "pending" | "resolved" | "snoozed";
export type MsgDeliveryStatus = "pending" | "sent" | "delivered" | "read" | "failed";
export type MsgContentType = "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contacts" | "interactive" | "template" | "activity";

export interface Conversation {
  id: string;
  user_id: string;
  phone_number: string;
  stage: string;
  score: number;
  lead_kind: string;
  channel_type: string;
  channel_linked_number: string | null;
  assigned_agent_profile_id: string | null;
  last_message: string | null;
  last_message_at: string | null;
  ai_paused: boolean;
  manual_takeover: boolean;
  last_ai_reply_at: string | null;
  unread_count: number;
  status: ConvStatus;
  priority: ConvPriority;
  snoozed_until: string | null;
  agent_last_seen_at: string | null;
  csat_rating: number | null;
  csat_sent_at: string | null;
  label_ids?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  sender_name: string | null;
  message_text: string;
  content_type: MsgContentType;
  is_private: boolean;
  in_reply_to_id: string | null;
  echo_id: string | null;
  delivery_status: MsgDeliveryStatus;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  payload_json: Record<string, unknown> | null;
  created_at: string;
}

export interface Label {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface ConvFilters {
  stage: string;      // "all" | "hot" | "warm" | "cold"
  channel: string;    // "all" | "qr" | "api" | "web"
  aiMode: string;     // "all" | "ai" | "human"
  assignment: string; // "all" | "assigned" | "unassigned"
  labelId: string;    // "all" | label.id
}

interface ConvStore {
  // Normalized conversation list
  byId: Record<string, Conversation>;
  ids: string[];
  folder: ConvFolder;
  filters: ConvFilters;
  activeConvId: string | null;

  // Messages per conversation
  messagesByConvId: Record<string, ConversationMessage[]>;

  // Typing state per conversation
  typingState: Record<string, boolean>;

  // Labels
  labels: Label[];

  // Actions
  setFolder: (folder: ConvFolder) => void;
  setFilters: (filters: Partial<ConvFilters>) => void;
  setActiveConv: (id: string | null) => void;
  setConversations: (convs: Conversation[]) => void;
  upsertConv: (c: Partial<Conversation> & { id: string }) => void;
  prependConv: (c: Conversation) => void;
  removeConv: (id: string) => void;

  setMessages: (convId: string, messages: ConversationMessage[]) => void;
  prependMessages: (convId: string, messages: ConversationMessage[]) => void;
  appendMessage: (convId: string, message: ConversationMessage) => void;
  replaceOptimisticMessage: (convId: string, tempId: string, message: ConversationMessage) => void;
  patchMessageDelivery: (convId: string, msgId: string, status: MsgDeliveryStatus, errorCode?: string, errorMsg?: string) => void;

  setTyping: (convId: string, on: boolean) => void;
  clearUnread: (convId: string) => void;
  setLabels: (labels: Label[]) => void;
}

const DEFAULT_FILTERS: ConvFilters = {
  stage: "all",
  channel: "all",
  aiMode: "all",
  assignment: "all",
  labelId: "all"
};

export const useConvStore = create<ConvStore>((set) => ({
  byId: {},
  ids: [],
  folder: "all",
  filters: DEFAULT_FILTERS,
  activeConvId: null,
  messagesByConvId: {},
  typingState: {},
  labels: [],

  setFolder: (folder) => set({ folder }),
  setFilters: (filters) => set((s) => ({ filters: { ...s.filters, ...filters } })),
  setActiveConv: (id) => set({ activeConvId: id }),

  setConversations: (convs) => set({
    byId: Object.fromEntries(convs.map((c) => [c.id, c])),
    ids: convs.map((c) => c.id)
  }),

  upsertConv: (c) => set((s) => {
    const existing = s.byId[c.id];
    const updated = existing ? { ...existing, ...c } : (c as Conversation);
    const ids = s.ids.includes(c.id) ? s.ids : [c.id, ...s.ids];
    return { byId: { ...s.byId, [c.id]: updated }, ids };
  }),

  prependConv: (c) => set((s) => ({
    byId: { ...s.byId, [c.id]: c },
    ids: s.ids.includes(c.id) ? s.ids : [c.id, ...s.ids]
  })),

  removeConv: (id) => set((s) => {
    const { [id]: _, ...rest } = s.byId;
    return { byId: rest, ids: s.ids.filter((i) => i !== id) };
  }),

  setMessages: (convId, messages) => set((s) => ({
    messagesByConvId: { ...s.messagesByConvId, [convId]: messages }
  })),

  prependMessages: (convId, messages) => set((s) => {
    const existing = s.messagesByConvId[convId] ?? [];
    const existingIds = new Set(existing.map((m) => m.id));
    const newMsgs = messages.filter((m) => !existingIds.has(m.id));
    return { messagesByConvId: { ...s.messagesByConvId, [convId]: [...newMsgs, ...existing] } };
  }),

  appendMessage: (convId, message) => set((s) => {
    const existing = s.messagesByConvId[convId] ?? [];
    if (existing.some((m) => m.id === message.id)) return s;
    return { messagesByConvId: { ...s.messagesByConvId, [convId]: [...existing, message] } };
  }),

  replaceOptimisticMessage: (convId, tempId, message) => set((s) => {
    const existing = s.messagesByConvId[convId] ?? [];
    const replaced = existing.map((m) => m.id === tempId ? message : m);
    return { messagesByConvId: { ...s.messagesByConvId, [convId]: replaced } };
  }),

  patchMessageDelivery: (convId, msgId, status, errorCode, errorMsg) => set((s) => {
    const existing = s.messagesByConvId[convId] ?? [];
    const patched = existing.map((m) =>
      m.id === msgId ? { ...m, delivery_status: status, error_code: errorCode ?? m.error_code, error_message: errorMsg ?? m.error_message } : m
    );
    return { messagesByConvId: { ...s.messagesByConvId, [convId]: patched } };
  }),

  setTyping: (convId, on) => set((s) => ({
    typingState: { ...s.typingState, [convId]: on }
  })),

  clearUnread: (convId) => set((s) => {
    const conv = s.byId[convId];
    if (!conv) return s;
    return { byId: { ...s.byId, [convId]: { ...conv, unread_count: 0 } } };
  }),

  setLabels: (labels) => set({ labels })
}));
