export interface WSEnvelope<E extends string, D> {
  v: 1;
  event: E;
  data: D;
}

export type WSEvent =
  | WSEnvelope<"message.created", { conversationId: string; message: { id: string; conversation_id: string; direction: string; sender_name: string | null; message_text: string; content_type: string; is_private: boolean; in_reply_to_id: string | null; echo_id: string | null; delivery_status: string; error_code: string | null; error_message: string | null; retry_count: number; payload_json?: Record<string, unknown> | null; media_url?: string | null; message_type?: string | null; message_content?: Record<string, unknown> | null; source_type?: string | null; ai_model: string | null; total_tokens: number | null; created_at: string } }>
  | WSEnvelope<"message.updated", { messageId: string; conversationId: string; deliveryStatus: "sent" | "delivered" | "read" | "failed"; errorCode?: string; errorMessage?: string }>
  | WSEnvelope<"conversation.created", { id: string; last_message?: { text: string; sent_at: string; direction: string }; unread_count?: number; score?: number; status?: string; priority?: string }>
  | WSEnvelope<"conversation.updated", { id: string; last_message?: { text: string; sent_at: string; direction: string }; unread_count?: number; score?: number; status?: string; priority?: string }>
  | WSEnvelope<"conversation.status_changed", { id: string; status: "open" | "pending" | "resolved" | "snoozed"; snoozed_until?: string }>
  | WSEnvelope<"conversation.priority_changed", { id: string; priority: string }>
  | WSEnvelope<"conversation.read", { conversation_id: string }>
  | WSEnvelope<"conversation.typing_on", { conversation_id: string; user_id: string; is_agent: boolean }>
  | WSEnvelope<"conversation.typing_off", { conversation_id: string; user_id: string; is_agent: boolean }>
  | WSEnvelope<"conversation.label_changed", { id: string; label_ids: string[] }>
  | WSEnvelope<"conversation.assigned", { id: string; agent_id: string | null }>
  | WSEnvelope<"conversations.bulk_updated", { ids: string[]; action: string; payload?: Record<string, unknown> }>
  | WSEnvelope<"contact.updated", { conversation_id: string; name: string; phone: string }>
  | WSEnvelope<"conversation.mentioned", { conversationId: string; noteId: string; actorName: string; body: string }>
  | WSEnvelope<"agent.notification", { id: string; type: "mention" | "message" | "assigned" | "unassigned" | "bot_alert" | "system"; conversation_id?: string; actor_name?: string; body: string; created_at: string }>;
