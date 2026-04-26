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

// ── Contact lookup ────────────────────────────────────────────────────────

export function fetchContactByPhone(token: string, phone: string): Promise<{ contact: { display_name: string | null; email: string | null; last_incoming_message_at: string | null; marketing_consent_status: string } | null }> {
  return apiFetch(token, `/api/contacts?phone=${encodeURIComponent(phone)}&limit=1`).then((d: unknown) => {
    const data = d as { items?: Array<{ display_name: string | null; email: string | null; last_incoming_message_at: string | null; marketing_consent_status: string }> };
    return { contact: data.items?.[0] ?? null };
  });
}
