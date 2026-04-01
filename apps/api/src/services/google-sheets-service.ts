import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import {
  decryptJsonPayload,
  decryptTextPayload,
  encryptJsonPayload,
  encryptTextPayload
} from "../utils/encryption.js";

interface GoogleSheetsConnectionRow {
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

export interface GoogleSheetsConnection {
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

export interface GoogleSheetsConfig {
  configured: boolean;
  redirectUri: string | null;
  scopes: string[];
}

export interface GoogleSheetsStatus {
  configured: boolean;
  connected: boolean;
  connection: GoogleSheetsConnection | null;
}

export interface GoogleSpreadsheetSummary {
  id: string;
  name: string;
  modifiedTime: string | null;
}

export interface GoogleSheetSummary {
  sheetId: number;
  title: string;
  rowCount: number | null;
  columnCount: number | null;
}

export interface GoogleSheetsColumnValueInput {
  columnName: string;
  value: string;
}

export interface GoogleSheetsAppendRowInput {
  userId: string;
  connectionId?: string | null;
  spreadsheetId: string;
  sheetTitle: string;
  rowValues: GoogleSheetsColumnValueInput[];
}

export interface GoogleSheetsUpdateRowInput extends GoogleSheetsAppendRowInput {
  referenceColumn: string;
  referenceValue: string;
}

export interface GoogleSheetsFetchRowInput {
  userId: string;
  connectionId?: string | null;
  spreadsheetId: string;
  sheetTitle: string;
  referenceColumn: string;
  referenceValue: string;
}

export interface GoogleSheetsAppendRowResult {
  spreadsheetId: string;
  sheetTitle: string;
  updatedRange: string | null;
  row: Record<string, string>;
}

export interface GoogleSheetsUpdateRowResult {
  matched: boolean;
  spreadsheetId: string;
  sheetTitle: string;
  rowNumber: number | null;
  updatedRange: string | null;
  row: Record<string, string> | null;
}

export interface GoogleSheetsFetchRowResult {
  found: boolean;
  spreadsheetId: string;
  sheetTitle: string;
  rowNumber: number | null;
  row: Record<string, string> | null;
}

export interface GoogleSheetsFetchRowsResult {
  found: boolean;
  spreadsheetId: string;
  sheetTitle: string;
  count: number;
  rows: Array<Record<string, string>>;
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
  token_type?: string;
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

interface GoogleDriveFilesResponse {
  files?: Array<{
    id?: string;
    name?: string;
    modifiedTime?: string;
  }>;
}

interface GoogleSpreadsheetMetadataResponse {
  spreadsheetId?: string;
  properties?: {
    title?: string;
  };
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
      gridProperties?: {
        rowCount?: number;
        columnCount?: number;
      };
    };
  }>;
}

interface GoogleSheetValuesResponse {
  range?: string;
  majorDimension?: string;
  values?: unknown[][];
}

interface GoogleAppendValuesResponse {
  updates?: {
    updatedRange?: string;
  };
}

const GOOGLE_SHEETS_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly"
] as const;

