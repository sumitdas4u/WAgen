export type PersonalityOption =
  | "friendly_warm"
  | "professional"
  | "hard_closer"
  | "premium_consultant"
  | "custom";

export type AgentChannelType = "web" | "qr" | "api";
export type AgentObjectiveType = "lead" | "feedback" | "complaint" | "hybrid";
export type ConversationKind = "lead" | "feedback" | "complaint" | "other";

export interface User {
  id: string;
  name: string;
  email: string;
  business_type: string | null;
  subscription_plan: string;
  business_basics: Record<string, unknown>;
  personality: PersonalityOption;
  custom_personality_prompt: string | null;
  ai_active: boolean;
}

export interface Conversation {
  id: string;
  user_id: string;
  phone_number: string;
  stage: string;
  score: number;
  lead_kind: ConversationKind;
  classification_confidence: number;
  channel_type: AgentChannelType;
  channel_linked_number: string | null;
  assigned_agent_profile_id: string | null;
  last_classified_at: string | null;
  last_message: string | null;
  last_message_at: string | null;
  ai_paused: boolean;
  manual_takeover: boolean;
  last_ai_reply_at: string | null;
}
