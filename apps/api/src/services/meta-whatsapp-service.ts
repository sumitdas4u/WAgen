import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { uploadInboundMedia } from "./supabase-storage-service.js";
import { getOrCreateConversation, trackOutboundMessage } from "./conversation-service.js";
import {
  encodeFlowLocationInput,
  formatFlowLocationSummary
} from "./flow-input-codec.js";
import { processIncomingMessage } from "./message-router-service.js";
import { getContactByPhoneForUser, upsertWebhookContact } from "./contacts-service.js";
import { findSuppressedRecipients } from "./message-delivery-data-service.js";
import { evaluateHardBlocks } from "./outbound-policy-service.js";
import { getUserPlanEntitlements } from "./billing-service.js";
import {
  adaptPayloadForChannel,
  summarizeFlowMessage,
  type FlowMessagePayload,
  validateFlowMessagePayload
} from "./outbound-message-types.js";
import { fanoutEvent } from "./event-fanout-service.js";

interface MetaConnectionRow {
  id: string;
  user_id: string;
  meta_business_id: string | null;
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  linked_number: string | null;
  access_token_encrypted: string;
  token_expires_at: string | null;
  enabled: boolean;
  subscription_status: string;
  status: string;
  billing_mode: string;
  billing_status: string;
  billing_owner_business_id: string | null;
  billing_attached_at: string | null;
  billing_error: string | null;
  billing_credit_line_id: string | null;
  billing_allocation_config_id: string | null;
  billing_currency: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface MetaConnection {
  id: string;
  userId: string;
  metaBusinessId: string | null;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  linkedNumber: string | null;
  tokenExpiresAt: string | null;
  enabled: boolean;
  subscriptionStatus: string;
  status: string;
  billingMode: string;
  billingStatus: string;
  billingOwnerBusinessId: string | null;
  billingAttachedAt: string | null;
  billingError: string | null;
  billingCreditLineId: string | null;
  billingAllocationConfigId: string | null;
  billingCurrency: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MetaBusinessStatus {
  connected: boolean;
  enabled: boolean;
  connection: MetaConnection | null;
  connections: MetaConnection[];
}

export interface MetaBusinessProfile {
  connectionId: string;
  phoneNumberId: string;
  displayPictureUrl: string | null;
  address: string | null;
  businessDescription: string | null;
  email: string | null;
  vertical: string | null;
  websites: string[];
  about: string | null;
}

export interface CompleteEmbeddedSignupInput {
  code: string;
  redirectUri?: string;
  metaBusinessId?: string;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
}

export interface GraphListResponse<T> {
  data?: T[];
}

interface GraphBusiness {
  id: string;
  name?: string;
}

interface GraphWaba {
  id: string;
  name?: string;
}

interface GraphPhone {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
}

interface GraphWhatsAppBusinessProfile {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: unknown;
  vertical?: string;
}

type MetaStatusSnapshot = {
  businessVerificationStatus: string | null;
  wabaReviewStatus: string | null;
  phoneQualityRating: string | null;
  messagingLimitTier: string | null;
  codeVerificationStatus: string | null;
  nameStatus: string | null;
  verifiedName: string | null;
  phoneStatus: string | null;
  webhookAppSubscribed: boolean | null;
  displayPhoneNumber: string | null;
  syncedAt: string;
};

type SharedBillingAttachmentResult = {
  mode: "none" | "partner";
  status: "not_configured" | "pending" | "attached" | "failed";
  ownerBusinessId: string | null;
  attachedAt: string | null;
  error: string | null;
  creditLineId: string | null;
  allocationConfigId: string | null;
  currency: string | null;
  metadata?: Record<string, unknown>;
};

interface WebhookMessage {
  id?: string;
  from?: string;
  type?: string;
  timestamp?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; sha256?: string; caption?: string };
  video?: { id?: string; mime_type?: string; sha256?: string; caption?: string };
  audio?: { id?: string; mime_type?: string; sha256?: string; voice?: boolean };
  document?: { id?: string; mime_type?: string; sha256?: string; filename?: string; caption?: string };
  sticker?: { id?: string; mime_type?: string; sha256?: string };
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
    url?: string;
  };
  contacts?: Array<{
    name?: { formatted_name?: string; first_name?: string; last_name?: string };
    phones?: Array<{ phone?: string; wa_id?: string; type?: string }>;
    org?: { company?: string };
  }>;
  reaction?: { message_id?: string; emoji?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    button_reply?: { title?: string; id?: string };
    list_reply?: { title?: string; description?: string; id?: string };
  };
}

interface WebhookContact {
  wa_id?: string;
  profile?: {
    name?: string;
  };
}

interface WebhookValue {
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: WebhookContact[];
  messages?: WebhookMessage[];
  statuses?: Array<Record<string, unknown>>;
}

interface WebhookChange {
  field?: string;
  value?: WebhookValue;
}

interface WebhookEntry {
  changes?: WebhookChange[];
}

interface WebhookPayload {
  object?: string;
  entry?: WebhookEntry[];
}

type WebhookMessageTask = {
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  message: WebhookMessage;
  contacts: WebhookContact[];
};

type NormalizedWebhookMessageTask = {
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  from: string;
  senderName: string | null;
  messageId: string;
  messageType: string;
  text: string;
  flowText?: string | null;
  mediaUrl?: string | null;
  mimeType?: string | null;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

function mapConnection(row: MetaConnectionRow): MetaConnection {
  return {
    id: row.id,
    userId: row.user_id,
    metaBusinessId: row.meta_business_id,
    wabaId: row.waba_id,
    phoneNumberId: row.phone_number_id,
    displayPhoneNumber: row.display_phone_number,
    linkedNumber: row.linked_number,
    tokenExpiresAt: row.token_expires_at,
    enabled: row.enabled,
    subscriptionStatus: row.subscription_status,
    status: row.status,
    billingMode: row.billing_mode,
    billingStatus: row.billing_status,
    billingOwnerBusinessId: row.billing_owner_business_id,
    billingAttachedAt: row.billing_attached_at,
    billingError: row.billing_error,
    billingCreditLineId: row.billing_credit_line_id,
    billingAllocationConfigId: row.billing_allocation_config_id,
    billingCurrency: row.billing_currency,
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizePhoneDigits(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }
  const digits = input.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  return digits;
}

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parseStringArray(parsed);
    } catch {
      return [trimmed];
    }
  }
  return [];
}

function getTokenCipherKey(): Buffer {
  const seed = env.META_TOKEN_ENCRYPTION_KEY;
  if (!seed) {
    throw new Error("META_TOKEN_ENCRYPTION_KEY is required for Meta token encryption.");
  }
  return createHash("sha256").update(seed).digest();
}

function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getTokenCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptToken(value: string): string {
  const [version, ivB64, tagB64, payloadB64] = value.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !payloadB64) {
    throw new Error("Invalid encrypted token payload");
  }

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const payload = Buffer.from(payloadB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", getTokenCipherKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
}

function ensureMetaCoreConfig(): void {
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new Error("Meta App is not configured. Set META_APP_ID and META_APP_SECRET.");
  }
}

function isSharedBillingConfigured(): boolean {
  return Boolean(env.META_SYSTEM_USER_TOKEN?.trim() && env.META_PARTNER_BUSINESS_ID?.trim());
}

function getSharedBillingCurrency(): string {
  return env.META_SHARED_BILLING_CURRENCY.trim().toUpperCase();
}

function getMetaRedirectUri(override?: string): string {
  if (override?.trim()) {
    return override.trim();
  }
  return env.META_REDIRECT_URI || `${env.APP_BASE_URL.replace(/\/$/, "")}/meta-callback`;
}

export function buildGraphUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}${normalizedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && `${value}`.length > 0) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

export async function parseGraphResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = (
      json as {
        error?: {
          message?: string;
          code?: number | string;
          error_subcode?: number | string;
          error_data?: { details?: string };
        };
      } | null
    )?.error;
    const message = errorPayload?.message || `Meta Graph request failed (${response.status})`;
    const errorDetails = errorPayload?.error_data?.details?.trim() || null;
    const displayMessage =
      errorDetails && !message.toLowerCase().includes(errorDetails.toLowerCase())
        ? `${message}: ${errorDetails}`
        : message;
    const errorCode = errorPayload?.code != null ? String(errorPayload.code) : null;
    const errorSubcode = errorPayload?.error_subcode != null ? String(errorPayload.error_subcode) : null;
    const details = [
      `status=${response.status}`,
      ...(errorCode ? [`code=${errorCode}`] : []),
      ...(errorSubcode ? [`subcode=${errorSubcode}`] : [])
    ].join(" ");
    throw new Error(`${displayMessage} [${details}]`);
  }
  return json as T;
}

