export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

interface RequestOptions extends RequestInit {
  token?: string | null;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, headers, ...rest } = options;
  const hasJsonBody = rest.body !== undefined && rest.body !== null && !(rest.body instanceof FormData);

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...headers
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export interface User {
  id: string;
  name: string;
  email: string;
  business_type: string | null;
  subscription_plan: string;
  business_basics: Record<string, unknown>;
  personality: "friendly_warm" | "professional" | "hard_closer" | "premium_consultant" | "custom";
  custom_personality_prompt: string | null;
  ai_active: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export function signup(payload: {
  name: string;
  email: string;
  password: string;
  businessType: string;
}) {
  return apiRequest<AuthResponse>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function login(payload: { email: string; password: string }) {
  return apiRequest<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function fetchMe(token: string) {
  return apiRequest<{ user: User }>("/api/auth/me", { token });
}

export function connectWhatsApp(token: string) {
  return apiRequest<{ ok: boolean }>("/api/whatsapp/connect", {
    method: "POST",
    token,
    body: JSON.stringify({})
  });
}

export function fetchWhatsAppStatus(token: string) {
  return apiRequest<{ status: string; phoneNumber: string | null; hasQr: boolean; qr: string | null }>(
    "/api/whatsapp/status",
    { token }
  );
}

export interface BusinessBasicsPayload {
  whatDoYouSell: string;
  priceRange: string;
  targetAudience: string;
  usp: string;
  objections: string;
  defaultCountry: string;
  defaultCurrency: string;
  greetingScript: string;
  pricingInquiryScript: string;
  availabilityScript: string;
  objectionHandlingScript: string;
  bookingScript: string;
  feedbackCollectionScript: string;
  complaintHandlingScript: string;
}

export function saveBusinessBasics(token: string, payload: BusinessBasicsPayload) {
  return apiRequest<{ ok: boolean }>("/api/onboarding/business", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function ingestWebsite(token: string, url: string) {
  return apiRequest<{ ok: boolean; chunks: number }>("/api/knowledge/ingest/website", {
    method: "POST",
    token,
    body: JSON.stringify({ url })
  });
}

export function ingestManual(token: string, text: string) {
  return apiRequest<{ ok: boolean; chunks: number }>("/api/knowledge/ingest/manual", {
    method: "POST",
    token,
    body: JSON.stringify({ text })
  });
}

export function ingestPdf(token: string, file: File) {
  const form = new FormData();
  form.append("file", file);

  return apiRequest<{ ok: boolean; chunks: number }>("/api/knowledge/ingest/pdf", {
    method: "POST",
    token,
    body: form
  });
}

export function savePersonality(
  token: string,
  payload: { personality: User["personality"]; customPrompt?: string }
) {
  return apiRequest<{ ok: boolean }>("/api/onboarding/personality", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function setAgentActive(token: string, active: boolean) {
  return apiRequest<{ ok: boolean; active: boolean }>("/api/onboarding/activate", {
    method: "POST",
    token,
    body: JSON.stringify({ active })
  });
}

export interface DashboardOverviewResponse {
  overview: {
    leadsToday: number;
    hotLeads: number;
    warmLeads: number;
    closedDeals: number;
  };
  knowledge: {
    chunks: number;
  };
  whatsapp: {
    status: string;
    phoneNumber: string | null;
    hasQr: boolean;
    qr: string | null;
  };
  agent: {
    active: boolean;
    personality: string;
  };
}

export function fetchDashboardOverview(token: string) {
  return apiRequest<DashboardOverviewResponse>("/api/dashboard/overview", { token });
}

export interface Conversation {
  id: string;
  phone_number: string;
  stage: string;
  score: number;
  last_message: string | null;
  last_message_at: string | null;
  ai_paused: boolean;
  manual_takeover: boolean;
}

export function fetchConversations(token: string) {
  return apiRequest<{ conversations: Conversation[] }>("/api/conversations", { token });
}

export interface ConversationMessage {
  id: string;
  direction: "inbound" | "outbound";
  sender_name: string | null;
  message_text: string;
  created_at: string;
}

export function fetchConversationMessages(token: string, conversationId: string) {
  return apiRequest<{ messages: ConversationMessage[] }>(`/api/conversations/${conversationId}/messages`, { token });
}

export function setManualTakeover(token: string, conversationId: string, enabled: boolean) {
  return apiRequest<{ ok: boolean }>(`/api/conversations/${conversationId}/manual-takeover`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ enabled })
  });
}

export function setConversationPaused(token: string, conversationId: string, paused: boolean) {
  return apiRequest<{ ok: boolean }>(`/api/conversations/${conversationId}/pause`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ paused })
  });
}