function mapConnection(row: GoogleSheetsConnectionRow): GoogleSheetsConnection {
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

function isGoogleSheetsConfigured(): boolean {
  return Boolean(env.GOOGLE_SHEETS_CLIENT_ID && env.GOOGLE_SHEETS_CLIENT_SECRET);
}

function ensureGoogleSheetsConfigured(): void {
  if (!isGoogleSheetsConfigured()) {
    throw new Error(
      "Google Sheets integration is not configured. Set GOOGLE_SHEETS_CLIENT_ID and GOOGLE_SHEETS_CLIENT_SECRET."
    );
  }
}

function getGoogleSheetsTokenSecret(): string {
  if (!env.GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY) {
    throw new Error(
      "GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY is required for Google Sheets token encryption."
    );
  }
  return env.GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY;
}

function getGoogleSheetsRedirectUri(): string {
  if (env.GOOGLE_SHEETS_OAUTH_REDIRECT_URI?.trim()) {
    return env.GOOGLE_SHEETS_OAUTH_REDIRECT_URI.trim();
  }
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/api/google/sheets/connect/callback`;
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

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function stringifyCellValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  return String(value);
}

function normalizeSheetHeaders(headerRow: unknown[]): string[] {
  const rawHeaders = headerRow.map((value) => stringifyCellValue(value).trim());
  let lastNamedIndex = -1;
  for (let index = rawHeaders.length - 1; index >= 0; index -= 1) {
    if (rawHeaders[index]) {
      lastNamedIndex = index;
      break;
    }
  }

  if (lastNamedIndex < 0) {
    throw new Error("The selected Google Sheet has an empty header row.");
  }

  const headers = rawHeaders.slice(0, lastNamedIndex + 1);
  if (headers.some((header) => !header)) {
    throw new Error(
      "The selected Google Sheet has blank header cells. Fill every column name in row 1 before using it."
    );
  }

  const uniqueHeaders = new Set(headers.map((header) => header.trim()));
  if (uniqueHeaders.size !== headers.length) {
    throw new Error(
      "The selected Google Sheet has duplicate header names. Use unique column names in row 1."
    );
  }

  return headers;
}

function createRowObject(headers: string[], values: unknown[]): Record<string, string> {
  return Object.fromEntries(
    headers.map((header, index) => [header, stringifyCellValue(values[index])])
  );
}

function columnIndexToLetter(index: number): string {
  let current = index + 1;
  let result = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
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
): Promise<GoogleSheetsConnectionRow | null> {
  const result = await pool.query<GoogleSheetsConnectionRow>(
    `SELECT id, user_id, google_email, google_account_id, display_name,
            access_token_encrypted, refresh_token_encrypted, token_expires_at,
            granted_scopes, status, metadata_json, created_at, updated_at
       FROM google_sheets_connections
      WHERE user_id = $1
      LIMIT 1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

async function getConnectionRowById(
  id: string
): Promise<GoogleSheetsConnectionRow | null> {
  const result = await pool.query<GoogleSheetsConnectionRow>(
    `SELECT id, user_id, google_email, google_account_id, display_name,
            access_token_encrypted, refresh_token_encrypted, token_expires_at,
            granted_scopes, status, metadata_json, created_at, updated_at
       FROM google_sheets_connections
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  return result.rows[0] ?? null;
}

async function updateConnectionStatus(
  connectionId: string,
  status: string,
  metadataPatch?: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `UPDATE google_sheets_connections
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
}): Promise<GoogleSheetsConnection> {
  const result = await pool.query<GoogleSheetsConnectionRow>(
    `INSERT INTO google_sheets_connections (
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
       metadata_json = COALESCE(google_sheets_connections.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json
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
      encryptTextPayload(args.accessToken, getGoogleSheetsTokenSecret()),
      encryptTextPayload(args.refreshToken, getGoogleSheetsTokenSecret()),
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
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
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
      `Google API request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  ensureGoogleSheetsConfigured();

  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_SHEETS_CLIENT_ID!,
    client_secret: env.GOOGLE_SHEETS_CLIENT_SECRET!,
    redirect_uri: getGoogleSheetsRedirectUri(),
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
        `Failed to exchange Google authorization code (${response.status}).`
    );
  }

  return payload;
}

async function refreshAccessToken(
  row: GoogleSheetsConnectionRow
): Promise<GoogleSheetsConnectionRow> {
  ensureGoogleSheetsConfigured();

  const refreshToken = decryptTextPayload(
    row.refresh_token_encrypted,
    getGoogleSheetsTokenSecret()
  );

  const body = new URLSearchParams({
    client_id: env.GOOGLE_SHEETS_CLIENT_ID!,
    client_secret: env.GOOGLE_SHEETS_CLIENT_SECRET!,
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
      googleSheetsLastError:
        payload.error_description ||
        payload.error ||
        `Failed to refresh Google access token (${response.status}).`,
      googleSheetsLastErrorAt: new Date().toISOString()
    });
    throw new Error(
      payload.error_description ||
        payload.error ||
        `Failed to refresh Google access token (${response.status}).`
    );
  }

  const tokenExpiresAt =
    typeof payload.expires_in === "number"
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : row.token_expires_at;
  const grantedScopes = getGrantedScopes(payload.scope);

  const result = await pool.query<GoogleSheetsConnectionRow>(
    `UPDATE google_sheets_connections
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
      encryptTextPayload(payload.access_token, getGoogleSheetsTokenSecret()),
      tokenExpiresAt,
      grantedScopes.length > 0 ? grantedScopes : row.granted_scopes ?? [],
      JSON.stringify({
        googleSheetsLastRefreshAt: new Date().toISOString()
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

async function resolveAuthorizedAccess(params: {
  userId: string;
  connectionId?: string | null;
}): Promise<{ row: GoogleSheetsConnectionRow; accessToken: string }> {
  // Look up by connectionId first (supports each user connecting their own account).
  // Fall back to userId so existing flows without a stored connectionId still work.
  const row = params.connectionId
    ? (await getConnectionRowById(params.connectionId) ?? await getConnectionRowByUserId(params.userId))
    : await getConnectionRowByUserId(params.userId);

  if (!row) {
    throw new Error("Google Sheets is not connected. Connect your Google account first.");
  }
  if (row.status !== "connected" && row.status !== "error") {
    throw new Error("Google Sheets connection is not active.");
  }

  const expiresAtMs = row.token_expires_at ? Date.parse(row.token_expires_at) : Number.NaN;
  const needsRefresh =
    !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + 60_000;

  const freshRow = needsRefresh ? await refreshAccessToken(row) : row;
  return {
    row: freshRow,
    accessToken: decryptTextPayload(
      freshRow.access_token_encrypted,
      getGoogleSheetsTokenSecret()
    )
  };
}

async function getSheetValues(
  accessToken: string,
  spreadsheetId: string,
  range: string
): Promise<unknown[][]> {
  const encodedRange = encodeURIComponent(range);
  const response = await googleApiFetchJson<GoogleSheetValuesResponse>(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodedRange}`
  );
  return response.values ?? [];
}

