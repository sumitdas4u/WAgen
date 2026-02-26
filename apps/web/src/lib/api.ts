const runtimeOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:4000";
export const API_URL = import.meta.env.VITE_API_URL || runtimeOrigin;

interface RequestOptions extends RequestInit {
  token?: string | null;
  timeoutMs?: number;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, headers, timeoutMs, ...rest } = options;
  const hasJsonBody = rest.body !== undefined && rest.body !== null && !(rest.body instanceof FormData);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 60_000);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
        ...headers
      }
    });
  } catch (error) {
    clearTimeout(timeout);
    if ((error as Error).name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

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

export function connectWhatsApp(token: string, options?: { resetAuth?: boolean }) {
  return apiRequest<{ ok: boolean }>("/api/whatsapp/connect", {
    method: "POST",
    token,
    body: JSON.stringify({ resetAuth: Boolean(options?.resetAuth) })
  });
}

export function fetchWhatsAppStatus(token: string) {
  return apiRequest<{ status: string; phoneNumber: string | null; hasQr: boolean; qr: string | null }>(
    "/api/whatsapp/status",
    { token }
  );
}

export interface BusinessBasicsPayload {
  companyName: string;
  whatDoYouSell: string;
  targetAudience: string;
  usp: string;
  objections: string;
  defaultCountry: string;
  defaultCurrency: string;
  greetingScript: string;
  availabilityScript: string;
  objectionHandlingScript: string;
  bookingScript: string;
  feedbackCollectionScript: string;
  complaintHandlingScript: string;
  supportAddress: string;
  supportPhoneNumber: string;
  supportContactName: string;
  supportEmail: string;
  aiDoRules: string;
  aiDontRules: string;
  websiteUrl?: string;
  manualFaq?: string;
}

export function saveBusinessBasics(token: string, payload: BusinessBasicsPayload) {
  return apiRequest<{ ok: boolean }>("/api/onboarding/business", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export interface OnboardingAutofillDraft {
  businessBasics: BusinessBasicsPayload;
  personality: User["personality"];
  customPrompt: string;
}

export function autofillOnboarding(token: string, description: string) {
  return apiRequest<{ ok: boolean; draft: OnboardingAutofillDraft }>("/api/onboarding/autofill", {
    method: "POST",
    token,
    body: JSON.stringify({ description })
  });
}

export function ingestWebsite(token: string, url: string, sourceName?: string) {
  return apiRequest<{ ok: boolean; chunks: number }>("/api/knowledge/ingest/website", {
    method: "POST",
    token,
    body: JSON.stringify({ url, sourceName })
  });
}

export function ingestManual(token: string, text: string, sourceName?: string) {
  return apiRequest<{ ok: boolean; chunks: number }>("/api/knowledge/ingest/manual", {
    method: "POST",
    token,
    body: JSON.stringify({ text, sourceName })
  });
}

export interface KnowledgeIngestJob {
  id: string;
  source_name: string | null;
  source_type: "pdf" | "website" | "manual";
  status: "queued" | "processing" | "completed" | "failed";
  stage: string;
  progress: number;
  chunks_created: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function ingestPdf(token: string, files: File[]) {
  const form = new FormData();
  for (const file of files) {
    form.append("file", file);
  }

  return apiRequest<{ ok: boolean; jobs: KnowledgeIngestJob[] }>("/api/knowledge/ingest/pdf", {
    method: "POST",
    token,
    body: form,
    timeoutMs: 5 * 60_000
  });
}

export function fetchIngestionJobs(token: string, ids?: string[]) {
  const params = new URLSearchParams();
  if (ids && ids.length > 0) {
    params.set("ids", ids.join(","));
  }
  const query = params.toString();
  const path = query ? `/api/knowledge/ingest/jobs?${query}` : "/api/knowledge/ingest/jobs";
  return apiRequest<{ jobs: KnowledgeIngestJob[] }>(path, { token });
}

export interface KnowledgeSource {
  source_type: "pdf" | "website" | "manual";
  source_name: string | null;
  chunks: number;
  last_ingested_at: string;
}

export interface KnowledgeChunkPreview {
  id: string;
  content_chunk: string;
  source_type: "pdf" | "website" | "manual";
  source_name: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

export function fetchKnowledgeSources(
  token: string,
  options?: { sourceType?: KnowledgeSource["source_type"] }
) {
  const params = new URLSearchParams();
  if (options?.sourceType) {
    params.set("sourceType", options.sourceType);
  }

  const query = params.toString();
  const path = query ? `/api/knowledge/sources?${query}` : "/api/knowledge/sources";
  return apiRequest<{ sources: KnowledgeSource[] }>(path, { token });
}

export function deleteKnowledgeSource(
  token: string,
  payload: { sourceType: KnowledgeSource["source_type"]; sourceName: string }
) {
  return apiRequest<{ ok: boolean; deleted: number }>("/api/knowledge/source", {
    method: "DELETE",
    token,
    body: JSON.stringify(payload)
  });
}

export function fetchKnowledgeChunks(
  token: string,
  options?: { sourceType?: KnowledgeSource["source_type"]; sourceName?: string; limit?: number }
) {
  const params = new URLSearchParams();
  if (options?.sourceType) {
    params.set("sourceType", options.sourceType);
  }
  if (options?.sourceName) {
    params.set("sourceName", options.sourceName);
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }

  const query = params.toString();
  const path = query ? `/api/knowledge/chunks?${query}` : "/api/knowledge/chunks";
  return apiRequest<{ chunks: KnowledgeChunkPreview[] }>(path, { token });
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

export interface UsageModelBreakdown {
  ai_model: string;
  messages: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  estimated_cost_inr: number;
}

export interface UsageDailyBreakdown {
  day: string;
  messages: number;
  total_tokens: number;
  estimated_cost_usd: number;
  estimated_cost_inr: number;
}

export interface UsageMessageCost {
  message_id: string;
  conversation_id: string;
  conversation_phone: string;
  ai_model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  estimated_cost_inr: number;
  created_at: string;
}

export interface UsageAnalyticsResponse {
  usage: {
    range_days: number;
    messages: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
    estimated_cost_inr: number;
    by_model: UsageModelBreakdown[];
    daily: UsageDailyBreakdown[];
    recent_messages: UsageMessageCost[];
  };
}

export function fetchUsageAnalytics(token: string, options?: { days?: number; limit?: number }) {
  const params = new URLSearchParams();
  if (typeof options?.days === "number") {
    params.set("days", String(options.days));
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }

  const query = params.toString();
  const path = query ? `/api/dashboard/usage?${query}` : "/api/dashboard/usage";
  return apiRequest<UsageAnalyticsResponse>(path, { token });
}

export interface Conversation {
  id: string;
  phone_number: string;
  contact_name?: string | null;
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
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  ai_model: string | null;
  retrieval_chunks: number | null;
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