export async function graphGet<T>(
  path: string,
  accessToken: string,
  query?: Record<string, string | number | undefined>
): Promise<T> {
  const response = await fetch(buildGraphUrl(path, query), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  return parseGraphResponse<T>(response);
}

export async function graphPost<T>(
  path: string,
  accessToken: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(buildGraphUrl(path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return parseGraphResponse<T>(response);
}

export async function graphDelete<T>(
  path: string,
  accessToken: string,
  query?: Record<string, string | number | undefined>
): Promise<T> {
  const response = await fetch(buildGraphUrl(path, query), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  return parseGraphResponse<T>(response);
}

async function graphPostForm<T>(
  path: string,
  accessToken: string,
  body: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }

  const response = await fetch(buildGraphUrl(path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  return parseGraphResponse<T>(response);
}

export async function graphPostMedia(
  phoneNumberId: string,
  accessToken: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<{ id: string }> {
  const formData = new FormData();
  formData.append("messaging_product", "whatsapp");
  formData.append(
    "file",
    new Blob([new Uint8Array(fileBuffer)], { type: mimeType }),
    `upload.${mimeType.split("/")[1] ?? "bin"}`
  );

  const response = await fetch(buildGraphUrl(`/${phoneNumberId}/media`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    body: formData
  });
  return parseGraphResponse<{ id: string }>(response);
}

export async function graphStartUploadSession(
  appId: string,
  accessToken: string,
  input: {
    fileName: string;
    fileLength: number;
    fileType: string;
  }
): Promise<{ id: string }> {
  const response = await fetch(
    buildGraphUrl(`/${appId}/uploads`, {
      file_name: input.fileName,
      file_length: input.fileLength,
      file_type: input.fileType
    }),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );
  return parseGraphResponse<{ id: string }>(response);
}

export async function graphUploadFileHandle(
  uploadSessionId: string,
  accessToken: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<{ h: string }> {
  const response = await fetch(buildGraphUrl(`/${uploadSessionId}`), {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_offset: "0",
      "Content-Type": mimeType
    },
    body: new Blob([new Uint8Array(fileBuffer)], { type: mimeType })
  });
  return parseGraphResponse<{ h: string }>(response);
}

type MetaInboundMediaDescriptor = {
  id: string;
  mimeType: string | null;
  filename: string | null;
  kind: "image" | "video" | "audio" | "document" | "sticker";
};

type MetaInboundMediaDownload = {
  buffer: Buffer;
  mimeType: string;
  filename: string;
};


function mediaExtensionFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "video/mp4") return "mp4";
  if (normalized === "audio/mpeg") return "mp3";
  if (normalized === "audio/ogg") return "ogg";
  if (normalized === "application/pdf") return "pdf";
  return normalized.split("/")[1] ?? "bin";
}

async function storeMetaInboundMediaUpload(
  userId: string,
  media: MetaInboundMediaDownload
): Promise<string | null> {
  return uploadInboundMedia({
    userId,
    buffer: media.buffer,
    mimeType: media.mimeType,
    folder: "inbound",
    filename: media.filename
  });
}

function normalizeMetaMessageTimestamp(value: string | undefined): string {
  if (!value?.trim()) {
    return new Date().toISOString();
  }
  if (/^\d+$/.test(value.trim())) {
    return new Date(Number(value.trim()) * 1000).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function selectInboundMediaDescriptor(message: WebhookMessage): MetaInboundMediaDescriptor | null {
  if (message.image?.id) {
    return {
      id: message.image.id,
      mimeType: message.image.mime_type ?? null,
      filename: null,
      kind: "image"
    };
  }
  if (message.video?.id) {
    return {
      id: message.video.id,
      mimeType: message.video.mime_type ?? null,
      filename: null,
      kind: "video"
    };
  }
  if (message.audio?.id) {
    return {
      id: message.audio.id,
      mimeType: message.audio.mime_type ?? null,
      filename: null,
      kind: "audio"
    };
  }
  if (message.document?.id) {
    return {
      id: message.document.id,
      mimeType: message.document.mime_type ?? null,
      filename: message.document.filename ?? null,
      kind: "document"
    };
  }
  if (message.sticker?.id) {
    return {
      id: message.sticker.id,
      mimeType: message.sticker.mime_type ?? "image/webp",
      filename: null,
      kind: "sticker"
    };
  }
  return null;
}

async function downloadMetaInboundMedia(
  accessToken: string,
  descriptor: MetaInboundMediaDescriptor
): Promise<MetaInboundMediaDownload | null> {
  try {
    const metadata = await graphGet<{
      url?: string;
      mime_type?: string;
      file_size?: number;
    }>(`/${descriptor.id}`, accessToken);
    const mediaUrl = metadata.url?.trim();
    const mimeType = metadata.mime_type?.trim() || descriptor.mimeType || "application/octet-stream";
    if (!mediaUrl) {
      return null;
    }

    const response = await fetch(mediaUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) {
      throw new Error(`Meta media download failed (${response.status})`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      return null;
    }
    if (buffer.length > env.INBOUND_MEDIA_MAX_BYTES) {
      return null;
    }

    const extension = mediaExtensionFromMimeType(mimeType);
    return {
      buffer,
      mimeType,
      filename: descriptor.filename?.trim() || `meta-${descriptor.kind}.${extension}`
    };
  } catch (error) {
    console.warn(`[MetaWebhook] inbound media download failed id=${descriptor.id}`, error);
    return null;
  }
}

function summarizeSharedContacts(contacts: NonNullable<WebhookMessage["contacts"]>): string | null {
  const first = contacts[0];
  if (!first) {
    return null;
  }
  const name =
    first.name?.formatted_name?.trim() ||
    [first.name?.first_name, first.name?.last_name].filter(Boolean).join(" ").trim() ||
    "Contact";
  const primaryPhone =
    first.phones?.[0]?.phone?.trim() ||
    first.phones?.[0]?.wa_id?.trim() ||
    null;
  const company = first.org?.company?.trim() || null;
  return [`[CONTACT] ${name}`, company, primaryPhone].filter(Boolean).join("\n");
}

function inferMetaWebhookMessageType(message: WebhookMessage): string {
  if (message.text?.body) return "text";
  if (message.image) return "image";
  if (message.video) return "video";
  if (message.audio) return "audio";
  if (message.document) return "document";
  if (message.sticker) return "sticker";
  if (message.location) return "location";
  if (message.contacts?.length) return "contact";
  if (message.reaction) return "reaction";
  if (message.button) return "button";
  if (message.interactive?.button_reply) return "button_reply";
  if (message.interactive?.list_reply) return "list_reply";
  return message.type?.trim() || "unknown";
}

export function summarizeMetaWebhookMessage(message: WebhookMessage): { text: string; flowText?: string | null } | null {
  const directText = message.text?.body?.trim();
  if (directText) {
    return { text: directText, flowText: directText };
  }

  const buttonText = message.button?.text?.trim();
  if (buttonText) {
    return { text: buttonText, flowText: buttonText };
  }

  const interactiveButton = message.interactive?.button_reply;
  if (interactiveButton) {
    const line = [interactiveButton.title, interactiveButton.id].filter(Boolean).join(" ").trim();
    if (line) {
      return { text: line, flowText: line };
    }
  }

  const interactiveList = message.interactive?.list_reply;
  if (interactiveList) {
    const line = [interactiveList.title, interactiveList.description, interactiveList.id].filter(Boolean).join(" ").trim();
    if (line) {
      return { text: line, flowText: line };
    }
  }

  const latitude = Number(message.location?.latitude);
  const longitude = Number(message.location?.longitude);
  if (!Number.isNaN(latitude) && !Number.isNaN(longitude)) {
    const locationPayload = {
      latitude,
      longitude,
      ...(message.location?.name?.trim() ? { name: message.location.name.trim() } : {}),
      ...(message.location?.address?.trim() ? { address: message.location.address.trim() } : {}),
      ...(message.location?.url?.trim() ? { url: message.location.url.trim() } : {}),
      source: "native" as const
    };
    return {
      text: formatFlowLocationSummary(locationPayload),
      flowText: encodeFlowLocationInput(locationPayload)
    };
  }

  const mediaCaption =
    message.image?.caption?.trim() ||
    message.video?.caption?.trim() ||
    message.document?.caption?.trim();
  if (mediaCaption) {
    return { text: mediaCaption, flowText: mediaCaption };
  }

  if (message.contacts?.length) {
    const contactSummary = summarizeSharedContacts(message.contacts);
    if (contactSummary) {
      return { text: contactSummary, flowText: contactSummary };
    }
  }

  const reactionEmoji = message.reaction?.emoji?.trim();
  if (reactionEmoji) {
    const summary = `[REACTION] ${reactionEmoji}`;
    return { text: summary, flowText: summary };
  }

  if (message.sticker) {
    return { text: "[Sticker received]", flowText: "[Sticker received]" };
  }
  if (message.image) {
    return { text: "[Image received]", flowText: "[Image received]" };
  }
  if (message.video) {
    return { text: "[Video received]", flowText: "[Video received]" };
  }
  if (message.audio) {
    return { text: message.audio.voice ? "[Voice note received]" : "[Audio received]", flowText: "[Audio received]" };
  }
  if (message.document) {
    const label = message.document.filename?.trim() || "Document received";
    return { text: `[Document] ${label}`, flowText: `[Document] ${label}` };
  }

  return null;
}

type PhoneRegistrationAttempt = {
  attempted: boolean;
  success: boolean;
  reason: "registered" | "already_registered" | "missing_pin" | "failed";
  error?: string;
};

type WebhookSubscriptionAttempt = {
  attempted: boolean;
  success: boolean;
  reason: "subscribed" | "already_subscribed" | "failed";
  error?: string;
};

function buildWebhookSubscriptionMetadata(attempt: WebhookSubscriptionAttempt, trigger: string): Record<string, unknown> {
  return {
    webhookSubscription: {
      ...attempt,
      trigger,
      attemptedAt: new Date().toISOString()
    }
  };
}

function buildPhoneRegistrationMetadata(attempt: PhoneRegistrationAttempt, trigger: string): Record<string, unknown> {
  return {
    registration: {
      ...attempt,
      trigger,
      attemptedAt: new Date().toISOString()
    }
  };
}

function getPhoneRegistrationFailureMessage(attempt: PhoneRegistrationAttempt): string | null {
  if (attempt.success) {
    return null;
  }
  if (attempt.reason === "missing_pin") {
    return "WhatsApp number is not fully connected yet. Set META_PHONE_REGISTRATION_PIN in API env and reconnect this number.";
  }
  return `WhatsApp number registration failed: ${attempt.error ?? "unknown error"}`;
}

async function registerPhoneNumberIfConfigured(accessToken: string, phoneNumberId: string): Promise<PhoneRegistrationAttempt> {
  const pin = env.META_PHONE_REGISTRATION_PIN?.trim();
  if (!pin) {
    return {
      attempted: false,
      success: false,
      reason: "missing_pin"
    };
  }

  try {
    await graphPost(`/${phoneNumberId}/register`, accessToken, {
      messaging_product: "whatsapp",
      pin
    });
    return {
      attempted: true,
      success: true,
      reason: "registered"
    };
  } catch (error) {
    const message = (error as Error).message || "Unknown registration failure";
    if (message.toLowerCase().includes("already") && message.toLowerCase().includes("registered")) {
      return {
        attempted: true,
        success: true,
        reason: "already_registered"
      };
    }
    return {
      attempted: true,
      success: false,
      reason: "failed",
      error: message
    };
  }
}

async function subscribeAppToWabaWebhook(accessToken: string, wabaId: string): Promise<WebhookSubscriptionAttempt> {
  try {
    await graphPost<{ success?: boolean }>(`/${wabaId}/subscribed_apps`, accessToken, {});
    return {
      attempted: true,
      success: true,
      reason: "subscribed"
    };
  } catch (error) {
    const message = (error as Error).message || "Unknown webhook subscription failure";
    if (message.toLowerCase().includes("already") && message.toLowerCase().includes("subscribed")) {
      return {
        attempted: true,
        success: true,
        reason: "already_subscribed"
      };
    }
    return {
      attempted: true,
      success: false,
      reason: "failed",
      error: message
    };
  }
}

async function detachSharedBillingFromWaba(allocationConfigId: string): Promise<void> {
  if (!env.META_SYSTEM_USER_TOKEN?.trim()) {
    return;
  }
  try {
    await graphDelete<Record<string, unknown>>(`/${allocationConfigId}`, env.META_SYSTEM_USER_TOKEN.trim());
    console.info(`[MetaConnect] detached credit line allocation ${allocationConfigId}`);
  } catch (error) {
    console.warn(`[MetaConnect] credit line detach failed for ${allocationConfigId}: ${(error as Error).message}`);
  }
}

async function attachSharedBillingToWaba(input: {
  metaBusinessId: string | null;
  wabaId: string;
}): Promise<SharedBillingAttachmentResult> {
  if (!isSharedBillingConfigured()) {
    return {
      mode: "none",
      status: "not_configured",
      ownerBusinessId: env.META_PARTNER_BUSINESS_ID?.trim() || null,
      attachedAt: null,
      error: null,
      creditLineId: null,
      allocationConfigId: null,
      currency: null
    };
  }

  const systemUserToken = env.META_SYSTEM_USER_TOKEN!.trim();
  const ownerBusinessId = env.META_PARTNER_BUSINESS_ID!.trim();
  const currency = getSharedBillingCurrency();

  try {
    const creditLines = await graphGet<GraphListResponse<Record<string, unknown>>>(
      `/${ownerBusinessId}/extendedcredits`,
      systemUserToken,
      { fields: "id,legal_entity_name", limit: 25 }
    );
    const creditLine = creditLines.data?.find((entry) => pickStringField(entry, ["id"])) ?? null;
    const creditLineId = pickStringField(creditLine, ["id"]);
    if (!creditLineId) {
      throw new Error("No extended credit line found on the partner business.");
    }

    const attachResponse = await graphPostForm<Record<string, unknown>>(
      `/${creditLineId}/whatsapp_credit_sharing_and_attach`,
      systemUserToken,
      {
        waba_id: input.wabaId,
        waba_currency: currency
      }
    );

    const allocationConfigId =
      pickStringField(getRecord(attachResponse.allocation_config), ["id"]) ??
      pickStringField(attachResponse, [
        "id",
        "allocation_config_id",
        "credit_allocation_config_id",
        "owning_credit_allocation_config_id"
      ]);
    let verification: Record<string, unknown> | null = null;
    if (allocationConfigId) {
      verification = await graphGet<Record<string, unknown>>(`/${allocationConfigId}`, systemUserToken, {
        fields: "receiving_credential{id},id,primary_funding_id"
      }).catch(() => null);
    }
    const attachedAt = new Date().toISOString();

    return {
      mode: "partner",
      status: "attached",
      ownerBusinessId,
      attachedAt,
      error: null,
      creditLineId,
      allocationConfigId,
      currency,
      metadata: {
        sharedBilling: {
          attachedAt,
          metaBusinessId: input.metaBusinessId,
          attachResponse,
          verification
        }
      }
    };
  } catch (error) {
    return {
      mode: "partner",
      status: "failed",
      ownerBusinessId,
      attachedAt: null,
      error: (error as Error).message,
      creditLineId: null,
      allocationConfigId: null,
      currency,
      metadata: {
        sharedBilling: {
          failedAt: new Date().toISOString(),
          metaBusinessId: input.metaBusinessId
        }
      }
    };
  }
}

async function graphGetWithFieldFallback(
  path: string,
  accessToken: string,
  fieldSets: string[]
): Promise<Record<string, unknown> | null> {
  for (const fields of fieldSets) {
    try {
      const response = await graphGet<Record<string, unknown>>(path, accessToken, { fields });
      if (response && typeof response === "object") {
        return response;
      }
    } catch {
      // Try next field-set variant.
    }
  }
  return null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function getStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const nested = getRecord(value);
  if (!nested) {
    return null;
  }
  for (const key of ["value", "status", "name", "rating", "level"]) {
    const nestedValue = getStringValue(nested[key]);
    if (nestedValue) {
      return nestedValue;
    }
  }
  return null;
}

function pickStringField(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = getStringValue(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function parseIsoMillis(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function shouldSyncMetaStatus(metadata: Record<string, unknown> | null, forceRefresh: boolean): boolean {
  if (forceRefresh) {
    return true;
  }
  const syncIntervalMs = Math.max(30, env.META_STATUS_SYNC_INTERVAL_SECONDS) * 1000;
  const root = metadata ?? {};
  const health = getRecord(root.metaHealth);
  const lastSyncedAt = health?.syncedAt ?? root.lastMetaSyncAt;
  const lastSyncMs = parseIsoMillis(lastSyncedAt);
  if (!lastSyncMs) {
    return true;
  }
  return Date.now() - lastSyncMs >= syncIntervalMs;
}

function deriveSubscriptionStatusFromMeta(current: string, snapshot: MetaStatusSnapshot): string {
  const signal = [
    snapshot.businessVerificationStatus,
    snapshot.wabaReviewStatus,
    snapshot.phoneStatus,
    snapshot.nameStatus,
    snapshot.codeVerificationStatus
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(revoked|rejected|disabled|blocked|banned|deactivated)/.test(signal)) {
    return "restricted";
  }
  if (snapshot.webhookAppSubscribed === false) {
    return "pending";
  }
  if (/(verified|approved|active|connected|ok|complete)/.test(signal)) {
    return "active";
  }
  return current || "unknown";
}

async function exchangeCodeForAccessToken(
  code: string,
  redirectUri?: string | null
): Promise<{ accessToken: string; expiresIn: number | null }> {
  ensureMetaCoreConfig();

  const query: Record<string, string> = {
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
    code
  };
  if (redirectUri !== null) {
    query.redirect_uri = getMetaRedirectUri(redirectUri ?? undefined);
  }

  const response = await fetch(
    buildGraphUrl("/oauth/access_token", query),
    { method: "GET" }
  );

  const json = await parseGraphResponse<{ access_token: string; expires_in?: number }>(response);
  return {
    accessToken: json.access_token,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : null
  };
}

async function exchangeForLongLivedAccessToken(shortLivedToken: string): Promise<{ accessToken: string; expiresIn: number | null }> {
  ensureMetaCoreConfig();

  const response = await fetch(
    buildGraphUrl("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      fb_exchange_token: shortLivedToken
    }),
    { method: "GET" }
  );

  const json = await parseGraphResponse<{ access_token: string; expires_in?: number }>(response);
  return {
    accessToken: json.access_token,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : null
  };
}

function pickFirstId<T extends { id?: string }>(rows: T[] | undefined): string | null {
  const id = rows?.find((item) => item.id)?.id;
  return id ?? null;
}

async function discoverMetaAssets(
  accessToken: string,
  input: {
    metaBusinessId?: string;
    wabaId?: string;
    phoneNumberId?: string;
    displayPhoneNumber?: string;
  }
): Promise<{
  metaBusinessId: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
}> {
  let metaBusinessId = input.metaBusinessId ?? null;
  let wabaId = input.wabaId ?? null;
  let phoneNumberId = input.phoneNumberId ?? null;
  let displayPhoneNumber = input.displayPhoneNumber ?? null;

  let candidateBusinesses: string[] = [];
  if (metaBusinessId) {
    candidateBusinesses.push(metaBusinessId);
  }

  if (!metaBusinessId || !wabaId) {
    try {
      const businesses = await graphGet<GraphListResponse<GraphBusiness>>("/me/businesses", accessToken, {
        fields: "id,name",
        limit: 25
      });
      const discovered = businesses.data?.map((item) => item.id).filter(Boolean) ?? [];
      candidateBusinesses = Array.from(new Set([...candidateBusinesses, ...discovered]));
      if (!metaBusinessId) {
        metaBusinessId = discovered[0] ?? null;
      }
    } catch {
      // Continue with explicitly provided IDs when discovery fails.
    }
  }

  if (!wabaId && candidateBusinesses.length > 0) {
    for (const businessId of candidateBusinesses) {
      try {
        const wabas = await graphGet<GraphListResponse<GraphWaba>>(
          `/${businessId}/owned_whatsapp_business_accounts`,
          accessToken,
          { fields: "id,name", limit: 25 }
        );
        const picked = pickFirstId(wabas.data);
        if (picked) {
          metaBusinessId = metaBusinessId ?? businessId;
          wabaId = picked;
          break;
        }
      } catch {
        // Try next business candidate.
      }
    }
  }

  if (wabaId && (!phoneNumberId || !displayPhoneNumber)) {
    try {
      const phones = await graphGet<GraphListResponse<GraphPhone>>(`/${wabaId}/phone_numbers`, accessToken, {
        fields: "id,display_phone_number,verified_name",
        limit: 25
      });
      const selected =
        phones.data?.find((phone) => phone.id === phoneNumberId) ||
        phones.data?.find((phone) => Boolean(phone.id)) ||
        null;
      if (selected) {
        phoneNumberId = phoneNumberId ?? selected.id ?? null;
        displayPhoneNumber = displayPhoneNumber ?? selected.display_phone_number ?? null;
      }
    } catch {
      // Keep provided values.
    }
  }

  return {
    metaBusinessId,
    wabaId,
    phoneNumberId,
    displayPhoneNumber
  };
}

async function ensureMetaConnectionWithinPlanLimit(userId: string, phoneNumberId: string): Promise<void> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id
     FROM whatsapp_business_connections
     WHERE user_id = $1
       AND phone_number_id = $2
     LIMIT 1`,
    [userId, phoneNumberId]
  );
  if ((existing.rowCount ?? 0) > 0) {
    return;
  }

  const entitlements = await getUserPlanEntitlements(userId);
  const activeCountResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM whatsapp_business_connections
     WHERE user_id = $1
       AND status <> 'disconnected'`,
    [userId]
  );
  const activeConnections = Number(activeCountResult.rows[0]?.total ?? 0);
  if (activeConnections < entitlements.maxApiNumbers) {
    return;
  }

  throw new Error(
    `Plan limit reached. Your ${entitlements.planCode} plan allows up to ${entitlements.maxApiNumbers} active API number(s).`
  );
}

async function upsertConnection(args: {
  userId: string;
  metaBusinessId: string | null;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  accessToken: string;
  expiresInSeconds: number | null;
  enabled?: boolean;
  subscriptionStatus?: string;
  status?: string;
  billingMode?: string;
  billingStatus?: string;
  billingOwnerBusinessId?: string | null;
  billingAttachedAt?: string | null;
  billingError?: string | null;
  billingCreditLineId?: string | null;
  billingAllocationConfigId?: string | null;
  billingCurrency?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<MetaConnection> {
  const linkedNumber = normalizePhoneDigits(args.displayPhoneNumber);
  const tokenExpiresAt =
    typeof args.expiresInSeconds === "number" && args.expiresInSeconds > 0
      ? new Date(Date.now() + args.expiresInSeconds * 1000).toISOString()
      : null;

  const result = await pool.query<MetaConnectionRow>(
    `INSERT INTO whatsapp_business_connections (
       user_id,
       meta_business_id,
       waba_id,
       phone_number_id,
       display_phone_number,
       linked_number,
       access_token_encrypted,
       token_expires_at,
       enabled,
       subscription_status,
       status,
       billing_mode,
       billing_status,
       billing_owner_business_id,
       billing_attached_at,
       billing_error,
       billing_credit_line_id,
       billing_allocation_config_id,
       billing_currency,
       metadata_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb)
     ON CONFLICT (phone_number_id)
     DO UPDATE SET
       meta_business_id = EXCLUDED.meta_business_id,
       waba_id = EXCLUDED.waba_id,
       display_phone_number = EXCLUDED.display_phone_number,
       linked_number = EXCLUDED.linked_number,
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       token_expires_at = EXCLUDED.token_expires_at,
       enabled = EXCLUDED.enabled,
       subscription_status = EXCLUDED.subscription_status,
       status = EXCLUDED.status,
       billing_mode = EXCLUDED.billing_mode,
       billing_status = EXCLUDED.billing_status,
       billing_owner_business_id = EXCLUDED.billing_owner_business_id,
       billing_attached_at = EXCLUDED.billing_attached_at,
       billing_error = EXCLUDED.billing_error,
       billing_credit_line_id = EXCLUDED.billing_credit_line_id,
       billing_allocation_config_id = EXCLUDED.billing_allocation_config_id,
       billing_currency = EXCLUDED.billing_currency,
       metadata_json = COALESCE(whatsapp_business_connections.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json
     WHERE whatsapp_business_connections.user_id = EXCLUDED.user_id
     RETURNING id,
               user_id,
               meta_business_id,
               waba_id,
               phone_number_id,
               display_phone_number,
               linked_number,
               access_token_encrypted,
               token_expires_at::text,
               enabled,
               subscription_status,
               status,
               billing_mode,
               billing_status,
               billing_owner_business_id,
               billing_attached_at::text,
               billing_error,
               billing_credit_line_id,
               billing_allocation_config_id,
               billing_currency,
               metadata_json,
               created_at::text,
               updated_at::text`,
    [
      args.userId,
      args.metaBusinessId,
      args.wabaId,
      args.phoneNumberId,
      args.displayPhoneNumber,
      linkedNumber,
      encryptToken(args.accessToken),
      tokenExpiresAt,
      args.enabled ?? true,
      args.subscriptionStatus ?? "pending",
      args.status ?? "pending",
      args.billingMode ?? "none",
      args.billingStatus ?? "unknown",
      args.billingOwnerBusinessId ?? null,
      args.billingAttachedAt ?? null,
      args.billingError ?? null,
      args.billingCreditLineId ?? null,
      args.billingAllocationConfigId ?? null,
      args.billingCurrency ?? null,
      JSON.stringify(args.metadata ?? {})
    ]
  );

  if (result.rows[0]) {
    return mapConnection(result.rows[0]);
  }

  const ownerCheck = await pool.query<{ user_id: string }>(
    `SELECT user_id
     FROM whatsapp_business_connections
     WHERE phone_number_id = $1
     LIMIT 1`,
    [args.phoneNumberId]
  );
  const existingOwner = ownerCheck.rows[0]?.user_id;
  if (existingOwner && existingOwner !== args.userId) {
    throw new Error("This WhatsApp API phone number is already connected to another account.");
  }

  throw new Error("Failed to save WhatsApp Business API connection.");
}

function deriveConnectionStatusFromSubscription(
  subscriptionStatus: string,
  currentStatus: string
): string {
  if (currentStatus === "disconnected") {
    return "disconnected";
  }
  if (subscriptionStatus === "active") {
    return "connected";
  }
  return "pending";
}

async function getConnectionRowByPhoneNumberId(
  phoneNumberId: string,
  options?: { includePending?: boolean }
): Promise<MetaConnectionRow | null> {
  const includePending = Boolean(options?.includePending);
  const result = await pool.query<MetaConnectionRow>(
    `SELECT id,
            user_id,
            meta_business_id,
            waba_id,
            phone_number_id,
            display_phone_number,
            linked_number,
            access_token_encrypted,
            token_expires_at::text,
            enabled,
            subscription_status,
            status,
            billing_mode,
            billing_status,
            billing_owner_business_id,
            billing_attached_at::text,
            billing_error,
            billing_credit_line_id,
            billing_allocation_config_id,
            billing_currency,
            metadata_json,
            created_at::text,
            updated_at::text
     FROM whatsapp_business_connections
     WHERE phone_number_id = $1
       AND (
         ($2::boolean = TRUE AND status <> 'disconnected')
         OR
         ($2::boolean = FALSE AND status = 'connected')
       )
     ORDER BY updated_at DESC
     LIMIT 1`,
    [phoneNumberId, includePending]
  );

  return result.rows[0] ?? null;
}

async function getLatestConnectionRowByUserId(userId: string): Promise<MetaConnectionRow | null> {
  const result = await pool.query<MetaConnectionRow>(
    `SELECT id,
            user_id,
            meta_business_id,
            waba_id,
            phone_number_id,
            display_phone_number,
            linked_number,
            access_token_encrypted,
            token_expires_at::text,
            enabled,
            subscription_status,
            status,
            billing_mode,
            billing_status,
            billing_owner_business_id,
            billing_attached_at::text,
            billing_error,
            billing_credit_line_id,
            billing_allocation_config_id,
            billing_currency,
            metadata_json,
            created_at::text,
            updated_at::text
     FROM whatsapp_business_connections
     WHERE user_id = $1
       AND status <> 'disconnected'
     ORDER BY CASE WHEN status = 'connected' THEN 0 ELSE 1 END,
              updated_at DESC
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] ?? null;
}

async function listConnectionRowsByUserId(
  userId: string,
  options?: { includeDisconnected?: boolean }
): Promise<MetaConnectionRow[]> {
  const includeDisconnected = Boolean(options?.includeDisconnected);
  const result = await pool.query<MetaConnectionRow>(
    `SELECT id,
            user_id,
            meta_business_id,
            waba_id,
            phone_number_id,
            display_phone_number,
            linked_number,
            access_token_encrypted,
            token_expires_at::text,
            enabled,
            subscription_status,
            status,
            billing_mode,
            billing_status,
            billing_owner_business_id,
            billing_attached_at::text,
            billing_error,
            billing_credit_line_id,
            billing_allocation_config_id,
            billing_currency,
            metadata_json,
            created_at::text,
            updated_at::text
     FROM whatsapp_business_connections
     WHERE user_id = $1
       AND ($2::boolean = TRUE OR status <> 'disconnected')
     ORDER BY
       CASE WHEN status = 'connected' THEN 0 WHEN status = 'pending' THEN 1 ELSE 2 END,
       updated_at DESC,
       created_at DESC`,
    [userId, includeDisconnected]
  );
  return result.rows;
}

async function getProfileTargetConnectionRow(userId: string, connectionId?: string): Promise<MetaConnectionRow | null> {
  if (connectionId) {
    const result = await pool.query<MetaConnectionRow>(
      `SELECT id,
              user_id,
              meta_business_id,
              waba_id,
              phone_number_id,
              display_phone_number,
              linked_number,
              access_token_encrypted,
              token_expires_at::text,
              enabled,
              subscription_status,
              status,
              billing_mode,
              billing_status,
              billing_owner_business_id,
              billing_attached_at::text,
              billing_error,
              billing_credit_line_id,
              billing_allocation_config_id,
              billing_currency,
              metadata_json,
              created_at::text,
              updated_at::text
       FROM whatsapp_business_connections
       WHERE user_id = $1
         AND id = $2
         AND status <> 'disconnected'
       LIMIT 1`,
      [userId, connectionId]
    );
    return result.rows[0] ?? null;
  }

  return getLatestConnectionRowByUserId(userId);
}

function mapMetaBusinessProfile(row: MetaConnectionRow, profile: GraphWhatsAppBusinessProfile | null): MetaBusinessProfile {
  return {
    connectionId: row.id,
    phoneNumberId: row.phone_number_id,
    displayPictureUrl: trimToNull(profile?.profile_picture_url),
    address: trimToNull(profile?.address),
    businessDescription: trimToNull(profile?.description),
    email: trimToNull(profile?.email),
    vertical: trimToNull(profile?.vertical),
    websites: parseStringArray(profile?.websites),
    about: trimToNull(profile?.about)
  };
}

async function getConnectionRowByUserAndLinkedNumber(
  userId: string,
  linkedNumber: string
): Promise<MetaConnectionRow | null> {
  const normalized = normalizePhoneDigits(linkedNumber);
  if (!normalized) {
    return null;
  }

  const result = await pool.query<MetaConnectionRow>(
    `SELECT id,
            user_id,
            meta_business_id,
            waba_id,
            phone_number_id,
            display_phone_number,
            linked_number,
            access_token_encrypted,
            token_expires_at::text,
            enabled,
            subscription_status,
            status,
            billing_mode,
            billing_status,
            billing_owner_business_id,
            billing_attached_at::text,
            billing_error,
            billing_credit_line_id,
            billing_allocation_config_id,
            billing_currency,
            metadata_json,
            created_at::text,
            updated_at::text
     FROM whatsapp_business_connections
     WHERE user_id = $1
       AND linked_number = $2
       AND status = 'connected'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId, normalized]
  );

  return result.rows[0] ?? null;
}

async function fetchMetaStatusSnapshot(row: MetaConnectionRow, accessToken: string): Promise<MetaStatusSnapshot> {
  const businessInfo = row.meta_business_id
    ? await graphGetWithFieldFallback(`/${row.meta_business_id}`, accessToken, [
        "id,name,verification_status,business_verification_status",
        "id,name,verification_status",
        "id,name"
      ])
    : null;

  const wabaInfo = await graphGetWithFieldFallback(`/${row.waba_id}`, accessToken, [
    "id,name,account_review_status,message_template_namespace,messaging_limit_tier",
    "id,name,account_review_status,messaging_limit_tier",
    "id,name,account_review_status",
    "id,name"
  ]);

  const phoneInfo = await graphGetWithFieldFallback(`/${row.phone_number_id}`, accessToken, [
    "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier,status",
    "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,status",
    "id,display_phone_number,verified_name,quality_rating,status",
    "id,display_phone_number,verified_name"
  ]);

  let phoneFromWaba: Record<string, unknown> | null = null;
  try {
    const phoneList = await graphGet<GraphListResponse<Record<string, unknown>>>(`/${row.waba_id}/phone_numbers`, accessToken, {
      fields:
        "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier,status",
      limit: 50
    });
    phoneFromWaba =
      phoneList.data?.find((phone) => pickStringField(phone, ["id"]) === row.phone_number_id) ??
      phoneList.data?.find((phone) => Boolean(pickStringField(phone, ["id"]))) ??
      null;
  } catch {
    // Fallback to direct phone object only.
  }

  const mergedPhone = {
    ...(phoneFromWaba ?? {}),
    ...(phoneInfo ?? {})
  };

  let webhookAppSubscribed: boolean | null = null;
  try {
    const subscribedApps = await graphGet<GraphListResponse<Record<string, unknown>>>(
      `/${row.waba_id}/subscribed_apps`,
      accessToken,
      { fields: "id,name", limit: 50 }
    );
    const apps = subscribedApps.data ?? [];
    const currentAppId = env.META_APP_ID?.trim() || null;
    if (currentAppId) {
      webhookAppSubscribed = apps.some((app) => {
        const nestedApiData = getRecord(app.whatsapp_business_api_data);
        const candidateAppId =
          pickStringField(app, ["id"]) ||
          pickStringField(nestedApiData, ["id"]);
        return candidateAppId === currentAppId;
      });
    } else {
      webhookAppSubscribed = apps.length > 0;
    }
  } catch {
    // Keep unknown state if this endpoint is temporarily unavailable.
  }

  return {
    businessVerificationStatus: pickStringField(businessInfo, [
      "business_verification_status",
      "verification_status",
      "verification",
      "status"
    ]),
    wabaReviewStatus: pickStringField(wabaInfo, [
      "account_review_status",
      "review_status",
      "status"
    ]),
    phoneQualityRating: pickStringField(mergedPhone, [
      "quality_rating",
      "quality_score",
      "quality"
    ]),
    messagingLimitTier: pickStringField(mergedPhone, [
      "messaging_limit_tier",
      "message_limit_tier"
    ]) ?? pickStringField(wabaInfo, ["messaging_limit_tier", "message_limit_tier"]),
    codeVerificationStatus: pickStringField(mergedPhone, [
      "code_verification_status",
      "verification_status"
    ]),
    nameStatus: pickStringField(mergedPhone, ["name_status"]),
    verifiedName: pickStringField(mergedPhone, ["verified_name", "name"]),
    phoneStatus: pickStringField(mergedPhone, ["status"]),
    webhookAppSubscribed,
    displayPhoneNumber: pickStringField(mergedPhone, ["display_phone_number"]),
    syncedAt: new Date().toISOString()
  };
}

async function persistMetaStatusSnapshot(
  row: MetaConnectionRow,
  snapshot: MetaStatusSnapshot,
  options?: { metadataPatch?: Record<string, unknown> }
): Promise<MetaConnectionRow> {
  const nextDisplayPhone = snapshot.displayPhoneNumber ?? row.display_phone_number;
  const nextLinkedNumber = normalizePhoneDigits(nextDisplayPhone) ?? row.linked_number;
  const nextSubscriptionStatus = deriveSubscriptionStatusFromMeta(row.subscription_status, snapshot);
  const nextConnectionStatus = deriveConnectionStatusFromSubscription(nextSubscriptionStatus, row.status);
  const metadataPatch: Record<string, unknown> = {
    metaHealth: snapshot,
    lastMetaSyncAt: snapshot.syncedAt,
    ...(options?.metadataPatch ?? {})
  };

  const result = await pool.query<MetaConnectionRow>(
    `UPDATE whatsapp_business_connections
     SET display_phone_number = $2,
         linked_number = $3,
         subscription_status = $4,
         status = $5,
         metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $6::jsonb
     WHERE id = $1
     RETURNING id,
               user_id,
               meta_business_id,
               waba_id,
               phone_number_id,
               display_phone_number,
               linked_number,
               access_token_encrypted,
               token_expires_at::text,
               enabled,
               subscription_status,
               status,
               billing_mode,
               billing_status,
               billing_owner_business_id,
               billing_attached_at::text,
               billing_error,
               billing_credit_line_id,
               billing_allocation_config_id,
               billing_currency,
               metadata_json,
               created_at::text,
               updated_at::text`,
    [row.id, nextDisplayPhone, nextLinkedNumber, nextSubscriptionStatus, nextConnectionStatus, JSON.stringify(metadataPatch)]
  );

  return result.rows[0] ?? row;
}

async function refreshConnectionStatusFromMeta(
  row: MetaConnectionRow,
  options?: { forceRefresh?: boolean }
): Promise<MetaConnectionRow> {
  if (!shouldSyncMetaStatus(row.metadata_json ?? null, Boolean(options?.forceRefresh))) {
    return row;
  }

  const accessToken = decryptToken(row.access_token_encrypted);
  let snapshot = await fetchMetaStatusSnapshot(row, accessToken);
  const metadataPatch: Record<string, unknown> = {};
  let registrationAttempt: PhoneRegistrationAttempt | null = null;

  // Auto-heal missing subscription on status refresh/reconnect.
  if (snapshot.webhookAppSubscribed === false) {
    const subscriptionAttempt = await subscribeAppToWabaWebhook(accessToken, row.waba_id);
    Object.assign(metadataPatch, buildWebhookSubscriptionMetadata(subscriptionAttempt, "status_refresh"));
    if (subscriptionAttempt.success) {
      snapshot = {
        ...snapshot,
        webhookAppSubscribed: true,
        syncedAt: new Date().toISOString()
      };
    } else {
      console.warn(
        `[MetaStatusSync] webhook subscribe retry failed user=${row.user_id} wabaId=${row.waba_id}: ${subscriptionAttempt.error ?? "unknown error"}`
      );
    }
  }

  const existingRegistration = getRecord((row.metadata_json ?? {}).registration);
  if (existingRegistration?.success !== true) {
    registrationAttempt = await registerPhoneNumberIfConfigured(accessToken, row.phone_number_id);
    Object.assign(metadataPatch, buildPhoneRegistrationMetadata(registrationAttempt, "status_refresh"));
    if (!registrationAttempt.success) {
      console.warn(
        `[MetaStatusSync] phone registration retry failed user=${row.user_id} phoneNumberId=${row.phone_number_id}: ${getPhoneRegistrationFailureMessage(registrationAttempt) ?? "unknown error"}`
      );
    }
  }

  if (row.billing_mode === "partner" && row.billing_status !== "attached") {
    const billingAttempt = await attachSharedBillingToWaba({
      metaBusinessId: row.meta_business_id,
      wabaId: row.waba_id
    });
    if (billingAttempt.metadata) {
      Object.assign(metadataPatch, billingAttempt.metadata);
    }
    if (billingAttempt.status === "attached") {
      const billingResult = await pool.query<MetaConnectionRow>(
        `UPDATE whatsapp_business_connections
         SET billing_status = $2,
             billing_owner_business_id = $3,
             billing_attached_at = $4::timestamptz,
             billing_error = NULL,
             billing_credit_line_id = COALESCE($5, billing_credit_line_id),
             billing_allocation_config_id = COALESCE($6, billing_allocation_config_id),
             billing_currency = COALESCE($7, billing_currency)
         WHERE id = $1
         RETURNING id,
                   user_id,
                   meta_business_id,
                   waba_id,
                   phone_number_id,
                   display_phone_number,
                   linked_number,
                   access_token_encrypted,
                   token_expires_at::text,
                   enabled,
                   subscription_status,
                   status,
                   billing_mode,
                   billing_status,
                   billing_owner_business_id,
                   billing_attached_at::text,
                   billing_error,
                   billing_credit_line_id,
                   billing_allocation_config_id,
                   billing_currency,
                   metadata_json,
                   created_at::text,
                   updated_at::text`,
        [
          row.id,
          billingAttempt.status,
          billingAttempt.ownerBusinessId,
          billingAttempt.attachedAt,
          billingAttempt.creditLineId,
          billingAttempt.allocationConfigId,
          billingAttempt.currency
        ]
      );
      row = billingResult.rows[0] ?? row;
    } else if (billingAttempt.status === "failed") {
      const billingResult = await pool.query<MetaConnectionRow>(
        `UPDATE whatsapp_business_connections
         SET billing_error = $2,
             billing_currency = COALESCE($3, billing_currency)
         WHERE id = $1
         RETURNING id,
                   user_id,
                   meta_business_id,
                   waba_id,
                   phone_number_id,
                   display_phone_number,
                   linked_number,
                   access_token_encrypted,
                   token_expires_at::text,
                   enabled,
                   subscription_status,
                   status,
                   billing_mode,
                   billing_status,
                   billing_owner_business_id,
                   billing_attached_at::text,
                   billing_error,
                   billing_credit_line_id,
                   billing_allocation_config_id,
                   billing_currency,
                   metadata_json,
                   created_at::text,
                   updated_at::text`,
        [row.id, billingAttempt.error, billingAttempt.currency]
      );
      row = billingResult.rows[0] ?? row;
    }
  }

  const persisted = await persistMetaStatusSnapshot(row, snapshot, {
    metadataPatch: Object.keys(metadataPatch).length > 0 ? metadataPatch : undefined
  });
  if (registrationAttempt && !registrationAttempt.success) {
    const pendingResult = await pool.query<MetaConnectionRow>(
      `UPDATE whatsapp_business_connections
       SET status = 'pending',
           subscription_status = 'pending'
       WHERE id = $1
       RETURNING id,
                 user_id,
                 meta_business_id,
                 waba_id,
                 phone_number_id,
                 display_phone_number,
                 linked_number,
                 access_token_encrypted,
                 token_expires_at::text,
                 enabled,
                 subscription_status,
                 status,
                 billing_mode,
                 billing_status,
                 billing_owner_business_id,
                 billing_attached_at::text,
                 billing_error,
                 billing_credit_line_id,
                 billing_allocation_config_id,
                 billing_currency,
                 metadata_json,
                 created_at::text,
                 updated_at::text`,
      [persisted.id]
    );
    return pendingResult.rows[0] ?? persisted;
  }

  return persisted;
}

export function getMetaBusinessConfig() {
  const sharedBillingConfigured = isSharedBillingConfigured();
  return {
    configured: Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_EMBEDDED_SIGNUP_CONFIG_ID),
    appId: env.META_APP_ID ?? null,
    embeddedSignupConfigId: env.META_EMBEDDED_SIGNUP_CONFIG_ID ?? null,
    redirectUri: getMetaRedirectUri(),
    graphVersion: env.META_GRAPH_VERSION,
    webhookPath: "/meta-webhook",
    sharedBillingSupported: sharedBillingConfigured,
    sharedBillingRequired: env.META_SHARED_BILLING_REQUIRED,
    sharedBillingCurrency: sharedBillingConfigured ? getSharedBillingCurrency() : null,
    partnerBusinessId: sharedBillingConfigured ? env.META_PARTNER_BUSINESS_ID ?? null : null,
    pricing: {
      platformFeeInrMonthly: 249,
      metaConversationChargesSeparate: true
    }
  };
}

export async function getMetaBusinessStatus(
  userId: string,
  options?: { forceRefresh?: boolean }
): Promise<MetaBusinessStatus> {
  const rows = await listConnectionRowsByUserId(userId, { includeDisconnected: true });
  const refreshedRows: MetaConnectionRow[] = [];

  for (const row of rows) {
    if (row.status !== "connected" && row.status !== "pending") {
      refreshedRows.push(row);
      continue;
    }
    try {
      refreshedRows.push(
        await refreshConnectionStatusFromMeta(row, {
          forceRefresh: options?.forceRefresh ?? true
        })
      );
    } catch (error) {
      console.warn(
        `[MetaStatusSync] unable to refresh user=${userId} phoneNumberId=${row.phone_number_id}: ${(error as Error).message}`
      );
      refreshedRows.push(row);
    }
  }

  const currentRow =
    refreshedRows.find((row) => row.status !== "disconnected") ??
    null;

  return {
    connected: refreshedRows.some((row) => row.status === "connected"),
    enabled: refreshedRows.some((row) => row.status === "connected" && row.enabled),
    connection: currentRow ? mapConnection(currentRow) : null,
    connections: refreshedRows.map(mapConnection)
  };
}

export async function listMetaBusinessConnections(
  userId: string,
  options?: { forceRefresh?: boolean; includeDisconnected?: boolean }
): Promise<MetaConnection[]> {
  const status = await getMetaBusinessStatus(userId, { forceRefresh: options?.forceRefresh });
  return options?.includeDisconnected
    ? status.connections
    : status.connections.filter((connection) => connection.status !== "disconnected");
}

export async function requireMetaConnection(
  userId: string,
  connectionId: string,
  options?: { requireActive?: boolean; allowDisconnected?: boolean }
): Promise<MetaConnection> {
  const row = await getProfileTargetConnectionRow(userId, connectionId);
  if (!row || row.id !== connectionId) {
    throw new Error("WhatsApp API connection not found.");
  }

  if (!options?.allowDisconnected && row.status === "disconnected") {
    throw new Error("WhatsApp API connection has been deleted.");
  }

  const mapped = mapConnection(row);
  if (options?.requireActive && (mapped.status !== "connected" || !mapped.enabled)) {
    throw new Error("Selected WhatsApp API connection is not active.");
  }

  return mapped;
}

export async function getMetaBusinessProfile(userId: string, connectionId?: string): Promise<MetaBusinessProfile> {
  const row = await getProfileTargetConnectionRow(userId, connectionId);
  if (!row) {
    throw new Error("No connected WhatsApp Business API number found.");
  }

  const accessToken = decryptToken(row.access_token_encrypted);
  const response = await graphGet<GraphListResponse<GraphWhatsAppBusinessProfile>>(
    `/${row.phone_number_id}/whatsapp_business_profile`,
    accessToken,
    {
      fields: "about,address,description,email,profile_picture_url,websites,vertical"
    }
  );

  return mapMetaBusinessProfile(row, response.data?.[0] ?? null);
}

export async function updateMetaBusinessProfile(input: {
  userId: string;
  connectionId?: string;
  address?: string | null;
  businessDescription?: string | null;
  email?: string | null;
  vertical?: string | null;
  websiteUrl?: string | null;
  about?: string | null;
  profilePictureHandle?: string | null;
}): Promise<MetaBusinessProfile> {
  const row = await getProfileTargetConnectionRow(input.userId, input.connectionId);
  if (!row) {
    throw new Error("No connected WhatsApp Business API number found.");
  }

  const accessToken = decryptToken(row.access_token_encrypted);
  const websites = trimToNull(input.websiteUrl) ? [trimToNull(input.websiteUrl)!] : [];
  await graphPostForm<{ success?: boolean }>(
    `/${row.phone_number_id}/whatsapp_business_profile`,
    accessToken,
    {
      messaging_product: "whatsapp",
      address: trimToNull(input.address) ?? undefined,
      description: trimToNull(input.businessDescription) ?? undefined,
      email: trimToNull(input.email) ?? undefined,
      vertical: trimToNull(input.vertical) ?? undefined,
      websites: websites.length > 0 ? JSON.stringify(websites) : undefined,
      about: trimToNull(input.about) ?? undefined,
      profile_picture_handle: trimToNull(input.profilePictureHandle) ?? undefined
    }
  );

  return getMetaBusinessProfile(input.userId, row.id);
}

export async function uploadMetaBusinessProfileLogo(input: {
  userId: string;
  connectionId?: string;
  fileBuffer: Buffer;
  mimeType: string;
  fileName?: string | null;
}): Promise<{ connectionId: string; phoneNumberId: string; handle: string }> {
  if (!env.META_APP_ID?.trim()) {
    throw new Error("Meta app configuration is missing. Set META_APP_ID before uploading a logo.");
  }

  const row = await getProfileTargetConnectionRow(input.userId, input.connectionId);
  if (!row) {
    throw new Error("No connected WhatsApp Business API number found.");
  }

  const accessToken = decryptToken(row.access_token_encrypted);
  const uploadSession = await graphStartUploadSession(env.META_APP_ID.trim(), accessToken, {
    fileName: trimToNull(input.fileName) ?? `profile-logo.${input.mimeType.split("/")[1] ?? "png"}`,
    fileLength: input.fileBuffer.byteLength,
    fileType: input.mimeType
  });
  const result = await graphUploadFileHandle(uploadSession.id, accessToken, input.fileBuffer, input.mimeType);

  return {
    connectionId: row.id,
    phoneNumberId: row.phone_number_id,
    handle: result.h
  };
}

export async function completeMetaEmbeddedSignup(
  userId: string,
  input: CompleteEmbeddedSignupInput
): Promise<MetaConnection> {
  if (!input.code?.trim()) {
    throw new Error("Meta authorization code is required.");
  }

  ensureMetaCoreConfig();
  if (!env.META_EMBEDDED_SIGNUP_CONFIG_ID) {
    throw new Error("META_EMBEDDED_SIGNUP_CONFIG_ID is not configured.");
  }

  const rawCode = input.code.trim();
  const candidateRedirects: Array<string | null> = [];
  const pushCandidate = (value?: string | null) => {
    if (value === null) {
      if (!candidateRedirects.includes(null)) {
        candidateRedirects.push(null);
      }
      return;
    }
    const trimmed = value?.trim();
    if (!trimmed || candidateRedirects.includes(trimmed)) {
      return;
    }
    candidateRedirects.push(trimmed);
  };

  pushCandidate(input.redirectUri);
  pushCandidate(env.META_REDIRECT_URI);

  const deriveDashboardUri = (baseUri: string | undefined | null): string | null => {
    if (!baseUri) {
      return null;
    }
    try {
      const origin = new URL(baseUri).origin;
      return `${origin}/dashboard`;
    } catch {
      return null;
    }
  };
  const deriveCallbackUri = (baseUri: string | undefined | null): string | null => {
    if (!baseUri) {
      return null;
    }
    try {
      const origin = new URL(baseUri).origin;
      return `${origin}/meta-callback`;
    } catch {
      return null;
    }
  };

  pushCandidate(deriveDashboardUri(input.redirectUri));
  pushCandidate(deriveCallbackUri(input.redirectUri));
  pushCandidate(`${env.APP_BASE_URL.replace(/\/$/, "")}/dashboard`);
  pushCandidate(`${env.APP_BASE_URL.replace(/\/$/, "")}/meta-callback`);
  // Some popup flows do not send redirect_uri in token exchange.
  pushCandidate(null);

  let shortLived: { accessToken: string; expiresIn: number | null } | null = null;
  const errors: string[] = [];
  for (const redirectCandidate of candidateRedirects) {
    try {
      shortLived = await exchangeCodeForAccessToken(rawCode, redirectCandidate);
      break;
    } catch (error) {
      const label = redirectCandidate === null ? "(omitted)" : redirectCandidate;
      errors.push(`${label}: ${(error as Error).message}`);
    }
  }

  if (!shortLived) {
    throw new Error(
      `Failed to exchange Meta authorization code. Tried redirect_uri variants: ${errors.join(" | ")}`
    );
  }
  let resolvedToken = shortLived.accessToken;
  let resolvedExpiry = shortLived.expiresIn;

  try {
    const longLived = await exchangeForLongLivedAccessToken(shortLived.accessToken);
    if (longLived.accessToken) {
      resolvedToken = longLived.accessToken;
      resolvedExpiry = longLived.expiresIn;
    }
  } catch {
    // Keep short-lived token if long-lived exchange is unavailable.
  }

  const discovered = await discoverMetaAssets(resolvedToken, {
    metaBusinessId: input.metaBusinessId,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    displayPhoneNumber: input.displayPhoneNumber
  });

  if (!discovered.wabaId || !discovered.phoneNumberId) {
    throw new Error(
      "Could not resolve WhatsApp Business Account and phone number. Complete Embedded Signup in Meta and try again."
    );
  }

  await ensureMetaConnectionWithinPlanLimit(userId, discovered.phoneNumberId);

  // If reconnecting, detach any previously attached partner credit line so the
  // user's Meta account is free to manage its own payment method.
  const existingRow = await getConnectionRowByPhoneNumberId(discovered.phoneNumberId, { includePending: true });
  if (existingRow?.billing_allocation_config_id) {
    await detachSharedBillingFromWaba(existingRow.billing_allocation_config_id);
  }

  const registration = await registerPhoneNumberIfConfigured(resolvedToken, discovered.phoneNumberId);
  const webhookSubscription = await subscribeAppToWabaWebhook(resolvedToken, discovered.wabaId);
  if (!webhookSubscription.success) {
    console.warn(
      `[MetaConnect] webhook subscribe failed user=${userId} wabaId=${discovered.wabaId}: ${webhookSubscription.error ?? "unknown error"}`
    );
  }
  const isConnected = registration.success && webhookSubscription.success;
  const connection = await upsertConnection({
    userId,
    metaBusinessId: discovered.metaBusinessId,
    wabaId: discovered.wabaId,
    phoneNumberId: discovered.phoneNumberId,
    displayPhoneNumber: discovered.displayPhoneNumber,
    accessToken: resolvedToken,
    expiresInSeconds: resolvedExpiry,
    enabled: true,
    subscriptionStatus: isConnected ? "active" : "pending",
    status: isConnected ? "connected" : "pending",
    billingMode: "none",
    billingStatus: "not_configured",
    billingOwnerBusinessId: null,
    billingAttachedAt: null,
    billingError: null,
    billingCreditLineId: null,
    billingAllocationConfigId: null,
    billingCurrency: null,
    metadata: {
      source: "embedded_signup",
      connectedAt: new Date().toISOString(),
      ...buildWebhookSubscriptionMetadata(webhookSubscription, "embedded_signup"),
      ...buildPhoneRegistrationMetadata(registration, "embedded_signup")
    }
  });

  const row = await getConnectionRowByPhoneNumberId(connection.phoneNumberId, { includePending: true });
  if (!row) {
    return connection;
  }
  let syncedConnection: MetaConnection | null = null;
  let initialSyncError: string | null = null;
  try {
    const synced = await refreshConnectionStatusFromMeta(row, { forceRefresh: true });
    syncedConnection = mapConnection(synced);
  } catch (error) {
    initialSyncError = (error as Error).message;
    console.warn(
      `[MetaStatusSync] initial sync failed user=${userId} phoneNumberId=${connection.phoneNumberId}: ${initialSyncError}`
    );
  }

  const effectiveConnection = syncedConnection ?? connection;
  const registrationFailureMessage = getPhoneRegistrationFailureMessage(registration);
  if (registrationFailureMessage) {
    throw new Error(registrationFailureMessage);
  }

  if (effectiveConnection.status !== "connected") {
    if (!webhookSubscription.success) {
      throw new Error(
        `Webhook subscription failed for this number: ${webhookSubscription.error ?? "unknown error"}. Please reconnect.`
      );
    }
    if (initialSyncError) {
      throw new Error(
        `Meta setup completed but status sync failed: ${initialSyncError}. Please click Refresh status in Settings.`
      );
    }
  }

  return effectiveConnection;
}

async function listDisconnectTargetConnections(userId: string, connectionId?: string): Promise<MetaConnectionRow[]> {
  const result = await pool.query<MetaConnectionRow>(
    `SELECT id,
            user_id,
            meta_business_id,
            waba_id,
            phone_number_id,
            display_phone_number,
            linked_number,
            access_token_encrypted,
            token_expires_at::text,
            enabled,
            subscription_status,
            status,
            billing_mode,
            billing_status,
            billing_owner_business_id,
            billing_attached_at::text,
            billing_error,
            billing_credit_line_id,
            billing_allocation_config_id,
            billing_currency,
            metadata_json,
            created_at::text,
            updated_at::text
     FROM whatsapp_business_connections
     WHERE user_id = $1
       AND ($2::uuid IS NULL OR id = $2::uuid)`,
    [userId, connectionId ?? null]
  );
  return result.rows;
}

async function listConnectionsByWabaIds(userId: string, wabaIds: string[]): Promise<MetaConnectionRow[]> {
  if (wabaIds.length === 0) {
    return [];
  }

  const result = await pool.query<MetaConnectionRow>(
    `SELECT id,
            user_id,
            meta_business_id,
            waba_id,
            phone_number_id,
            display_phone_number,
            linked_number,
            access_token_encrypted,
            token_expires_at::text,
            enabled,
            subscription_status,
            status,
            billing_mode,
            billing_status,
            billing_owner_business_id,
            billing_attached_at::text,
            billing_error,
            billing_credit_line_id,
            billing_allocation_config_id,
            billing_currency,
            metadata_json,
            created_at::text,
            updated_at::text
     FROM whatsapp_business_connections
     WHERE user_id = $1
       AND waba_id = ANY($2::text[])`,
    [userId, wabaIds]
  );
  return result.rows;
}

async function unsubscribeWebhookSubscription(row: MetaConnectionRow): Promise<void> {
  const accessToken = decryptToken(row.access_token_encrypted);
  await graphDelete<{ success?: boolean }>(`/${row.waba_id}/subscribed_apps`, accessToken);
}

async function revokeMetaAccess(row: MetaConnectionRow): Promise<void> {
  const accessToken = decryptToken(row.access_token_encrypted);
  await graphDelete<{ success?: boolean }>("/me/permissions", accessToken);
}

export async function disconnectMetaBusinessConnection(
  userId: string,
  connectionId?: string,
  options?: { purgeConnectionData?: boolean }
): Promise<boolean> {
  const requestedRows = await listDisconnectTargetConnections(userId, connectionId);
  if (requestedRows.length === 0) {
    return false;
  }

  const targetWabaIds = Array.from(new Set(requestedRows.map((row) => row.waba_id).filter(Boolean)));
  const rows = connectionId
    ? await listConnectionsByWabaIds(userId, targetWabaIds)
    : requestedRows;
  if (rows.length === 0) {
    return false;
  }

  const unsubRowsByWaba = new Map<string, MetaConnectionRow>();
  const revokeRowsByToken = new Map<string, MetaConnectionRow>();
  for (const row of rows) {
    if (!unsubRowsByWaba.has(row.waba_id)) {
      unsubRowsByWaba.set(row.waba_id, row);
    }
    if (!revokeRowsByToken.has(row.access_token_encrypted)) {
      revokeRowsByToken.set(row.access_token_encrypted, row);
    }
  }

  // Best-effort remote cleanup before local deletion.
  for (const row of unsubRowsByWaba.values()) {
    try {
      await unsubscribeWebhookSubscription(row);
    } catch (error) {
      console.warn(
        `[MetaDisconnect] webhook unsubscribe failed user=${userId} wabaId=${row.waba_id}: ${(error as Error).message}`
      );
    }
  }

  for (const row of revokeRowsByToken.values()) {
    try {
      await revokeMetaAccess(row);
    } catch (error) {
      console.warn(
        `[MetaDisconnect] token revoke failed user=${userId} phoneNumberId=${row.phone_number_id}: ${(error as Error).message}`
      );
    }
  }

  const targetConnectionIds = Array.from(new Set(rows.map((row) => row.id).filter(Boolean)));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (targetConnectionIds.length > 0) {
      await client.query(
        `UPDATE message_delivery_alerts
         SET status = 'resolved',
             resolved_at = NOW(),
             updated_at = NOW()
         WHERE user_id = $1
           AND status = 'open'
           AND connection_id = ANY($2::uuid[])`,
        [userId, targetConnectionIds]
      );
    }

    if (connectionId) {
      await client.query(
        `UPDATE whatsapp_business_connections
         SET status = 'disconnected',
             enabled = FALSE,
             subscription_status = 'inactive',
             updated_at = NOW(),
             metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object(
               'disconnectedAt', NOW(),
               'disconnectedBy', 'user_reconnect'
             )
         WHERE user_id = $1
           AND waba_id = ANY($2::text[])`,
        [userId, targetWabaIds]
      );
    } else {
      await client.query(
        `UPDATE whatsapp_business_connections
         SET status = 'disconnected',
             enabled = FALSE,
             subscription_status = 'inactive',
             updated_at = NOW(),
             metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object(
               'disconnectedAt', NOW(),
               'disconnectedBy', 'user_disconnect'
             )
         WHERE user_id = $1`,
        [userId]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return true;
}

export async function setMetaBusinessChannelEnabled(
  userId: string,
  enabled: boolean,
  connectionId?: string
): Promise<MetaConnection | null> {
  const target = await getProfileTargetConnectionRow(userId, connectionId);
  if (!target) {
    return null;
  }

  const result = await pool.query<MetaConnectionRow>(
    `UPDATE whatsapp_business_connections
     SET enabled = $2
     WHERE id = $1
     RETURNING id,
               user_id,
               meta_business_id,
               waba_id,
               phone_number_id,
               display_phone_number,
               linked_number,
               access_token_encrypted,
               token_expires_at::text,
               enabled,
               subscription_status,
               status,
               billing_mode,
               billing_status,
               billing_owner_business_id,
               billing_attached_at::text,
               billing_error,
               billing_credit_line_id,
               billing_allocation_config_id,
               billing_currency,
               metadata_json,
               created_at::text,
               updated_at::text`,
    [target.id, enabled]
  );

  return result.rows[0] ? mapConnection(result.rows[0]) : null;
}

export async function sendMetaTextMessage(input: {
  userId: string;
  to: string;
  text: string;
  phoneNumberId?: string;
  webhookUrl?: string | null;
}): Promise<{ messageId: string | null; connection: MetaConnection }> {
  const normalizedTo = input.to.replace(/\D/g, "");
  const [contact, suppressionMap] = await Promise.all([
    getContactByPhoneForUser(input.userId, normalizedTo),
    findSuppressedRecipients(input.userId, [normalizedTo])
  ]);
  const suppression = suppressionMap.get(normalizedTo) ?? null;
  const hardBlocks = evaluateHardBlocks({
    category: "UTILITY",
    suppression,
    globalOptOut: !!contact?.global_opt_out_at,
    marketingEnabled: true
  });
  if (hardBlocks.codes.length > 0) {
    throw new Error(`Message blocked: ${hardBlocks.codes.join(", ")}`);
  }

  const sent = await sendMetaTextDirect(input);
  const conversation = await getOrCreateConversation(input.userId, sent.to, {
    channelType: "api",
    channelLinkedNumber: sent.connection.linkedNumber
  });
  await trackOutboundMessage(conversation.id, sent.text, { webhookUrl: input.webhookUrl ?? null }, null, null, sent.messageId ?? null);

  return {
    messageId: sent.messageId,
    connection: sent.connection
  };
}

async function resolveMetaSendConnectionRow(input: {
  userId: string;
  phoneNumberId?: string;
  linkedNumber?: string | null;
}): Promise<MetaConnectionRow> {
  const row =
    (input.phoneNumberId
      ? await getConnectionRowByPhoneNumberId(input.phoneNumberId)
      : null) ??
    (input.linkedNumber
      ? await getConnectionRowByUserAndLinkedNumber(input.userId, input.linkedNumber)
      : null) ??
    (await getLatestConnectionRowByUserId(input.userId));

  if (!row || row.user_id !== input.userId) {
    throw new Error("No connected WhatsApp Business API number found.");
  }

  let resolvedRow = row;
  const savedRegistration = getRecord((resolvedRow.metadata_json ?? {}).registration);
  if (
    resolvedRow.subscription_status !== "active" ||
    resolvedRow.status !== "connected" ||
    savedRegistration?.success !== true
  ) {
    try {
      resolvedRow = await refreshConnectionStatusFromMeta(resolvedRow, { forceRefresh: true });
    } catch (error) {
      console.warn(
        `[MetaSend] pre-send status refresh failed user=${input.userId} phoneNumberId=${resolvedRow.phone_number_id}: ${(error as Error).message}`
      );
    }
  }

  if (resolvedRow.subscription_status !== "active" || resolvedRow.status !== "connected") {
    const registration = getRecord((resolvedRow.metadata_json ?? {}).registration);
    if (registration?.success === false) {
      const reason = typeof registration.reason === "string" ? registration.reason : "failed";
      const error = typeof registration.error === "string" ? registration.error : null;
      throw new Error(
        reason === "missing_pin"
          ? "WhatsApp API number is not registered. Set META_PHONE_REGISTRATION_PIN in API env, then reconnect or refresh this number."
          : `WhatsApp API number is not registered with Meta yet${error ? `: ${error}` : "."}`
      );
    }
    throw new Error("WhatsApp API number is still pending Meta registration. Refresh status or reconnect this number before sending.");
  }

  return resolvedRow;
}

function truncateMetaText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function isDataUrl(value: string): boolean {
  return /^data:/i.test(value.trim());
}

function decodeDataUrl(value: string): { buffer: Buffer; mimeType: string } | null {
  const match = value.trim().match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) {
    return null;
  }
  const mimeType = match[1]?.trim() || "application/octet-stream";
  try {
    return {
      buffer: Buffer.from(match[2]!, "base64"),
      mimeType
    };
  } catch {
    return null;
  }
}

async function fetchMediaBufferFromUrl(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type") ?? "application/octet-stream"
    };
  } catch {
    return null;
  }
}

async function resolveMetaMediaReference(
  phoneNumberId: string,
  accessToken: string,
  url: string
): Promise<{ link?: string; id?: string }> {
  const trimmed = url.trim();
  const dataUrl = decodeDataUrl(trimmed);
  if (dataUrl) {
    const uploaded = await graphPostMedia(phoneNumberId, accessToken, dataUrl.buffer, dataUrl.mimeType);
    return { id: uploaded.id };
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return { link: trimmed };
  }

  // Preserve standard public URLs by default; if the fetch fails or the URL is
  // private we still have the option to upload it by ID in the future.
  if (!isDataUrl(trimmed) && !trimmed.includes("/api/media/")) {
    return { link: trimmed };
  }

  const downloaded = await fetchMediaBufferFromUrl(trimmed);
  if (!downloaded) {
    return { link: trimmed };
  }

  const uploaded = await graphPostMedia(phoneNumberId, accessToken, downloaded.buffer, downloaded.mimeType);
  return { id: uploaded.id };
}

async function buildMetaFlowRequestBody(
  to: string,
  payload: FlowMessagePayload,
  context: { phoneNumberId: string; accessToken: string }
): Promise<Record<string, unknown>> {
  switch (payload.type) {
    case "text":
      return {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: payload.text.trim()
        }
      };

    case "reaction":
      return {
        messaging_product: "whatsapp",
        to,
        type: "reaction",
        reaction: {
          message_id: payload.messageId.trim(),
          emoji: payload.emoji.trim()
        }
      };

    case "media": {
      const reference = await resolveMetaMediaReference(context.phoneNumberId, context.accessToken, payload.url);
      return {
        messaging_product: "whatsapp",
        to,
        type: payload.mediaType,
        [payload.mediaType]: {
          ...("id" in reference && reference.id ? { id: reference.id } : { link: reference.link ?? payload.url.trim() }),
          ...(payload.caption?.trim()
            ? {
                caption: truncateMetaText(payload.caption, 1024)
              }
            : {})
        }
      };
    }

    case "text_buttons":
      return {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text: truncateMetaText(payload.text || "Please choose an option.", 1024)
          },
          ...(payload.footer?.trim()
            ? {
                footer: {
                  text: truncateMetaText(payload.footer, 60)
                }
              }
            : {}),
          action: {
            buttons: payload.buttons.slice(0, 3).map((button) => ({
              type: "reply",
              reply: {
                id: button.id.trim().slice(0, 256),
                title: truncateMetaText(button.label || "Option", 20)
              }
            }))
          }
        }
      };

    case "media_buttons": {
      const reference = await resolveMetaMediaReference(context.phoneNumberId, context.accessToken, payload.url);
      return {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          header: {
            type: payload.mediaType,
            [payload.mediaType]: {
              ...("id" in reference && reference.id ? { id: reference.id } : { link: reference.link ?? payload.url.trim() })
            }
          },
          body: {
            text: truncateMetaText(payload.caption || "Please choose an option.", 1024)
          },
          action: {
            buttons: payload.buttons.slice(0, 3).map((button) => ({
              type: "reply",
              reply: {
                id: button.id.trim().slice(0, 256),
                title: truncateMetaText(button.label || "Option", 20)
              }
            }))
          }
        }
      };
    }

    case "list":
      let remainingRows = 10;
      return {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: {
            text: truncateMetaText(payload.text || "Please choose an option.", 1024)
          },
          action: {
            button: truncateMetaText(payload.buttonLabel || "View options", 20),
            sections: payload.sections
              .map((section) => {
                const rows = section.rows
                  .slice(0, remainingRows)
                  .map((row) => ({
                    id: row.id.trim().slice(0, 200),
                    title: truncateMetaText(row.title || "Option", 24),
                    ...(row.description?.trim()
                      ? {
                          description: truncateMetaText(row.description, 72)
                        }
                      : {})
                  }));
                remainingRows -= rows.length;
                return {
                  title: truncateMetaText(section.title || "Options", 24),
                  rows
                };
              })
              .filter((section) => section.rows.length > 0)
          }
        }
      };

    case "template":
      return {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: payload.templateName.trim(),
          language: {
            code: payload.language.trim() || "en"
          },
          ...(payload.components && payload.components.length > 0
            ? { components: payload.components }
            : {})
        }
      };

    case "product":
      return {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "product",
          ...(payload.bodyText?.trim()
            ? {
                body: {
                  text: truncateMetaText(payload.bodyText, 1024)
                }
              }
            : {}),
          action: {
            catalog_id: payload.catalogId.trim(),
            product_retailer_id: payload.productId.trim()
          }
        }
      };

    case "product_list":
      let remainingProducts = 30;
      return {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "product_list",
          ...(payload.bodyText?.trim()
            ? {
                body: {
                  text: truncateMetaText(payload.bodyText, 1024)
                }
              }
            : {}),
          action: {
            catalog_id: payload.catalogId.trim(),
            sections: payload.sections
              .map((section) => {
                const productItems = section.productIds
                  .slice(0, remainingProducts)
                  .map((productId) => ({
                    product_retailer_id: productId.trim()
                  }))
                  .filter((item) => item.product_retailer_id);
                remainingProducts -= productItems.length;
                return {
                  title: truncateMetaText(section.title || "Products", 24),
                  product_items: productItems
                };
              })
              .filter((section) => section.product_items.length > 0)
          }
        }
      };

    case "location_share":
      return {
        messaging_product: "whatsapp",
        to,
        type: "location",
        location: {
          latitude: payload.latitude,
          longitude: payload.longitude,
          ...(payload.name?.trim() ? { name: payload.name.trim() } : {}),
          ...(payload.address?.trim() ? { address: payload.address.trim() } : {})
        }
      };

    case "contact_share": {
      return {
        messaging_product: "whatsapp",
        to,
        type: "contacts",
        contacts: [
          {
            name: { formatted_name: payload.name.trim(), first_name: payload.name.trim() },
            phones: [{ phone: payload.phone.trim(), type: "CELL", wa_id: payload.phone.replace(/\D/g, "") }],
            ...(payload.org?.trim() ? { org: { company: payload.org.trim() } } : {})
          }
        ]
      };
    }

    case "poll":
      // Meta WA API doesn't support native polls — send as text fallback
      return {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: truncateMetaText(
            `${payload.question.trim()}\n\n${payload.options.map((opt, i) => `${i + 1}. ${opt}`).join("\n")}`,
            4096
          )
        }
      };
  }
}