async function getSheetHeaders(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<string[]> {
  const values = await getSheetValues(
    accessToken,
    spreadsheetId,
    `${quoteSheetTitle(sheetTitle)}!1:1`
  );
  return normalizeSheetHeaders(values[0] ?? []);
}

async function getSheetTable(params: {
  accessToken: string;
  spreadsheetId: string;
  sheetTitle: string;
}): Promise<{ headers: string[]; rows: string[][] }> {
  const values = await getSheetValues(
    params.accessToken,
    params.spreadsheetId,
    quoteSheetTitle(params.sheetTitle)
  );
  const headers = normalizeSheetHeaders(values[0] ?? []);
  const rows = (values.slice(1) ?? []).map((row) =>
    headers.map((_, index) => stringifyCellValue(row[index]))
  );
  return { headers, rows };
}

function getHeaderIndex(headers: string[], columnName: string): number {
  const normalized = columnName.trim();
  const index = headers.findIndex((header) => header.trim() === normalized);
  if (index < 0) {
    throw new Error(`Column "${columnName}" was not found in the selected Google Sheet.`);
  }
  return index;
}

function buildColumnValueMap(
  headers: string[],
  rowValues: GoogleSheetsColumnValueInput[]
): Map<string, string> {
  if (rowValues.length === 0) {
    throw new Error("Add at least one Google Sheets column value.");
  }

  const map = new Map<string, string>();
  for (const item of rowValues) {
    const columnName = item.columnName.trim();
    if (!columnName) {
      throw new Error("Google Sheets column name is required.");
    }
    if (!headers.some((header) => header.trim() === columnName)) {
      throw new Error(`Column "${columnName}" was not found in the selected Google Sheet.`);
    }
    map.set(columnName, item.value);
  }
  return map;
}

function findMatchingRowIndices(
  headers: string[],
  rows: string[][],
  referenceColumn: string,
  referenceValue: string
): number[] {
  const headerIndex = getHeaderIndex(headers, referenceColumn);
  const normalizedReference = referenceValue.trim();

  return rows.reduce<number[]>((matches, row, index) => {
    if ((row[headerIndex] ?? "").trim() === normalizedReference) {
      matches.push(index);
    }
    return matches;
  }, []);
}

export function getGoogleSheetsConfig(): GoogleSheetsConfig {
  return {
    configured: isGoogleSheetsConfigured(),
    redirectUri: isGoogleSheetsConfigured() ? getGoogleSheetsRedirectUri() : null,
    scopes: [...GOOGLE_SHEETS_SCOPES]
  };
}

export async function getGoogleSheetsConnectionInfo(
  connectionId: string
): Promise<{ id: string; googleEmail: string; displayName: string | null; status: string } | null> {
  const row = await getConnectionRowById(connectionId);
  if (!row) return null;
  return { id: row.id, googleEmail: row.google_email, displayName: row.display_name, status: row.status };
}

export async function getGoogleSheetsStatus(userId: string): Promise<GoogleSheetsStatus> {
  if (!isGoogleSheetsConfigured()) {
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

export function buildGoogleSheetsConnectUrl(userId: string): string {
  ensureGoogleSheetsConfigured();

  const statePayload: GoogleOAuthState = {
    userId,
    createdAt: Date.now()
  };
  const state = encryptJsonPayload(statePayload, getGoogleSheetsTokenSecret());
  const params = new URLSearchParams({
    client_id: env.GOOGLE_SHEETS_CLIENT_ID!,
    redirect_uri: getGoogleSheetsRedirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: GOOGLE_SHEETS_SCOPES.join(" "),
    state
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function completeGoogleSheetsOAuthCallback(input: {
  code: string;
  state: string;
}): Promise<GoogleSheetsConnection> {
  ensureGoogleSheetsConfigured();

  let statePayload: GoogleOAuthState;
  try {
    statePayload = decryptJsonPayload<GoogleOAuthState>(
      input.state,
      getGoogleSheetsTokenSecret()
    );
  } catch {
    throw new Error("Google Sheets OAuth state is invalid or expired.");
  }

  if (!statePayload.userId || !statePayload.createdAt) {
    throw new Error("Google Sheets OAuth state is invalid.");
  }
  if (Date.now() - statePayload.createdAt > 15 * 60_000) {
    throw new Error("Google Sheets OAuth session expired. Start the connection again.");
  }

  const existing = await getConnectionRowByUserId(statePayload.userId);
  const tokenResponse = await exchangeCodeForTokens(input.code);
  const accessToken = tokenResponse.access_token?.trim();
  const refreshToken = tokenResponse.refresh_token?.trim()
    ? tokenResponse.refresh_token.trim()
    : existing
      ? decryptTextPayload(existing.refresh_token_encrypted, getGoogleSheetsTokenSecret())
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
        : existing?.granted_scopes ?? [...GOOGLE_SHEETS_SCOPES],
    metadata: {
      googleSheetsLastConnectedAt: new Date().toISOString(),
      googleSheetsPicture: userInfo.picture?.trim() || null
    }
  });
}

export async function disconnectGoogleSheetsConnection(
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
    "DELETE FROM google_sheets_connections WHERE user_id = $1 AND id = $2",
    [userId, row.id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listGoogleSheetsSpreadsheets(input: {
  userId: string;
  connectionId?: string | null;
}): Promise<GoogleSpreadsheetSummary[]> {
  const { accessToken } = await resolveAuthorizedAccess(input);
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: "files(id,name,modifiedTime)",
    pageSize: "100",
    orderBy: "modifiedTime desc,name_natural",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true"
  });

  const response = await googleApiFetchJson<GoogleDriveFilesResponse>(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`
  );

  return (response.files ?? [])
    .map((file) => ({
      id: file.id?.trim() ?? "",
      name: file.name?.trim() ?? "",
      modifiedTime: file.modifiedTime ?? null
    }))
    .filter((file) => file.id && file.name);
}

export async function listGoogleSpreadsheetSheets(input: {
  userId: string;
  connectionId?: string | null;
  spreadsheetId: string;
}): Promise<GoogleSheetSummary[]> {
  const { accessToken } = await resolveAuthorizedAccess(input);
  const response = await googleApiFetchJson<GoogleSpreadsheetMetadataResponse>(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      input.spreadsheetId
    )}?fields=sheets.properties(sheetId,title,gridProperties.rowCount,gridProperties.columnCount)`
  );

  return (response.sheets ?? [])
    .map((sheet) => ({
      sheetId: Number(sheet.properties?.sheetId ?? 0),
      title: String(sheet.properties?.title ?? "").trim(),
      rowCount:
        typeof sheet.properties?.gridProperties?.rowCount === "number"
          ? sheet.properties.gridProperties.rowCount
          : null,
      columnCount:
        typeof sheet.properties?.gridProperties?.columnCount === "number"
          ? sheet.properties.gridProperties.columnCount
          : null
    }))
    .filter((sheet) => sheet.sheetId >= 0 && sheet.title);
}

export async function listGoogleSheetColumns(input: {
  userId: string;
  connectionId?: string | null;
  spreadsheetId: string;
  sheetTitle: string;
}): Promise<string[]> {
  const { accessToken } = await resolveAuthorizedAccess(input);
  return getSheetHeaders(accessToken, input.spreadsheetId, input.sheetTitle);
}

export async function appendGoogleSheetRow(
  input: GoogleSheetsAppendRowInput
): Promise<GoogleSheetsAppendRowResult> {
  const { accessToken } = await resolveAuthorizedAccess(input);
  const headers = await getSheetHeaders(accessToken, input.spreadsheetId, input.sheetTitle);
  const valueMap = buildColumnValueMap(headers, input.rowValues);
  const row = headers.map((header) => valueMap.get(header) ?? "");

  const response = await googleApiFetchJson<GoogleAppendValuesResponse>(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      input.spreadsheetId
    )}/values/${encodeURIComponent(
      `${quoteSheetTitle(input.sheetTitle)}!A1`
    )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({
        majorDimension: "ROWS",
        values: [row]
      })
    }
  );

  return {
    spreadsheetId: input.spreadsheetId,
    sheetTitle: input.sheetTitle,
    updatedRange: response.updates?.updatedRange ?? null,
    row: createRowObject(headers, row)
  };
}

export async function updateGoogleSheetRow(
  input: GoogleSheetsUpdateRowInput
): Promise<GoogleSheetsUpdateRowResult> {
  const { accessToken } = await resolveAuthorizedAccess(input);
  const { headers, rows } = await getSheetTable({
    accessToken,
    spreadsheetId: input.spreadsheetId,
    sheetTitle: input.sheetTitle
  });
  const matches = findMatchingRowIndices(
    headers,
    rows,
    input.referenceColumn,
    input.referenceValue
  );

  if (matches.length === 0) {
    return {
      matched: false,
      spreadsheetId: input.spreadsheetId,
      sheetTitle: input.sheetTitle,
      rowNumber: null,
      updatedRange: null,
      row: null
    };
  }

  const matchedIndex = matches[0];
  const rowNumber = matchedIndex + 2;
  const existingRow = rows[matchedIndex] ?? headers.map(() => "");
  const valueMap = buildColumnValueMap(headers, input.rowValues);
  const nextRow = headers.map((header, index) => valueMap.get(header) ?? existingRow[index] ?? "");
  const range = `${quoteSheetTitle(input.sheetTitle)}!A${rowNumber}:${columnIndexToLetter(
    headers.length - 1
  )}${rowNumber}`;

  await googleApiFetchJson<GoogleSheetValuesResponse>(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      input.spreadsheetId
    )}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({
        majorDimension: "ROWS",
        values: [nextRow]
      })
    }
  );

  return {
    matched: true,
    spreadsheetId: input.spreadsheetId,
    sheetTitle: input.sheetTitle,
    rowNumber,
    updatedRange: range,
    row: createRowObject(headers, nextRow)
  };
}

