import Constants from "expo-constants";
import type {
  AgentNotification,
  AgentProfile,
  CannedResponse,
  ContactRecord,
  Conversation,
  ConversationMessage,
  ConvFilters,
  ConvFolder,
  ConvNote,
  InboxContact,
  Label,
  MessageTemplate,
  PublishedFlowSummary,
  User
} from "./types";

const configApiUrl =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
  (Constants.manifest2?.extra?.expoClient?.extra?.apiUrl as string | undefined) ||
  "http://localhost:4000";

export const API_URL = configApiUrl.replace(/\/+$/, "");

export function toWsBase(url: string): string {
  if (url.startsWith("https://")) return url.replace("https://", "wss://");
  if (url.startsWith("http://")) return url.replace("http://", "ws://");
  return url;
}

export async function apiFetch<T>(token: string | null, path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options?.body !== undefined && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const text = await response.text();
  if (!response.ok) {
    let payload: { error?: string; message?: string } = {};
    if (text) {
      try {
        payload = JSON.parse(text) as { error?: string; message?: string };
      } catch {
        payload = {};
      }
    }
    throw new Error(payload.error || payload.message || `Request failed: ${response.status}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export interface AuthResponse {
  token: string;
  user: User;
}

export function sendPhoneLoginOtp(phoneNumber: string) {
  return apiFetch<{ ok: boolean; phoneNumber: string; expiresAt: string; resendAfterSeconds: number; devCode?: string }>(
    null,
    "/api/auth/phone-login/send-otp",
    { method: "POST", body: JSON.stringify({ phoneNumber }) }
  );
}

export function verifyPhoneLoginOtp(phoneNumber: string, otp: string) {
  return apiFetch<AuthResponse>(null, "/api/auth/phone-login/verify", {
    method: "POST",
    body: JSON.stringify({ phoneNumber, otp })
  });
}

export function fetchMe(token: string) {
  return apiFetch<{ user: User }>(token, "/api/auth/me");
}

export function registerPushToken(token: string, payload: {
  expoPushToken: string;
  platform: "android" | "ios" | "unknown";
  deviceName?: string | null;
  appVersion?: string | null;
}) {
  return apiFetch<{ ok: boolean }>(token, "/api/mobile/push-tokens", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function revokePushToken(token: string, expoPushToken: string) {
  return apiFetch<{ ok: boolean; revoked: boolean }>(token, "/api/mobile/push-tokens/revoke", {
    method: "POST",
    body: JSON.stringify({ expoPushToken })
  });
}

export interface ConvPage {
  items: Conversation[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function fetchConvPage(token: string, params: {
  cursor?: string | null;
  limit?: number;
  folder?: ConvFolder;
  q?: string | null;
  filters?: ConvFilters;
}): Promise<ConvPage> {
  const sp = new URLSearchParams();
  if (params.cursor) sp.set("cursor", params.cursor);
  sp.set("limit", String(params.limit ?? 60));
  if (params.folder && params.folder !== "all") sp.set("status", params.folder);
  if (params.q) sp.set("q", params.q);
  const filters = params.filters;
  if (filters?.channel && filters.channel !== "all") sp.set("channel", filters.channel);
  if (filters?.aiMode && filters.aiMode !== "all") sp.set("aiMode", filters.aiMode);
  if (filters?.assignment && filters.assignment !== "all") sp.set("assignment", filters.assignment);
  if (filters?.labelId && filters.labelId !== "all") sp.set("labelId", filters.labelId);
  if (filters?.leadKind && filters.leadKind !== "all") sp.set("leadKind", filters.leadKind);
  if (filters?.priority && filters.priority !== "all") sp.set("priority", filters.priority);
  if (filters?.stage && filters.stage !== "all") sp.set("stage", filters.stage);
  filters?.tags?.forEach((tag) => sp.append("tags", tag));
  return apiFetch<ConvPage>(token, `/api/conversations?${sp}`);
}

export function fetchConversation(token: string, convId: string) {
  return apiFetch<{ conversation: Conversation }>(token, `/api/conversations/${convId}`);
}

export function fetchConvMessages(token: string, convId: string, before?: string | null) {
  const sp = new URLSearchParams();
  sp.set("limit", "50");
  if (before) sp.set("before", before);
  return apiFetch<{ items: ConversationMessage[]; hasMore: boolean; nextCursor: string | null }>(
    token,
    `/api/conversations/${convId}/messages?${sp}`
  );
}

export function postMarkRead(token: string, convId: string) {
  return apiFetch<{ ok: boolean }>(token, `/api/conversations/${convId}/read`, { method: "POST" });
}

export function postMessage(token: string, convId: string, params: {
  text?: string;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  echoId?: string;
  isPrivate?: boolean;
  inReplyToId?: string | null;
}) {
  return apiFetch<{ ok: boolean; delivered: boolean }>(token, `/api/conversations/${convId}/messages`, {
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

export function postRetry(token: string, convId: string, msgId: string) {
  return apiFetch<{ ok: boolean; queued?: boolean; retryCount?: number }>(
    token,
    `/api/conversations/${convId}/messages/${msgId}/retry`,
    { method: "POST" }
  );
}

export function patchStatus(token: string, convId: string, status: string) {
  return apiFetch<{ ok: boolean }>(token, `/api/conversations/${convId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function patchPriority(token: string, convId: string, priority: string) {
  return apiFetch<{ ok: boolean }>(token, `/api/conversations/${convId}/priority`, {
    method: "PATCH",
    body: JSON.stringify({ priority })
  });
}

export function patchAssignAgent(token: string, convId: string, agentProfileId: string | null) {
  return apiFetch<{ ok: boolean }>(token, `/api/conversations/${convId}/assign-agent`, {
    method: "PATCH",
    body: JSON.stringify({ agentProfileId })
  });
}

export async function patchAiMode(token: string, convId: string, paused: boolean): Promise<void> {
  await Promise.all([
    apiFetch(token, `/api/conversations/${convId}/manual-takeover`, { method: "PATCH", body: JSON.stringify({ enabled: paused }) }),
    apiFetch(token, `/api/conversations/${convId}/pause`, { method: "PATCH", body: JSON.stringify({ paused }) })
  ]);
}

export function fetchLabels(token: string) {
  return apiFetch<{ labels: Label[] }>(token, "/api/labels");
}

export function fetchConversationLabels(token: string, convId: string) {
  return apiFetch<{ label_ids: string[] }>(token, `/api/conversations/${convId}/labels`);
}

export function putLabels(token: string, convId: string, labelIds: string[]) {
  return apiFetch<{ ok: boolean }>(token, `/api/conversations/${convId}/labels`, {
    method: "PUT",
    body: JSON.stringify({ label_ids: labelIds })
  });
}

export function fetchAgentProfiles(token: string) {
  return apiFetch<{ profiles: AgentProfile[] }>(token, "/api/agents/profiles");
}

export function listCannedResponses(token: string) {
  return apiFetch<{ cannedResponses: CannedResponse[] }>(token, "/api/canned-responses");
}

export function listAgentNotifications(token: string, opts?: { unread?: boolean; limit?: number }) {
  const sp = new URLSearchParams();
  if (opts?.unread) sp.set("unread", "true");
  sp.set("limit", String(opts?.limit ?? 80));
  return apiFetch<{ notifications: AgentNotification[]; unreadCount: number }>(token, `/api/agent-notifications?${sp}`);
}

export function markNotificationRead(token: string, id: string) {
  return apiFetch<{ ok: boolean }>(token, `/api/agent-notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead(token: string) {
  return apiFetch<{ ok: boolean }>(token, "/api/agent-notifications/read-all", { method: "POST" });
}

export function fetchContactByConversation(token: string, convId: string) {
  return apiFetch<{ contact: ContactRecord }>(token, `/api/contacts/by-conversation/${convId}`);
}

export function fetchConvNotes(token: string, convId: string) {
  return apiFetch<{ notes: ConvNote[] }>(token, `/api/conversations/${convId}/notes`);
}

export function createConvNote(token: string, convId: string, content: string) {
  return apiFetch<{ note: ConvNote }>(token, `/api/conversations/${convId}/notes`, {
    method: "POST",
    body: JSON.stringify({ content })
  });
}

export function fetchPublishedFlows(token: string) {
  return apiFetch<PublishedFlowSummary[]>(token, "/api/flows/published");
}

export function assignFlow(token: string, flowId: string, convId: string) {
  return apiFetch<{ sessionId: string; flowId: string; flowName: string }>(token, `/api/flows/${flowId}/assign`, {
    method: "POST",
    body: JSON.stringify({ conversationId: convId })
  });
}

export function fetchApprovedTemplates(token: string, linkedNumber?: string | null) {
  const sp = new URLSearchParams({ status: "APPROVED" });
  if (linkedNumber) sp.set("linkedNumber", linkedNumber);
  return apiFetch<{ templates: MessageTemplate[] }>(token, `/api/meta/templates?${sp}`).then((data) => data.templates);
}

export function sendTemplate(token: string, convId: string, templateId: string, variableValues?: Record<string, string>) {
  return apiFetch<{ ok: boolean; messageId: string | null }>(token, `/api/conversations/${convId}/send-template`, {
    method: "POST",
    body: JSON.stringify({ templateId, variableValues: variableValues ?? {} })
  });
}

export async function uploadConversationMedia(token: string, convId: string, file: {
  uri: string;
  name: string;
  mimeType?: string | null;
}) {
  const body = new FormData();
  body.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.mimeType || "application/octet-stream"
  } as unknown as Blob);

  const response = await fetch(`${API_URL}/api/conversations/${convId}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body
  });
  const text = await response.text();
  if (!response.ok) {
    let payload: { error?: string } = {};
    try {
      payload = JSON.parse(text) as { error?: string };
    } catch {
      payload = {};
    }
    throw new Error(payload.error || `Upload failed: ${response.status}`);
  }
  const uploaded = JSON.parse(text) as { url: string; mimeType: string };
  return {
    ...uploaded,
    url: uploaded.url.startsWith("/") ? `${API_URL}${uploaded.url}` : uploaded.url
  };
}

export function listInboxContacts(token: string, opts?: { q?: string; limit?: number }) {
  const sp = new URLSearchParams();
  if (opts?.q?.trim()) sp.set("q", opts.q.trim());
  sp.set("limit", String(opts?.limit ?? 30));
  return apiFetch<{ contacts?: InboxContact[]; items?: InboxContact[] }>(token, `/api/contacts?${sp}`);
}

export function createOutboundConversation(token: string, params: {
  contactId: string;
  channelType: "api" | "qr";
  connectionId?: string | null;
}) {
  return apiFetch<{ conversationId: string; conversation?: Conversation }>(token, "/api/conversations/outbound", {
    method: "POST",
    body: JSON.stringify(params)
  });
}