function buildMetaTemplateRequestBody(input: {
  to: string;
  templateName: string;
  language: string;
  components?: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    to: input.to,
    type: "template",
    template: {
      name: input.templateName.trim(),
      language: {
        code: input.language.trim() || "en"
      },
      ...(input.components && input.components.length > 0
        ? { components: input.components }
        : {})
    }
  };
}

export async function sendMetaTextDirect(input: {
  userId: string;
  to: string;
  text: string;
  phoneNumberId?: string;
  linkedNumber?: string | null;
}): Promise<{ messageId: string | null; connection: MetaConnection; to: string; text: string }> {
  const normalizedTo = normalizePhoneDigits(input.to);
  if (!normalizedTo) {
    throw new Error("Recipient phone must contain 8 to 15 digits.");
  }
  const text = input.text.trim();
  if (!text) {
    throw new Error("Message text is required.");
  }

  const resolvedRow = await resolveMetaSendConnectionRow(input);
  const accessToken = decryptToken(resolvedRow.access_token_encrypted);
  const response = await graphPost<{ messages?: Array<{ id?: string }> }>(
    `/${resolvedRow.phone_number_id}/messages`,
    accessToken,
    {
      messaging_product: "whatsapp",
      to: normalizedTo,
      type: "text",
      text: {
        body: text
      }
    }
  );

  const messageId = response.messages?.[0]?.id ?? null;
  void fanoutEvent(input.userId, "messages.update", {
    remoteJid: normalizedTo,
    status: "sent",
    messageId
  });

  return {
    messageId,
    connection: mapConnection(resolvedRow),
    to: normalizedTo,
    text
  };
}

