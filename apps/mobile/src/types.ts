export type ConvStatus = "open" | "pending" | "resolved" | "snoozed";
export type ConvPriority = "none" | "low" | "medium" | "high" | "urgent";
export type ConvFolder = "all" | "open" | "pending" | "resolved" | "snoozed";
export type MsgDeliveryStatus = "pending" | "sent" | "delivered" | "read" | "failed";
export type MsgContentType = "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contacts" | "interactive" | "template" | "activity";

export interface User {
  id: string;
  name: string;
  email: string;
  business_type: string | null;
  subscription_plan: string;
  ai_active: boolean;
  phone_number: string | null;
  phone_verified: boolean;
  ai_token_balance: number;
}

export interface Conversation {
  id: string;
  user_id: string;
  phone_number: string;
  contact_name: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  assigned_agent_name?: string | null;
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
  media_url?: string | null;
  message_type?: string | null;
  message_content?: Record<string, unknown> | null;
  source_type?: string | null;
  ai_model?: string | null;
  total_tokens?: number | null;
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
  stage: string;
  channel: string;
  aiMode: string;
  assignment: string;
  labelId: string;
  leadKind: string;
  priority: string;
  tags: string[];
}

export interface AgentNotification {
  id: string;
  type: "mention" | "message" | "assigned" | "unassigned" | "bot_alert" | "system";
  conversation_id: string | null;
  actor_name: string | null;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface ContactRecord {
  id: string;
  display_name: string | null;
  phone_number: string;
  email: string | null;
  contact_type: string;
  tags: string[];
  source_type: string;
  custom_field_values: Array<{ field_id: string; field_name: string; field_label: string; field_type: string; value: string | null }>;
  linked_conversation_id: string | null;
  created_at: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  avatar_url: string | null;
  handle: string | null;
}

export interface CannedResponse {
  id: string;
  name: string;
  short_code: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ConvNote {
  id: string;
  content: string;
  created_at: string;
  sender_name: string | null;
}

export interface PublishedFlowSummary {
  id: string;
  name: string;
  channel: "web" | "qr" | "api";
}

export interface MessageTemplate {
  id: string;
  name: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  status: string;
  linkedNumber: string | null;
}

export interface InboxContact {
  id: string;
  display_name: string | null;
  phone_number: string;
  email: string | null;
  contact_type: "lead" | "feedback" | "complaint" | "other";
  source_type: "manual" | "import" | "web" | "qr" | "api";
  last_incoming_message_at: string | null;
  linked_conversation_id: string | null;
}
