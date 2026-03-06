import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { getOrCreateConversation, trackOutboundMessage } from "./conversation-service.js";
import { processIncomingMessage } from "./message-router-service.js";
import { getUserPlanEntitlements } from "./billing-service.js";

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
  subscription_status: string;
  status: string;
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
  subscriptionStatus: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CompleteEmbeddedSignupInput {
  code: string;
  redirectUri?: string;
  metaBusinessId?: string;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
}

interface GraphListResponse<T> {
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

interface WebhookMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  document?: { caption?: string };
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
  from: string;
  senderName: string | null;
  text: string;
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
    subscriptionStatus: row.subscription_status,
    status: row.status,
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

function decryptToken(value: string): string {
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

function getMetaRedirectUri(override?: string): string {
  if (override?.trim()) {
    return override.trim();
  }
  return env.META_REDIRECT_URI || `${env.APP_BASE_URL.replace(/\/$/, "")}/meta-callback`;
}

function buildGraphUrl(path: string, query?: Record<string, string | number | undefined>): string {
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

async function parseGraphResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ||
      `Meta Graph request failed (${response.status})`;
    throw new Error(message);
  }
  return json as T;
}

async function graphGet<T>(
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

async function graphPost<T>(
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

async function graphDelete<T>(
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
  subscriptionStatus?: string;
  status?: string;
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
       subscription_status,
       status,
       metadata_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (phone_number_id)
     DO UPDATE SET
       meta_business_id = EXCLUDED.meta_business_id,
       waba_id = EXCLUDED.waba_id,
       display_phone_number = EXCLUDED.display_phone_number,
       linked_number = EXCLUDED.linked_number,
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       token_expires_at = EXCLUDED.token_expires_at,
       subscription_status = EXCLUDED.subscription_status,
       status = EXCLUDED.status,
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
               subscription_status,
               status,
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
      args.subscriptionStatus ?? "pending",
      args.status ?? "pending",
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
            subscription_status,
            status,
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
            subscription_status,
            status,
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
            subscription_status,
            status,
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
               subscription_status,
               status,
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

  return persistMetaStatusSnapshot(row, snapshot, {
    metadataPatch: Object.keys(metadataPatch).length > 0 ? metadataPatch : undefined
  });
}

export function getMetaBusinessConfig() {
  return {
    configured: Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_EMBEDDED_SIGNUP_CONFIG_ID),
    appId: env.META_APP_ID ?? null,
    embeddedSignupConfigId: env.META_EMBEDDED_SIGNUP_CONFIG_ID ?? null,
    redirectUri: getMetaRedirectUri(),
    graphVersion: env.META_GRAPH_VERSION,
    webhookPath: "/meta-webhook",
    pricing: {
      platformFeeInrMonthly: 249,
      metaConversationChargesSeparate: true
    }
  };
}

export async function getMetaBusinessStatus(
  userId: string,
  options?: { forceRefresh?: boolean }
): Promise<{
  connected: boolean;
  connection: MetaConnection | null;
}> {
  let row = await getLatestConnectionRowByUserId(userId);
  if (row) {
    try {
      row = await refreshConnectionStatusFromMeta(row, {
        forceRefresh: options?.forceRefresh ?? true
      });
    } catch (error) {
      console.warn(
        `[MetaStatusSync] unable to refresh user=${userId} phoneNumberId=${row.phone_number_id}: ${(error as Error).message}`
      );
    }
  }
  return {
    connected: row?.status === "connected",
    connection: row ? mapConnection(row) : null
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
    subscriptionStatus: isConnected ? "active" : "pending",
    status: isConnected ? "connected" : "pending",
    metadata: {
      source: "embedded_signup",
      connectedAt: new Date().toISOString(),
      ...buildWebhookSubscriptionMetadata(webhookSubscription, "embedded_signup"),
      registration: {
        ...registration,
        attemptedAt: new Date().toISOString()
      }
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
  if (effectiveConnection.status !== "connected") {
    if (registration.reason === "missing_pin") {
      throw new Error(
        "WhatsApp number is not fully connected yet. Set META_PHONE_REGISTRATION_PIN in API env and reconnect this number."
      );
    }
    if (registration.error) {
      throw new Error(`WhatsApp number registration failed: ${registration.error}`);
    }
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
            subscription_status,
            status,
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
  const rows = await listDisconnectTargetConnections(userId, connectionId);
  if (rows.length === 0) {
    return false;
  }

  // Best-effort remote cleanup before local deletion.
  for (const row of rows) {
    try {
      await unsubscribeWebhookSubscription(row);
    } catch (error) {
      console.warn(
        `[MetaDisconnect] webhook unsubscribe failed user=${userId} wabaId=${row.waba_id}: ${(error as Error).message}`
      );
    }
    try {
      await revokeMetaAccess(row);
    } catch (error) {
      console.warn(
        `[MetaDisconnect] token revoke failed user=${userId} phoneNumberId=${row.phone_number_id}: ${(error as Error).message}`
      );
    }
  }

  const shouldPurgeConnectionData = options?.purgeConnectionData ?? true;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (shouldPurgeConnectionData) {
      if (connectionId) {
        const linkedNumbers = Array.from(
          new Set(
            rows
              .flatMap((row) => [row.linked_number, normalizePhoneDigits(row.display_phone_number)])
              .filter((value): value is string => Boolean(value))
          )
        );

        if (linkedNumbers.length > 0) {
          await client.query(
            `DELETE FROM agent_profiles
             WHERE user_id = $1
               AND channel_type = 'api'
               AND linked_number = ANY($2::text[])`,
            [userId, linkedNumbers]
          );

          await client.query(
            `DELETE FROM conversations
             WHERE user_id = $1
               AND channel_type = 'api'
               AND channel_linked_number = ANY($2::text[])`,
            [userId, linkedNumbers]
          );
        } else {
          await client.query(
            `DELETE FROM agent_profiles
             WHERE user_id = $1
               AND channel_type = 'api'`,
            [userId]
          );

          await client.query(
            `DELETE FROM conversations
             WHERE user_id = $1
               AND channel_type = 'api'`,
            [userId]
          );
        }
      } else {
        await client.query(
          `DELETE FROM agent_profiles
           WHERE user_id = $1
             AND channel_type = 'api'`,
          [userId]
        );

        await client.query(
          `DELETE FROM conversations
           WHERE user_id = $1
             AND channel_type = 'api'`,
          [userId]
        );
      }
    }

    await client.query(
      `DELETE FROM whatsapp_business_connections
       WHERE user_id = $1
         AND ($2::uuid IS NULL OR id = $2::uuid)`,
      [userId, connectionId ?? null]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return true;
}

export async function sendMetaTextMessage(input: {
  userId: string;
  to: string;
  text: string;
  phoneNumberId?: string;
}): Promise<{ messageId: string | null; connection: MetaConnection }> {
  const sent = await sendMetaTextDirect(input);
  const conversation = await getOrCreateConversation(input.userId, sent.to, {
    channelType: "api",
    channelLinkedNumber: sent.connection.linkedNumber
  });
  await trackOutboundMessage(conversation.id, sent.text);

  return {
    messageId: sent.messageId,
    connection: sent.connection
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
  if (resolvedRow.subscription_status !== "active" || resolvedRow.status !== "connected") {
    try {
      resolvedRow = await refreshConnectionStatusFromMeta(resolvedRow, { forceRefresh: true });
    } catch (error) {
      console.warn(
        `[MetaSend] pre-send status refresh failed user=${input.userId} phoneNumberId=${resolvedRow.phone_number_id}: ${(error as Error).message}`
      );
    }
  }

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

  return {
    messageId: response.messages?.[0]?.id ?? null,
    connection: mapConnection(resolvedRow),
    to: normalizedTo,
    text
  };
}

function extractMessageText(message: WebhookMessage): string | null {
  const directText = message.text?.body?.trim();
  if (directText) {
    return directText;
  }

  const buttonText = message.button?.text?.trim();
  if (buttonText) {
    return buttonText;
  }

  const interactiveButton = message.interactive?.button_reply;
  if (interactiveButton) {
    const line = [interactiveButton.title, interactiveButton.id].filter(Boolean).join(" ").trim();
    if (line) {
      return line;
    }
  }

  const interactiveList = message.interactive?.list_reply;
  if (interactiveList) {
    const line = [interactiveList.title, interactiveList.description, interactiveList.id].filter(Boolean).join(" ").trim();
    if (line) {
      return line;
    }
  }

  const mediaCaption = message.image?.caption?.trim() || message.document?.caption?.trim();
  if (mediaCaption) {
    return mediaCaption;
  }

  return null;
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
        const from = normalizePhoneDigits(message.from);
        const text = extractMessageText(message);
        if (!from || !text) {
          continue;
        }

        const senderName =
          value.contacts?.find((contact) => normalizePhoneDigits(contact.wa_id) === from)?.profile?.name ?? null;

        tasks.push({
          phoneNumberId,
          displayPhoneNumber,
          from,
          senderName,
          text
        });
      }
    }
  }

  return tasks;
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
  if (ownNumbers.has(task.from)) {
    console.info(
      `[MetaWebhook] inbound skipped user=${connectionRow.user_id} reason=from_own_number from=${task.from} phoneNumberId=${task.phoneNumberId}`
    );
    return;
  }

  const channelLinkedNumber = connectionRow.linked_number || task.displayPhoneNumber || null;
  const accessToken = decryptToken(connectionRow.access_token_encrypted);
  const result = await processIncomingMessage({
    userId: connectionRow.user_id,
    channelType: "api",
    channelLinkedNumber,
    customerIdentifier: task.from,
    messageText: task.text,
    senderName: task.senderName ?? undefined,
    shouldAutoReply: true,
    sendReply: async ({ text }) => {
      await sendAutoReplyViaMetaApi({
        phoneNumberId: connectionRow.phone_number_id,
        accessToken,
        to: task.from,
        text
      });
    }
  });

  if (!result.autoReplySent) {
    console.info(
      `[MetaWebhook] auto-reply skipped user=${connectionRow.user_id} conversation=${result.conversationId} reason=${result.reason} from=${task.from}`
    );
    return;
  }

  console.info(
    `[MetaWebhook] auto-reply sent user=${connectionRow.user_id} conversation=${result.conversationId} from=${task.from}`
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
