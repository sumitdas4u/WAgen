export type PersonalityOption =
  | "friendly_warm"
  | "professional"
  | "hard_closer"
  | "premium_consultant"
  | "custom";

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
  last_message: string | null;
  last_message_at: string | null;
  ai_paused: boolean;
  manual_takeover: boolean;
  last_ai_reply_at: string | null;
}