export async function sendMetaTemplateDirect(input: {
  userId: string;
  to: string;
  templateName: string;
  language: string;
  components?: Array<Record<string, unknown>>;
  phoneNumberId?: string;
  linkedNumber?: string | null;
}): Promise<{ messageId: string | null; connection: MetaConnection; to: string }> {
  const normalizedTo = normalizePhoneDigits(input.to);
  if (!normalizedTo) {
    throw new Error("Recipient phone must contain 8 to 15 digits.");
  }
  if (!input.templateName.trim()) {
    throw new Error("Template name is required.");
  }

  const resolvedRow = await resolveMetaSendConnectionRow(input);
  const accessToken = decryptToken(resolvedRow.access_token_encrypted);
  const response = await graphPost<{ messages?: Array<{ id?: string }> }>(
    `/${resolvedRow.phone_number_id}/messages`,
    accessToken,
    buildMetaTemplateRequestBody({
      to: normalizedTo,
      templateName: input.templateName,
      language: input.language,
      components: input.components
    })
  );

  const messageId = response.messages?.[0]?.id ?? null;
  void fanoutEvent(input.userId, "messages.update", {
    remoteJid: normalizedTo,
    status: "sent",
    messageId
  });

  return {
    messageId,
    connection: mapConnection(resolvedRow),
    to: normalizedTo
  };
}

