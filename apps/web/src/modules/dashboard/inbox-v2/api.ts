import { API_URL } from "../../../lib/api";
import type { Conversation, ConversationMessage, Label } from "./store/convStore";

async function apiFetch<T>(token: string, path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options?.headers }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Conversations ─────────────────────────────────────────────────────────

export interface ConvPage {
  items: Conversation[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function fetchConvPage(token: string, params: {
  cursor?: string | null;
  limit?: number;
  folder?: string;
  q?: string | null;
}): Promise<ConvPage> {
  const sp = new URLSearchParams();
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.folder && params.folder !== "all") sp.set("status", params.folder);
  if (params.q) sp.set("q", params.q);
  return apiFetch<ConvPage>(token, `/api/conversations?${sp}`);
}

export function fetchConvMessages(token: string, convId: string, params?: { before?: string; limit?: number }): Promise<{ items: ConversationMessage[]; hasMore: boolean; nextCursor: string | null }> {
  const sp = new URLSearchParams();
  if (params?.before) sp.set("before", params.before);
  if (params?.limit) sp.set("limit", String(params.limit));
  return apiFetch(token, `/api/conversations/${convId}/messages?${sp}`);
}

export function fetchConvSearch(token: string, q: string, limit = 20): Promise<{ items: Conversation[] }> {
  return apiFetch(token, `/api/conversations/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}

export function postMarkRead(token: string, convId: string): Promise<{ ok: boolean }> {
  return apiFetch(token, `/api/conversations/${convId}/read`, { method: "POST" });
}

export function patchStatus(token: string, convId: string, status: string, snoozedUntil?: string): Promise<{ ok: boolean }> {
  return apiFetch(token, `/api/conversations/${convId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, snoozed_until: snoozedUntil })
  });
}

export function patchPriority(token: string, convId: string, priority: string): Promise<{ ok: boolean }> {
  return apiFetch(token, `/api/conversations/${convId}/priority`, {
    method: "PATCH",
    body: JSON.stringify({ priority })
  });
}

export function putLabels(token: string, convId: string, labelIds: string[]): Promise<{ ok: boolean }> {
  return apiFetch(token, `/api/conversations/${convId}/labels`, {
    method: "PUT",
    body: JSON.stringify({ label_ids: labelIds })
  });
}

export function postTyping(token: string, convId: string, typing: boolean): Promise<{ ok: boolean }> {
  return apiFetch(token, `/api/conversations/${convId}/typing`, {
    method: "POST",
    body: JSON.stringify({ typing })
  });
}

export interface SendMessageParams {
  text?: string;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  echoId?: string;
  isPrivate?: boolean;
  inReplyToId?: string | null;
}