export async function fetchGoogleSheetRow(
  input: GoogleSheetsFetchRowInput
): Promise<GoogleSheetsFetchRowResult> {
  const { accessToken } = await resolveAuthorizedAccess(input);
  const { headers, rows } = await getSheetTable({
    accessToken,
    spreadsheetId: input.spreadsheetId,
    sheetTitle: input.sheetTitle
  });
  const matches = findMatchingRowIndices(
    headers,
    rows,
    input.referenceColumn,
    input.referenceValue
  );

  if (matches.length === 0) {
    return {
      found: false,
      spreadsheetId: input.spreadsheetId,
      sheetTitle: input.sheetTitle,
      rowNumber: null,
      row: null
    };
  }

  const matchedIndex = matches[0];
  return {
    found: true,
    spreadsheetId: input.spreadsheetId,
    sheetTitle: input.sheetTitle,
    rowNumber: matchedIndex + 2,
    row: createRowObject(headers, rows[matchedIndex] ?? [])
  };
}

export async function fetchFirstMatchedGoogleSheetRows(
  input: GoogleSheetsFetchRowInput
): Promise<GoogleSheetsFetchRowsResult> {
  const { accessToken } = await resolveAuthorizedAccess(input);
  const { headers, rows } = await getSheetTable({
    accessToken,
    spreadsheetId: input.spreadsheetId,
    sheetTitle: input.sheetTitle
  });
  const matches = findMatchingRowIndices(
    headers,
    rows,
    input.referenceColumn,
    input.referenceValue
  ).slice(0, 10);

  return {
    found: matches.length > 0,
    spreadsheetId: input.spreadsheetId,
    sheetTitle: input.sheetTitle,
    count: matches.length,
    rows: matches.map((index) => createRowObject(headers, rows[index] ?? []))
  };
}

export function renderGoogleSheetsOauthPopupPage(input: {
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
  const safeStatus = escapeHtml(input.status);
  const messageJson = JSON.stringify(input.message);
  const statusJson = JSON.stringify(input.status);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google Sheets Connection</title>
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
      <h1>${input.status === "success" ? "Google Sheets connected" : "Connection failed"}</h1>
      <p>${safeMessage}</p>
    </div>
    <script>
      (function () {
        var payload = {
          type: "wagen-google-sheets-oauth",
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