export async function sendMetaFlowMessageDirect(input: {
  userId: string;
  to: string;
  payload: FlowMessagePayload;
  phoneNumberId?: string;
  linkedNumber?: string | null;
}): Promise<{ messageId: string | null; connection: MetaConnection; to: string; summaryText: string }> {
  const normalizedTo = normalizePhoneDigits(input.to);
  if (!normalizedTo) {
    throw new Error("Recipient phone must contain 8 to 15 digits.");
  }

  const resolvedRow = await resolveMetaSendConnectionRow(input);
  const accessToken = decryptToken(resolvedRow.access_token_encrypted);
  const canonicalPayload = validateFlowMessagePayload(input.payload);
  const deliveryPayload = adaptPayloadForChannel(canonicalPayload, "api_whatsapp");
  const summaryText = summarizeFlowMessage(deliveryPayload);
  if (!summaryText) {
    throw new Error("Flow message is empty.");
  }

  const response = await graphPost<{ messages?: Array<{ id?: string }> }>(
    `/${resolvedRow.phone_number_id}/messages`,
    accessToken,
    await buildMetaFlowRequestBody(normalizedTo, deliveryPayload, {
      phoneNumberId: resolvedRow.phone_number_id,
      accessToken
    })
  );

  const messageId = response.messages?.[0]?.id ?? null;
  void fanoutEvent(input.userId, "messages.update", {
    remoteJid: normalizedTo,
    status: "sent",
    messageId
  });

  return {
    messageId,
    connection: mapConnection(resolvedRow),
    to: normalizedTo,
    summaryText
  };
}