export function postMessage(token: string, convId: string, params: SendMessageParams): Promise<{ ok: boolean; delivered: boolean }> {
  return apiFetch(token, `/api/conversations/${convId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      text: params.text ?? "",
      mediaUrl: params.mediaUrl,
      mediaMimeType: params.mediaMimeType,
      echoId: params.echoId,
      isPrivate: params.isPrivate ?? false,
      inReplyToId: params.inReplyToId
    })
  });
}

export function postRetry(token: string, convId: string, msgId: string): Promise<{ ok: boolean }> {
  return apiFetch(token, `/api/conversations/${convId}/messages/${msgId}/retry`, { method: "POST" });
}

export function postBulk(token: string, ids: string[], action: string, payload?: Record<string, unknown>): Promise<{ ok: boolean; count: number }> {
  return apiFetch(token, `/api/conversations/bulk`, {
    method: "POST",
    body: JSON.stringify({ ids, action, payload })
  });
}

// ── Labels ────────────────────────────────────────────────────────────────

export function fetchLabels(token: string): Promise<{ labels: Label[] }> {
  return apiFetch(token, `/api/labels`);
}

export function postLabel(token: string, name: string, color: string): Promise<{ label: Label }> {
  return apiFetch(token, `/api/labels`, { method: "POST", body: JSON.stringify({ name, color }) });
}

export function deleteLabel(token: string, labelId: string): Promise<{ ok: boolean }> {
  return apiFetch(token, `/api/labels/${labelId}`, { method: "DELETE" });
}

// ── Contact detail + custom fields ───────────────────────────────────────

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

export interface ContactField {
  id: string;
  label: string;
  name: string;
  field_type: string;
}

export function fetchContactByConversation(token: string, convId: string): Promise<{ contact: ContactRecord }> {
  return apiFetch(token, `/api/contacts/by-conversation/${convId}`);
}

export function listContactFields(token: string): Promise<{ fields: ContactField[] }> {
  return apiFetch(token, `/api/contact-fields`);
}

// ── Agent assignment ──────────────────────────────────────────────────────

export interface AgentProfile {
  id: string;
  name: string;
  avatar_url: string | null;
  handle: string | null;
}

export function fetchAgentProfiles(token: string): Promise<{ profiles: AgentProfile[] }> {
  return apiFetch(token, `/api/agents/profiles`);
}

export function patchAssignAgent(token: string, convId: string, agentProfileId: string | null): Promise<{ ok: boolean }> {
  return apiFetch(token, `/api/conversations/${convId}/assign-agent`, {
    method: "PATCH",
    body: JSON.stringify({ agentProfileId })
  });
}

// ── AI mode toggle ────────────────────────────────────────────────────────

export async function patchAiMode(token: string, convId: string, paused: boolean): Promise<void> {
  await Promise.all([
    apiFetch(token, `/api/conversations/${convId}/manual-takeover`, { method: "PATCH", body: JSON.stringify({ enabled: paused }) }),
    apiFetch(token, `/api/conversations/${convId}/pause`, { method: "PATCH", body: JSON.stringify({ paused }) })
  ]);
}

// ── Canned responses ─────────────────────────────────────────────────────

export interface CannedResponse {
  id: string;
  name: string;
  short_code: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function listCannedResponses(token: string): Promise<{ cannedResponses: CannedResponse[] }> {
  return apiFetch(token, `/api/canned-responses`);
}

export function createCannedResponse(token: string, payload: { name: string; short_code: string; content: string }): Promise<{ cannedResponse: CannedResponse }> {
  return apiFetch(token, `/api/canned-responses`, { method: "POST", body: JSON.stringify(payload) });
}

export function updateCannedResponse(token: string, id: string, payload: Partial<{ name: string; short_code: string; content: string }>): Promise<{ cannedResponse: CannedResponse }> {
  return apiFetch(token, `/api/canned-responses/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteCannedResponse(token: string, id: string): Promise<{ ok: boolean }> {
  return apiFetch(token, `/api/canned-responses/${id}`, { method: "DELETE" });
}

// ── Agent notifications ───────────────────────────────────────────────────

export interface AgentNotification {
  id: string;
  type: "mention" | "assigned" | "unassigned" | "system";
  conversation_id: string | null;
  actor_name: string | null;
  body: string;
  read_at: string | null;
  created_at: string;
}

export function listAgentNotifications(token: string, opts?: { unread?: boolean; limit?: number }): Promise<{ notifications: AgentNotification[]; unreadCount: number }> {
  const sp = new URLSearchParams();
  if (opts?.unread) sp.set("unread", "true");
  if (opts?.limit) sp.set("limit", String(opts.limit));
  return apiFetch(token, `/api/agent-notifications?${sp}`);
}

export function markNotificationRead(token: string, id: string): Promise<{ ok: boolean }> {
  return apiFetch(token, `/api/agent-notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead(token: string): Promise<{ ok: boolean }> {
  return apiFetch(token, `/api/agent-notifications/read-all`, { method: "POST" });
}

// ── CSAT ─────────────────────────────────────────────────────────────────

export function setCsatRating(token: string, convId: string, rating: number): Promise<{ ok: boolean }> {
  return apiFetch(token, `/api/conversations/${convId}/csat`, { method: "PATCH", body: JSON.stringify({ rating }) });
}

export function sendCsatSurvey(token: string, convId: string): Promise<{ ok: boolean }> {
  return apiFetch(token, `/api/conversations/${convId}/csat/send`, { method: "POST" });
}

// ── Notes ─────────────────────────────────────────────────────────────────────

export interface ConvNote {
  id: string;
  content: string;
  created_at: string;
  sender_name: string | null;
}

export function fetchConvNotes(token: string, convId: string): Promise<{ notes: ConvNote[] }> {
  return apiFetch(token, `/api/conversations/${convId}/notes`);
}

export function createConvNote(token: string, convId: string, content: string): Promise<{ note: ConvNote }> {
  return apiFetch(token, `/api/conversations/${convId}/notes`, {
    method: "POST",
    body: JSON.stringify({ content })
  });
}

// ── Flows ─────────────────────────────────────────────────────────────────────

export interface PublishedFlowSummary {
  id: string;
  name: string;
  channel: "web" | "qr" | "api";
}

export function fetchPublishedFlows(token: string): Promise<PublishedFlowSummary[]> {
  return apiFetch<PublishedFlowSummary[]>(token, `/api/flows/published`);
}

export function assignFlow(token: string, flowId: string, convId: string): Promise<{ sessionId: string; flowId: string; flowName: string }> {
  return apiFetch(token, `/api/flows/${flowId}/assign`, {
    method: "POST",
    body: JSON.stringify({ conversationId: convId })
  });
}

// ── Templates ─────────────────────────────────────────────────────────────────

export interface TemplateComponentButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "FLOW";
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[];
}

export interface TemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
  text?: string;
  buttons?: TemplateComponentButton[];
  example?: Record<string, unknown>;
}

export interface MessageTemplate {
  id: string;
  userId: string;
  connectionId: string;
  templateId: string | null;
  name: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  status: string;
  qualityScore: string | null;
  components: TemplateComponent[];
  metaRejectionReason: string | null;
  linkedNumber: string | null;
}

export function fetchApprovedTemplates(token: string, connectionId?: string | null): Promise<MessageTemplate[]> {
  const sp = new URLSearchParams({ status: "APPROVED" });
  if (connectionId) sp.set("connectionId", connectionId);
  return apiFetch<{ templates: MessageTemplate[] }>(token, `/api/meta/templates?${sp}`).then((d) => d.templates);
}

export function sendTemplate(token: string, convId: string, templateId: string, variableValues?: Record<string, string>): Promise<{ ok: boolean; messageId: string | null }> {
  return apiFetch(token, `/api/conversations/${convId}/send-template`, {
    method: "POST",
    body: JSON.stringify({ templateId, variableValues: variableValues ?? {} })
  });
}

// ── AI Assist ─────────────────────────────────────────────────────────────────

export function aiAssistText(token: string, text: string, action: "rewrite" | "translate", language?: string): Promise<{ text: string }> {
  return apiFetch(token, `/api/ai-assist/text`, {
    method: "POST",
    body: JSON.stringify({ text, action, language })
  });
}

// ── Contact lookup ────────────────────────────────────────────────────────

export function fetchContactByPhone(token: string, phone: string): Promise<{ contact: { display_name: string | null; email: string | null; last_incoming_message_at: string | null; marketing_consent_status: string } | null }> {
  return apiFetch(token, `/api/contacts?phone=${encodeURIComponent(phone)}&limit=1`).then((d: unknown) => {
    const data = d as { items?: Array<{ display_name: string | null; email: string | null; last_incoming_message_at: string | null; marketing_consent_status: string }> };
    return { contact: data.items?.[0] ?? null };
  });
}

// ── Outbound conversation ─────────────────────────────────────────────────

export function createOutboundConversation(token: string, params: {
  phone: string;
  channelType: "api" | "qr";
  initialMessage?: string;
}): Promise<{ conversationId: string }> {
  return apiFetch(token, `/api/conversations/outbound`, {
    method: "POST",
    body: JSON.stringify(params)
  });
}
