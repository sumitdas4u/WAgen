import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import {
  decryptJsonPayload,
  decryptTextPayload,
  encryptJsonPayload,
  encryptTextPayload
} from "../utils/encryption.js";

interface GoogleCalendarConnectionRow {
  id: string;
  user_id: string;
  google_email: string;
  google_account_id: string | null;
  display_name: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string | null;
  granted_scopes: string[] | null;
  status: string;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleCalendarConnection {
  id: string;
  userId: string;
  googleEmail: string;
  googleAccountId: string | null;
  displayName: string | null;
  tokenExpiresAt: string | null;
  grantedScopes: string[];
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleCalendarConfig {
  configured: boolean;
  redirectUri: string | null;
  scopes: string[];
}

export interface GoogleCalendarStatus {
  configured: boolean;
  connected: boolean;
  connection: GoogleCalendarConnection | null;
}

export interface GoogleCalendarSummary {
  id: string;
  summary: string;
  primary: boolean;
  timeZone: string | null;
  accessRole: string | null;
}

export interface GoogleCalendarBusyInterval {
  start: string;
  end: string;
}

export interface GoogleCalendarFreeBusyInput {
  userId: string;
  connectionId?: string | null;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  timeZone?: string | null;
}

export interface GoogleCalendarEventInput {
  userId: string;
  connectionId?: string | null;
  calendarId: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  startTime: string;
  endTime: string;
  timeZone?: string | null;
  attendeeEmail?: string | null;
  attendeeName?: string | null;
  sendUpdates?: "all" | "externalOnly" | "none";
}

export interface GoogleCalendarEventResult {
  id: string;
  status: string;
  htmlLink: string | null;
  summary: string;
  startTime: string | null;
  endTime: string | null;
}

interface GoogleOAuthState {
  userId: string;
  createdAt: number;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
}

interface GoogleCalendarListResponse {
  items?: Array<{
    id?: string;
    summary?: string;
    primary?: boolean;
    timeZone?: string;
    accessRole?: string;
  }>;
}

interface GoogleFreeBusyResponse {
  calendars?: Record<
    string,
    {
      busy?: Array<{
        start?: string;
        end?: string;
      }>;
    }
  >;
}

interface GoogleEventResponse {
  id?: string;
  status?: string;
  htmlLink?: string;
  summary?: string;
  start?: {
    dateTime?: string;
    date?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
}

const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar"
] as const;

function getGoogleCalendarClientId(): string {
  return env.GOOGLE_CALENDAR_CLIENT_ID?.trim() || env.GOOGLE_SHEETS_CLIENT_ID?.trim() || "";
}

function getGoogleCalendarClientSecret(): string {
  return env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() || env.GOOGLE_SHEETS_CLIENT_SECRET?.trim() || "";
}

function isGoogleCalendarConfigured(): boolean {
  return Boolean(getGoogleCalendarClientId() && getGoogleCalendarClientSecret());
}

function ensureGoogleCalendarConfigured(): void {
  if (!isGoogleCalendarConfigured()) {
    throw new Error(
      "Google Calendar integration is not configured. Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET, or reuse the Google Sheets credentials."
    );
  }
}

function getGoogleCalendarTokenSecret(): string {
  const secret =
    env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY?.trim() ||
    env.GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY?.trim() ||
    "";
  if (!secret) {
    throw new Error(
      "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY is required for Google Calendar token encryption."
    );
  }
  return secret;
}

function getGoogleCalendarRedirectUri(): string {
  if (env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI?.trim()) {
    return env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI.trim();
  }
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/api/google/calendar/connect/callback`;
}

function getGrantedScopes(scope: string | undefined | null): string[] {
  if (!scope?.trim()) {
    return [];
  }
  return scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapConnection(row: GoogleCalendarConnectionRow): GoogleCalendarConnection {
  return {
    id: row.id,
    userId: row.user_id,
    googleEmail: row.google_email,
    googleAccountId: row.google_account_id,
    displayName: row.display_name,
    tokenExpiresAt: row.token_expires_at,
    grantedScopes: row.granted_scopes ?? [],
    status: row.status,
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getConnectionRowByUserId(
  userId: string
): Promise<GoogleCalendarConnectionRow | null> {
  const result = await pool.query<GoogleCalendarConnectionRow>(
    `SELECT id,
            user_id,
            google_email,
            google_account_id,
            display_name,
            access_token_encrypted,
            refresh_token_encrypted,
            token_expires_at,
            granted_scopes,
            status,
            metadata_json,
            created_at,
            updated_at
       FROM google_calendar_connections
      WHERE user_id = $1
      LIMIT 1`,
    [userId]
  );

  return result.rows[0] ?? null;
}

async function updateConnectionStatus(
  connectionId: string,
  status: string,
  metadataPatch?: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `UPDATE google_calendar_connections
        SET status = $2,
            metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $3::jsonb
      WHERE id = $1`,
    [connectionId, status, JSON.stringify(metadataPatch ?? {})]
  );
}

async function upsertConnection(args: {
  userId: string;
  googleEmail: string;
  googleAccountId: string | null;
  displayName: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string | null;
  grantedScopes: string[];
  metadata: Record<string, unknown>;
}): Promise<GoogleCalendarConnection> {
  const result = await pool.query<GoogleCalendarConnectionRow>(
    `INSERT INTO google_calendar_connections (
       user_id,
       google_email,
       google_account_id,
       display_name,
       access_token_encrypted,
       refresh_token_encrypted,
       token_expires_at,
       granted_scopes,
       status,
       metadata_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], 'connected', $9::jsonb)
     ON CONFLICT (user_id)
     DO UPDATE SET
       google_email = EXCLUDED.google_email,
       google_account_id = EXCLUDED.google_account_id,
       display_name = EXCLUDED.display_name,
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
       token_expires_at = EXCLUDED.token_expires_at,
       granted_scopes = EXCLUDED.granted_scopes,
       status = 'connected',
       metadata_json = COALESCE(google_calendar_connections.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json
     RETURNING id,
               user_id,
               google_email,
               google_account_id,
               display_name,
               access_token_encrypted,
               refresh_token_encrypted,
               token_expires_at,
               granted_scopes,
               status,
               metadata_json,
               created_at,
               updated_at`,
    [
      args.userId,
      args.googleEmail,
      args.googleAccountId,
      args.displayName,
      encryptTextPayload(args.accessToken, getGoogleCalendarTokenSecret()),
      encryptTextPayload(args.refreshToken, getGoogleCalendarTokenSecret()),
      args.tokenExpiresAt,
      args.grantedScopes,
      JSON.stringify(args.metadata)
    ]
  );

  return mapConnection(result.rows[0]);
}

async function googleApiFetchJson<T>(
  accessToken: string,
  url: string,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers
  });

  const rawBody = await response.text();
  let payload: unknown = {};
  try {
    payload = rawBody ? (JSON.parse(rawBody) as unknown) : {};
  } catch {
    payload = rawBody;
  }

  if (!response.ok) {
    const message =
      (payload as { error?: { message?: string } }).error?.message ||
      (typeof payload === "string" && payload.trim()) ||
      `Google Calendar API request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  ensureGoogleCalendarConfigured();

  const body = new URLSearchParams({
    code,
    client_id: getGoogleCalendarClientId(),
    client_secret: getGoogleCalendarClientSecret(),
    redirect_uri: getGoogleCalendarRedirectUri(),
    grant_type: "authorization_code"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const rawBody = await response.text();
  const payload = rawBody
    ? (JSON.parse(rawBody) as GoogleTokenResponse & {
        error_description?: string;
        error?: string;
      })
    : {};

  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `Failed to exchange Google Calendar authorization code (${response.status}).`
    );
  }

  return payload;
}

async function refreshAccessToken(
  row: GoogleCalendarConnectionRow
): Promise<GoogleCalendarConnectionRow> {
  ensureGoogleCalendarConfigured();

  const refreshToken = decryptTextPayload(
    row.refresh_token_encrypted,
    getGoogleCalendarTokenSecret()
  );

  const body = new URLSearchParams({
    client_id: getGoogleCalendarClientId(),
    client_secret: getGoogleCalendarClientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const rawBody = await response.text();
  const payload = rawBody
    ? (JSON.parse(rawBody) as GoogleTokenResponse & {
        error_description?: string;
        error?: string;
      })
    : {};

  if (!response.ok || !payload.access_token) {
    await updateConnectionStatus(row.id, "error", {
      googleCalendarLastError:
        payload.error_description ||
        payload.error ||
        `Failed to refresh Google Calendar access token (${response.status}).`,
      googleCalendarLastErrorAt: new Date().toISOString()
    });
    throw new Error(
      payload.error_description ||
        payload.error ||
        `Failed to refresh Google Calendar access token (${response.status}).`
    );
  }

  const tokenExpiresAt =
    typeof payload.expires_in === "number"
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : row.token_expires_at;
  const grantedScopes = getGrantedScopes(payload.scope);

  const result = await pool.query<GoogleCalendarConnectionRow>(
    `UPDATE google_calendar_connections
        SET access_token_encrypted = $2,
            token_expires_at = $3,
            granted_scopes = $4::text[],
            status = 'connected',
            metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $5::jsonb
      WHERE id = $1
      RETURNING id,
                user_id,
                google_email,
                google_account_id,
                display_name,
                access_token_encrypted,
                refresh_token_encrypted,
                token_expires_at,
                granted_scopes,
                status,
                metadata_json,
                created_at,
                updated_at`,
    [
      row.id,
      encryptTextPayload(payload.access_token, getGoogleCalendarTokenSecret()),
      tokenExpiresAt,
      grantedScopes.length > 0 ? grantedScopes : row.granted_scopes ?? [],
      JSON.stringify({
        googleCalendarLastRefreshAt: new Date().toISOString()
      })
    ]
  );

  return result.rows[0];
}

async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  return googleApiFetchJson<GoogleUserInfo>(
    accessToken,
    "https://openidconnect.googleapis.com/v1/userinfo"
  );
}

async function resolveAuthorizedAccess(input: {
  userId: string;
  connectionId?: string | null;
}): Promise<{ row: GoogleCalendarConnectionRow; accessToken: string }> {
  ensureGoogleCalendarConfigured();

  const row = await getConnectionRowByUserId(input.userId);
  if (!row) {
    throw new Error("Google Calendar is not connected. Connect your Google account first.");
  }
  if (input.connectionId && row.id !== input.connectionId) {
    throw new Error("The selected Google Calendar connection is no longer available.");
  }
  if (row.status !== "connected" && row.status !== "error") {
    throw new Error("Google Calendar connection is not active.");
  }

  const expiresAtMs = row.token_expires_at ? Date.parse(row.token_expires_at) : Number.NaN;
  const needsRefresh =
    !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + 60_000;
  const freshRow = needsRefresh ? await refreshAccessToken(row) : row;

  return {
    row: freshRow,
    accessToken: decryptTextPayload(
      freshRow.access_token_encrypted,
      getGoogleCalendarTokenSecret()
    )
  };
}

export function getGoogleCalendarConfig(): GoogleCalendarConfig {
  return {
    configured: isGoogleCalendarConfigured(),
    redirectUri: isGoogleCalendarConfigured() ? getGoogleCalendarRedirectUri() : null,
    scopes: [...GOOGLE_CALENDAR_SCOPES]
  };
}

export async function getGoogleCalendarStatus(
  userId: string
): Promise<GoogleCalendarStatus> {
  if (!isGoogleCalendarConfigured()) {
    return {
      configured: false,
      connected: false,
      connection: null
    };
  }

  const row = await getConnectionRowByUserId(userId);
  return {
    configured: true,
    connected: Boolean(row && row.status !== "disconnected"),
    connection: row ? mapConnection(row) : null
  };
}

export function buildGoogleCalendarConnectUrl(userId: string): string {
  ensureGoogleCalendarConfigured();

  const state = encryptJsonPayload(
    {
      userId,
      createdAt: Date.now()
    } satisfies GoogleOAuthState,
    getGoogleCalendarTokenSecret()
  );

  const params = new URLSearchParams({
    client_id: getGoogleCalendarClientId(),
    redirect_uri: getGoogleCalendarRedirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    state
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function completeGoogleCalendarOAuthCallback(input: {
  code: string;
  state: string;
}): Promise<GoogleCalendarConnection> {
  ensureGoogleCalendarConfigured();

  let statePayload: GoogleOAuthState;
  try {
    statePayload = decryptJsonPayload<GoogleOAuthState>(
      input.state,
      getGoogleCalendarTokenSecret()
    );
  } catch {
    throw new Error("Google Calendar OAuth state is invalid or expired.");
  }

  if (!statePayload.userId || !statePayload.createdAt) {
    throw new Error("Google Calendar OAuth state is invalid.");
  }
  if (Date.now() - statePayload.createdAt > 15 * 60_000) {
    throw new Error("Google Calendar OAuth session expired. Start the connection again.");
  }

  const existing = await getConnectionRowByUserId(statePayload.userId);
  const tokenResponse = await exchangeCodeForTokens(input.code);
  const accessToken = tokenResponse.access_token?.trim();
  const refreshToken = tokenResponse.refresh_token?.trim()
    ? tokenResponse.refresh_token.trim()
    : existing
      ? decryptTextPayload(existing.refresh_token_encrypted, getGoogleCalendarTokenSecret())
      : "";

  if (!accessToken) {
    throw new Error("Google did not return an access token.");
  }
  if (!refreshToken) {
    throw new Error(
      "Google did not return a refresh token. Reconnect and approve offline access."
    );
  }

  const userInfo = await fetchGoogleUserInfo(accessToken);
  const googleEmail = userInfo.email?.trim();
  if (!googleEmail) {
    throw new Error("Google account email is missing from the OAuth response.");
  }

  const tokenExpiresAt =
    typeof tokenResponse.expires_in === "number"
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : existing?.token_expires_at ?? null;

  return upsertConnection({
    userId: statePayload.userId,
    googleEmail,
    googleAccountId: userInfo.sub?.trim() || null,
    displayName: userInfo.name?.trim() || null,
    accessToken,
    refreshToken,
    tokenExpiresAt,
    grantedScopes:
      getGrantedScopes(tokenResponse.scope).length > 0
        ? getGrantedScopes(tokenResponse.scope)
        : existing?.granted_scopes ?? [...GOOGLE_CALENDAR_SCOPES],
    metadata: {
      googleCalendarLastConnectedAt: new Date().toISOString(),
      googleCalendarPicture: userInfo.picture?.trim() || null
    }
  });
}

export async function disconnectGoogleCalendarConnection(
  userId: string,
  connectionId?: string | null
): Promise<boolean> {
  const row = await getConnectionRowByUserId(userId);
  if (!row) {
    return false;
  }
  if (connectionId && row.id !== connectionId) {
    return false;
  }

  const result = await pool.query(
    "DELETE FROM google_calendar_connections WHERE user_id = $1 AND id = $2",
    [userId, row.id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listGoogleCalendars(input: {
  userId: string;
  connectionId?: string | null;
}): Promise<GoogleCalendarSummary[]> {
  const { accessToken } = await resolveAuthorizedAccess(input);
  const params = new URLSearchParams({
    minAccessRole: "writer",
    showHidden: "false",
    fields: "items(id,summary,primary,timeZone,accessRole)"
  });
  const response = await googleApiFetchJson<GoogleCalendarListResponse>(
    accessToken,
    `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params.toString()}`
  );

  return (response.items ?? [])
    .map((item) => ({
      id: item.id?.trim() ?? "",
      summary: item.summary?.trim() ?? "",
      primary: Boolean(item.primary),
      timeZone: item.timeZone?.trim() ?? null,
      accessRole: item.accessRole?.trim() ?? null
    }))
    .filter((item) => item.id && item.summary);
}

export async function queryGoogleCalendarFreeBusy(
  input: GoogleCalendarFreeBusyInput
): Promise<GoogleCalendarBusyInterval[]> {
  const { accessToken } = await resolveAuthorizedAccess(input);
  const response = await googleApiFetchJson<GoogleFreeBusyResponse>(
    accessToken,
    "https://www.googleapis.com/calendar/v3/freeBusy",
    {
      method: "POST",
      body: JSON.stringify({
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        timeZone: input.timeZone?.trim() || undefined,
        items: [{ id: input.calendarId }]
      })
    }
  );

  const busy = response.calendars?.[input.calendarId]?.busy ?? [];
  return busy
    .map((item) => ({
      start: item.start?.trim() ?? "",
      end: item.end?.trim() ?? ""
    }))
    .filter((item) => item.start && item.end)
    .sort((left, right) => left.start.localeCompare(right.start));
}

export async function createGoogleCalendarEvent(
  input: GoogleCalendarEventInput
): Promise<GoogleCalendarEventResult> {
  const { accessToken } = await resolveAuthorizedAccess(input);
  const sendUpdates = input.sendUpdates ?? "all";
  const attendees = input.attendeeEmail?.trim()
    ? [
        {
          email: input.attendeeEmail.trim(),
          displayName: input.attendeeName?.trim() || undefined
        }
      ]
    : undefined;

  const response = await googleApiFetchJson<GoogleEventResponse>(
    accessToken,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      input.calendarId
    )}/events?sendUpdates=${encodeURIComponent(sendUpdates)}`,
    {
      method: "POST",
      body: JSON.stringify({
        summary: input.summary,
        description: input.description?.trim() || undefined,
        location: input.location?.trim() || undefined,
        start: {
          dateTime: input.startTime,
          timeZone: input.timeZone?.trim() || undefined
        },
        end: {
          dateTime: input.endTime,
          timeZone: input.timeZone?.trim() || undefined
        },
        attendees
      })
    }
  );

  return {
    id: response.id?.trim() ?? "",
    status: response.status?.trim() ?? "",
    htmlLink: response.htmlLink?.trim() ?? null,
    summary: response.summary?.trim() ?? input.summary,
    startTime: response.start?.dateTime ?? response.start?.date ?? null,
    endTime: response.end?.dateTime ?? response.end?.date ?? null
  };
}

export function renderGoogleCalendarOauthPopupPage(input: {
  status: "success" | "error";
  message: string;
}): string {
  const appOrigin = (() => {
    try {
      return new URL(env.APP_BASE_URL).origin;
    } catch {
      return "*";
    }
  })();

  const safeMessage = escapeHtml(input.message);
  const messageJson = JSON.stringify(input.message);
  const statusJson = JSON.stringify(input.status);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google Calendar Connection</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f7f8fb;
        color: #0f172a;
      }
      .card {
        width: min(420px, calc(100vw - 32px));
        background: #ffffff;
        border: 1px solid #dbe2ea;
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 20px;
      }
      p {
        margin: 0;
        color: #475569;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${input.status === "success" ? "Google Calendar connected" : "Connection failed"}</h1>
      <p>${safeMessage}</p>
    </div>
    <script>
      (function () {
        var payload = {
          type: "wagen-google-calendar-oauth",
          status: ${statusJson},
          message: ${messageJson}
        };
        try {
          if (window.opener && typeof window.opener.postMessage === "function") {
            window.opener.postMessage(payload, ${JSON.stringify(appOrigin)});
          }
        } catch (error) {
          console.error("Failed to notify opener", error);
        }
        if (payload.status === "success") {
          setTimeout(function () {
            window.close();
          }, 900);
        }
      })();
    </script>
  </body>
</html>`;
}