export async function sendMetaMessage(input: {
  userId: string;
  to: string;
  payload: FlowMessagePayload;
  phoneNumberId?: string;
  webhookUrl?: string | null;
}): Promise<{ messageId: string | null; connection: MetaConnection; summaryText: string }> {
  const normalizedTo = input.to.replace(/\D/g, "");
  const [contact, suppressionMap] = await Promise.all([
    getContactByPhoneForUser(input.userId, normalizedTo),
    findSuppressedRecipients(input.userId, [normalizedTo])
  ]);
  const suppression = suppressionMap.get(normalizedTo) ?? null;
  const hardBlocks = evaluateHardBlocks({
    category: "UTILITY",
    suppression,
    globalOptOut: !!contact?.global_opt_out_at,
    marketingEnabled: true
  });
  if (hardBlocks.codes.length > 0) {
    throw new Error(`Message blocked: ${hardBlocks.codes.join(", ")}`);
  }

  const sent = await sendMetaFlowMessageDirect(input);
  const conversation = await getOrCreateConversation(input.userId, sent.to, {
    channelType: "api",
    channelLinkedNumber: sent.connection.linkedNumber
  });
  await trackOutboundMessage(conversation.id, sent.summaryText, { webhookUrl: input.webhookUrl ?? null }, null, input.payload, sent.messageId ?? null);
  return {
    messageId: sent.messageId,
    connection: sent.connection,
    summaryText: sent.summaryText
  };
}

function buildWebhookTasks(payload: WebhookPayload): WebhookMessageTask[] {
  const tasks: WebhookMessageTask[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const messages = value?.messages ?? [];
      if (change.field !== "messages" || messages.length === 0) {
        continue;
      }
      if (!value) {
        continue;
      }

      const phoneNumberId = value.metadata?.phone_number_id;
      const displayPhoneNumber = value.metadata?.display_phone_number ?? null;
      if (!phoneNumberId) {
        continue;
      }

      for (const message of messages) {
        tasks.push({
          phoneNumberId,
          displayPhoneNumber,
          message,
          contacts: value.contacts ?? []
        });
      }
    }
  }

  return tasks;
}

async function normalizeWebhookTask(
  task: WebhookMessageTask,
  userId: string,
  accessToken: string
): Promise<NormalizedWebhookMessageTask | null> {
  const from = normalizePhoneDigits(task.message.from);
  const messageId = task.message.id?.trim();
  if (!from || !messageId) {
    return null;
  }

  const senderName =
    task.contacts.find((contact) => normalizePhoneDigits(contact.wa_id) === from)?.profile?.name ?? null;
  const extracted = summarizeMetaWebhookMessage(task.message);
  if (!extracted?.text) {
    return null;
  }

  const mediaDescriptor = selectInboundMediaDescriptor(task.message);
  let mediaUrl: string | null = null;
  let mimeType: string | null = mediaDescriptor?.mimeType ?? null;
  if (mediaDescriptor) {
    const downloaded = await downloadMetaInboundMedia(accessToken, mediaDescriptor);
    if (downloaded) {
      mimeType = downloaded.mimeType;
      mediaUrl = await storeMetaInboundMediaUpload(userId, downloaded);
    }
  }

  return {
    phoneNumberId: task.phoneNumberId,
    displayPhoneNumber: task.displayPhoneNumber,
    from,
    senderName,
    messageId,
    messageType: inferMetaWebhookMessageType(task.message),
    text: extracted.text,
    flowText: extracted.flowText ?? extracted.text,
    mediaUrl,
    mimeType,
    timestamp: normalizeMetaMessageTimestamp(task.message.timestamp),
    metadata: {
      type: task.message.type ?? null,
      reactionTo: task.message.reaction?.message_id ?? null
    }
  };
}

async function sendAutoReplyViaMetaApi(input: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
}): Promise<void> {
  await graphPost<{ messages?: Array<{ id?: string }> }>(`/${input.phoneNumberId}/messages`, input.accessToken, {
    messaging_product: "whatsapp",
    to: input.to,
    type: "text",
    text: {
      body: input.text
    }
  });
}

async function processWebhookTask(task: WebhookMessageTask): Promise<void> {
  let connectionRow = await getConnectionRowByPhoneNumberId(task.phoneNumberId);
  if (!connectionRow) {
    const pendingRow = await getConnectionRowByPhoneNumberId(task.phoneNumberId, { includePending: true });
    if (pendingRow) {
      try {
        const healedRow = await refreshConnectionStatusFromMeta(pendingRow, { forceRefresh: true });
        if (healedRow.status === "connected") {
          connectionRow = healedRow;
        }
      } catch (error) {
        console.warn(
          `[MetaWebhook] pending connection refresh failed phoneNumberId=${task.phoneNumberId}: ${(error as Error).message}`
        );
      }
    }
  }

  if (!connectionRow) {
    return;
  }

  const ownNumbers = new Set<string>(
    [connectionRow.linked_number, connectionRow.display_phone_number, task.displayPhoneNumber]
      .map((value) => normalizePhoneDigits(value))
      .filter((value): value is string => Boolean(value))
  );
  const senderPhone = normalizePhoneDigits(task.message.from);
  if (senderPhone && ownNumbers.has(senderPhone)) {
    console.info(
      `[MetaWebhook] inbound skipped user=${connectionRow.user_id} reason=from_own_number from=${senderPhone} phoneNumberId=${task.phoneNumberId}`
    );
    return;
  }

  const channelLinkedNumber = connectionRow.linked_number || task.displayPhoneNumber || null;
  const accessToken = decryptToken(connectionRow.access_token_encrypted);
  const normalizedTask = await normalizeWebhookTask(task, connectionRow.user_id, accessToken);
  if (!normalizedTask) {
    return;
  }

  try {
    await upsertWebhookContact({
      userId: connectionRow.user_id,
      phoneNumber: normalizedTask.from,
      displayName: normalizedTask.senderName ?? undefined
    });
  } catch (error) {
    console.warn(`[MetaWebhook] contact upsert failed user=${connectionRow.user_id} from=${normalizedTask.from}`, error);
  }

  const result = await processIncomingMessage({
    userId: connectionRow.user_id,
    channelType: "api",
    channelLinkedNumber,
    customerIdentifier: normalizedTask.from,
    messageText: normalizedTask.text,
    flowMessageText: normalizedTask.flowText ?? normalizedTask.text,
    senderName: normalizedTask.senderName ?? undefined,
    mediaUrl: normalizedTask.mediaUrl ?? null,
    shouldAutoReply: connectionRow.enabled,
    rawPayload: {
      messageId: normalizedTask.messageId,
      messageType: normalizedTask.messageType,
      flowText: normalizedTask.flowText ?? null,
      mimeType: normalizedTask.mimeType ?? null,
      metadata: normalizedTask.metadata ?? null,
      timestamp: normalizedTask.timestamp
    },
    sendReply: async ({ text }) => {
      await sendAutoReplyViaMetaApi({
        phoneNumberId: connectionRow.phone_number_id,
        accessToken,
        to: normalizedTask.from,
        text
      });
    }
  });

  if (!result.autoReplySent) {
    console.info(
      `[MetaWebhook] auto-reply skipped user=${connectionRow.user_id} conversation=${result.conversationId} reason=${result.reason} from=${normalizedTask.from}`
    );
    return;
  }

  console.info(
    `[MetaWebhook] auto-reply sent user=${connectionRow.user_id} conversation=${result.conversationId} from=${normalizedTask.from}`
  );
}

export async function handleMetaWebhookPayload(payload: unknown): Promise<void> {
  const parsed = (payload ?? {}) as WebhookPayload;
  const tasks = buildWebhookTasks(parsed);
  if (tasks.length === 0) {
    return;
  }

  for (const task of tasks) {
    try {
      await processWebhookTask(task);
    } catch (error) {
      console.error("[MetaWebhook] task failed", error);
    }
  }
}

export function verifyMetaWebhookSignature(rawBody: string, signatureHeader: string): boolean {
  if (!env.META_APP_SECRET) {
    return false;
  }
  const received = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;
  if (!received) {
    return false;
  }

  const expected = createHmac("sha256", env.META_APP_SECRET).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

