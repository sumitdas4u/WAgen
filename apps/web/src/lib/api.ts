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
  const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
        "x-request-id": requestId,
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

export function fetchGoogleSheetsConfig(token: string) {
  return apiRequest<GoogleSheetsConfig>("/api/google/sheets/config", { token });
}

export function fetchGoogleSheetsStatus(token: string) {
  return apiRequest<GoogleSheetsStatus>("/api/google/sheets/status", { token });
}

export function startGoogleSheetsConnect(token: string) {
  return apiRequest<{ url: string }>("/api/google/sheets/connect/start", { token });
}

export function disconnectGoogleSheets(token: string, payload?: { connectionId?: string }) {
  return apiRequest<{ ok: boolean }>("/api/google/sheets/disconnect", {
    token,
    method: "POST",
    body: JSON.stringify(payload ?? {})
  });
}

export function fetchGoogleSpreadsheets(
  token: string,
  options?: { connectionId?: string | null }
) {
  const params = new URLSearchParams();
  if (options?.connectionId) {
    params.set("connectionId", options.connectionId);
  }
  const query = params.toString();
  return apiRequest<{ spreadsheets: GoogleSpreadsheetSummary[] }>(
    query ? `/api/google/sheets/spreadsheets?${query}` : "/api/google/sheets/spreadsheets",
    { token }
  );
}

export function fetchGoogleSpreadsheetSheets(
  token: string,
  spreadsheetId: string,
  options?: { connectionId?: string | null }
) {
  const params = new URLSearchParams();
  if (options?.connectionId) {
    params.set("connectionId", options.connectionId);
  }
  const query = params.toString();
  const basePath = `/api/google/sheets/spreadsheets/${encodeURIComponent(spreadsheetId)}/sheets`;
  return apiRequest<{ sheets: GoogleSheetSummary[] }>(query ? `${basePath}?${query}` : basePath, {
    token
  });
}

export function fetchGoogleSheetColumns(
  token: string,
  spreadsheetId: string,
  sheetTitle: string,
  options?: { connectionId?: string | null }
) {
  const params = new URLSearchParams({ sheetTitle });
  if (options?.connectionId) {
    params.set("connectionId", options.connectionId);
  }
  return apiRequest<{ columns: string[] }>(
    `/api/google/sheets/spreadsheets/${encodeURIComponent(spreadsheetId)}/columns?${params.toString()}`,
    { token }
  );
}

export function fetchGoogleCalendarConfig(token: string) {
  return apiRequest<GoogleCalendarConfig>("/api/google/calendar/config", { token });
}

export function fetchGoogleCalendarStatus(token: string) {
  return apiRequest<GoogleCalendarStatus>("/api/google/calendar/status", { token });
}

export function startGoogleCalendarConnect(token: string) {
  return apiRequest<{ url: string }>("/api/google/calendar/connect/start", { token });
}

export function disconnectGoogleCalendar(
  token: string,
  payload?: { connectionId?: string }
) {
  return apiRequest<{ ok: boolean }>("/api/google/calendar/disconnect", {
    token,
    method: "POST",
    body: JSON.stringify(payload ?? {})
  });
}

export function fetchGoogleCalendars(
  token: string,
  options?: { connectionId?: string | null }
) {
  const params = new URLSearchParams();
  if (options?.connectionId) {
    params.set("connectionId", options.connectionId);
  }
  const query = params.toString();
  return apiRequest<{ calendars: GoogleCalendarSummary[] }>(
    query ? `/api/google/calendar/calendars?${query}` : "/api/google/calendar/calendars",
    { token }
  );
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

export interface FirebaseSessionPayload {
  idToken: string;
  name?: string;
  businessType?: string;
}

export interface GoogleAuthPopupPayload {
  type?: string;
  status?: "success" | "error";
  message?: string;
  token?: string | null;
  user?: User | null;
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

export function createFirebaseSession(payload: FirebaseSessionPayload) {
  return apiRequest<AuthResponse>("/api/auth/firebase/session", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function buildGoogleAuthStartUrl(options?: {
  mode?: "login" | "signup";
  businessType?: string;
}) {
  const params = new URLSearchParams();
  if (options?.mode) {
    params.set("mode", options.mode);
  }
  if (options?.businessType?.trim()) {
    params.set("businessType", options.businessType.trim());
  }
  const query = params.toString();
  return `${API_URL}/api/auth/google/start${query ? `?${query}` : ""}`;
}

export function migrateLegacyPasswordUser(payload: { email: string; password: string }) {
  return apiRequest<{ ok: boolean; migrated: boolean }>("/api/auth/legacy/migrate", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export interface AdminAuthResponse {
  token: string;
  role: "super_admin";
}

export function adminLogin(payload: { email: string; password: string }) {
  return apiRequest<AdminAuthResponse>("/api/admin/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export interface AdminOverview {
  totalUsers: number;
  activeAgents: number;
  totalConversations: number;
  totalMessages: number;
  totalChunks: number;
  totalTokens: number;
  totalCostInr: number;
}

export interface AdminUserUsage {
  userId: string;
  name: string;
  email: string;
  plan: string;
  aiActive: boolean;
  conversations: number;
  messages: number;
  chunks: number;
  totalTokens: number;
  costInr: number;
  createdAt: string;
}

export interface BillingPlan {
  code: "starter" | "pro" | "business";
  label: string;
  amountInr: number;
  trialDaysDefault: number;
  totalCountDefault: number;
  available: boolean;
}

export interface PlanEntitlements {
  planCode: "trial" | "starter" | "pro" | "business";
  maxApiNumbers: number;
  maxAgentProfiles: number;
  prioritySupport: boolean;
}

export interface BillingPaymentSummary {
  razorpayPaymentId: string;
  status: string;
  amountPaise: number;
  currency: string;
  method: string | null;
  paidAt: string | null;
  failureReason: string | null;
}

export interface BillingSubscriptionSummary {
  id: string;
  userId: string;
  razorpayCustomerId: string | null;
  razorpaySubscriptionId: string | null;
  razorpayPlanId: string | null;
  planCode: string;
  status: string;
  currentStartAt: string | null;
  currentEndAt: string | null;
  nextChargeAt: string | null;
  cancelledAt: string | null;
  endedAt: string | null;
  expiryDate: string | null;
  createdAt: string;
  updatedAt: string;
  lastPayment: BillingPaymentSummary | null;
  plan: {
    code: "starter" | "pro" | "business";
    label: string;
    amountInr: number;
    totalCountDefault: number;
    trialDaysDefault: number;
  };
}

export interface AdminSubscriptionSummary {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  razorpayCustomerId: string | null;
  razorpaySubscriptionId: string | null;
  razorpayPlanId: string | null;
  planCode: string;
  status: string;
  currentStartAt: string | null;
  currentEndAt: string | null;
  nextChargeAt: string | null;
  cancelledAt: string | null;
  endedAt: string | null;
  expiryDate: string | null;
  createdAt: string;
  updatedAt: string;
  lastPayment: BillingPaymentSummary | null;
}

export interface WorkspacePlanSummary {
  id: string;
  code: "starter" | "pro" | "business";
  name: string;
  priceMonthly: number;
  monthlyCredits: number;
  agentLimit: number;
  whatsappNumberLimit: number;
  status: "active" | "inactive";
}

export interface WorkspaceCreditsResponse {
  total_credits: number;
  used_credits: number;
  remaining_credits: number;
  low_credit: boolean;
  low_credit_threshold_percent: number;
  low_credit_message: string | null;
}

export interface AdminWorkspaceSummary {
  workspaceId: string;
  workspaceName: string;
  workspaceStatus: "active" | "suspended" | "deleted";
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  planCode: "starter" | "pro" | "business" | null;
  planName: string | null;
  subscriptionStatus: "active" | "trial" | "past_due" | "cancelled" | null;
  nextBillingDate: string | null;
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  updatedAt: string | null;
}

export function fetchAdminOverview(token: string) {
  return apiRequest<{ overview: AdminOverview }>("/api/admin/overview", { token });
}

export function fetchAdminUsers(token: string, options?: { limit?: number }) {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const path = query ? `/api/admin/users?${query}` : "/api/admin/users";
  return apiRequest<{ users: AdminUserUsage[] }>(path, { token });
}

export function fetchAdminUserUsage(
  token: string,
  userId: string,
  options?: { days?: number; limit?: number }
) {
  const params = new URLSearchParams();
  if (typeof options?.days === "number") {
    params.set("days", String(options.days));
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const path = query ? `/api/admin/users/${userId}/usage?${query}` : `/api/admin/users/${userId}/usage`;
  return apiRequest<UsageAnalyticsResponse>(path, { token });
}

export function fetchAdminSubscriptions(
  token: string,
  options?: { status?: string; limit?: number }
) {
  const params = new URLSearchParams();
  if (options?.status) {
    params.set("status", options.status);
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const path = query ? `/api/admin/subscriptions?${query}` : "/api/admin/subscriptions";
  return apiRequest<{ subscriptions: AdminSubscriptionSummary[] }>(path, { token });
}

export function fetchAdminPlans(token: string, options?: { includeInactive?: boolean }) {
  const params = new URLSearchParams();
  if (options?.includeInactive) {
    params.set("includeInactive", "true");
  }
  const query = params.toString();
  const path = query ? `/api/admin/plans?${query}` : "/api/admin/plans";
  return apiRequest<{ plans: WorkspacePlanSummary[] }>(path, { token });
}

export function createAdminPlan(
  token: string,
  payload: {
    code: "starter" | "pro" | "business";
    name: string;
    priceMonthly: number;
    monthlyCredits: number;
    agentLimit: number;
    whatsappNumberLimit: number;
    status?: "active" | "inactive";
  }
) {
  return apiRequest<{ plan: WorkspacePlanSummary }>("/api/admin/plans", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function updateAdminPlan(
  token: string,
  planId: string,
  payload: Partial<{
    name: string;
    priceMonthly: number;
    monthlyCredits: number;
    agentLimit: number;
    whatsappNumberLimit: number;
    status: "active" | "inactive";
  }>
) {
  return apiRequest<{ plan: WorkspacePlanSummary }>(`/api/admin/plans/${planId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload)
  });
}

export function fetchAdminWorkspaces(
  token: string,
  options?: { status?: "active" | "suspended" | "deleted"; limit?: number }
) {
  const params = new URLSearchParams();
  if (options?.status) {
    params.set("status", options.status);
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const path = query ? `/api/admin/workspaces?${query}` : "/api/admin/workspaces";
  return apiRequest<{ workspaces: AdminWorkspaceSummary[] }>(path, { token });
}

export function updateAdminWorkspaceStatus(
  token: string,
  workspaceId: string,
  payload: { status: "active" | "suspended" | "deleted"; reason?: string }
) {
  return apiRequest<{ workspace: AdminWorkspaceSummary }>(`/api/admin/workspaces/${workspaceId}/status`, {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function adjustAdminWorkspaceCredits(
  token: string,
  payload: { workspaceId: string; deltaCredits: number; reason?: string }
) {
  return apiRequest<{ wallet: WorkspaceCreditsResponse }>("/api/admin/credits/adjust", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function resetAdminWorkspaceWallet(
  token: string,
  payload: { workspaceId: string; reason?: string }
) {
  return apiRequest<{ wallet: WorkspaceCreditsResponse }>("/api/admin/credits/reset", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function fetchAdminModel(token: string) {
  return apiRequest<{
    currentModel: string;
    overrideModel: string | null;
    defaultModel: string;
    availableModels: string[];
  }>("/api/admin/model", { token });
}

export function updateAdminModel(token: string, model: string) {
  return apiRequest<{ ok: boolean; model: string }>("/api/admin/model", {
    method: "POST",
    token,
    body: JSON.stringify({ model })
  });
}

export function fetchMe(token: string) {
  return apiRequest<{ user: User }>("/api/auth/me", { token });
}

export function deleteMyAccount(token: string, payload: { confirmText: string }) {
  return apiRequest<{ ok: boolean }>("/api/auth/account/delete", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function fetchBillingPlans(options?: { includeUnconfigured?: boolean }) {
  const params = new URLSearchParams();
  if (options?.includeUnconfigured) {
    params.set("includeUnconfigured", "true");
  }
  const query = params.toString();
  const path = query ? `/api/billing/plans?${query}` : "/api/billing/plans";
  return apiRequest<{ keyIdAvailable: boolean; plans: BillingPlan[] }>(path);
}

export function fetchWorkspacePlans(options?: { includeInactive?: boolean }) {
  const params = new URLSearchParams();
  if (options?.includeInactive) {
    params.set("includeInactive", "true");
  }
  const query = params.toString();
  const path = query ? `/api/plans?${query}` : "/api/plans";
  return apiRequest<{ plans: WorkspacePlanSummary[] }>(path);
}

export function fetchWorkspaceCredits(token: string) {
  return apiRequest<WorkspaceCreditsResponse>("/api/workspace/credits", { token });
}

export function fetchMySubscription(token: string) {
  return apiRequest<{ subscription: BillingSubscriptionSummary | null }>("/api/billing/subscription", {
    token
  });
}

export function fetchMyPlanEntitlements(token: string) {
  return apiRequest<{ entitlements: PlanEntitlements; subscription: BillingSubscriptionSummary | null }>(
    "/api/billing/entitlements",
    { token }
  );
}

export function createBillingSubscription(
  token: string,
  payload: {
    planCode: BillingPlan["code"];
    trialDays?: number;
    totalCount?: number;
  }
) {
  return apiRequest<{
    keyId: string;
    alreadyExists: boolean;
    checkout: {
      subscriptionId: string;
      planCode: BillingPlan["code"];
      planLabel: string;
      amountInr: number;
    };
    subscription: BillingSubscriptionSummary;
  }>("/api/billing/subscription", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function cancelBillingSubscription(token: string, payload?: { atCycleEnd?: boolean }) {
  return apiRequest<{ subscription: BillingSubscriptionSummary }>("/api/billing/subscription/cancel", {
    method: "POST",
    token,
    body: JSON.stringify(payload ?? {})
  });
}

export function upgradeWorkspacePlan(
  token: string,
  payload: {
    planCode: BillingPlan["code"];
    trialDays?: number;
    totalCount?: number;
  }
) {
  return apiRequest<{
    keyId: string;
    alreadyExists: boolean;
    checkout: {
      subscriptionId: string;
      planCode: BillingPlan["code"];
      planLabel: string;
      amountInr: number;
    };
    subscription: BillingSubscriptionSummary;
  }>("/api/workspace/upgrade", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function createAddonCreditsOrder(token: string, payload: { credits: number }) {
  return apiRequest<{
    keyId: string;
    orderId: string;
    amountInr: number;
    amountPaise: number;
    currency: string;
    credits: number;
  }>("/api/workspace/addon", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export interface WorkspaceBillingOverview {
  workspaceId: string;
  workspaceName: string;
  plan: {
    code: string | null;
    name: string | null;
    priceMonthly: number;
    monthlyCredits: number;
  };
  subscription: {
    status: string | null;
    nextBillingDate: string | null;
  };
  credits: {
    total: number;
    used: number;
    remaining: number;
  };
  autoRecharge: {
    enabled: boolean;
    thresholdCredits: number;
    rechargeCredits: number;
    maxRechargesPerDay: number;
    lastTriggeredAt: string | null;
    lastStatus: string | null;
    failureCount: number;
  };
}

export interface WorkspaceBillingUsagePoint {
  month: string;
  spentCredits: number;
  channelBreakdown: {
    web: number;
    qr: number;
    api: number;
    unknown: number;
  };
}

export interface WorkspaceBillingUsageSeries {
  months: number;
  points: WorkspaceBillingUsagePoint[];
  totals: {
    spentCredits: number;
    web: number;
    qr: number;
    api: number;
    unknown: number;
  };
}

export interface WorkspaceBillingTransaction {
  createdAt: string;
  source: "credit_transaction" | "recharge_order" | "invoice";
  itemId: string;
  type: string;
  credits: number;
  amountPaise: number | null;
  currency: string | null;
  status: string | null;
  referenceId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
}

export interface WorkspaceRenewalHistoryItem {
  renewalId: string;
  renewedAt: string;
  creditsReset: number;
  planCode: string | null;
  planName: string | null;
  payment: {
    razorpayPaymentId: string | null;
    amountPaise: number | null;
    currency: string | null;
    status: string | null;
    paidAt: string | null;
  };
}

export interface WorkspaceBillingProfile {
  workspaceId: string;
  legalName: string | null;
  gstin: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string;
  billingEmail: string | null;
  billingPhone: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRechargeOrder {
  rechargeOrderId: string;
  keyId: string;
  razorpayOrderId: string;
  currency: string;
  credits: number;
  amountTotalPaise: number;
  amountTaxablePaise: number;
  gstAmountPaise: number;
  gstRatePercent: number;
}

export interface WorkspaceAutoRechargeSettings {
  workspaceId: string;
  enabled: boolean;
  thresholdCredits: number;
  rechargeCredits: number;
  maxRechargesPerDay: number;
  gatewayCustomerId: string | null;
  gatewayTokenId: string | null;
  lastTriggeredAt: string | null;
  lastStatus: string | null;
  failureCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceBillingInvoice {
  id: string;
  invoiceNumber: string;
  invoiceType: "subscription" | "recharge";
  sourceType: "subscription_payment" | "recharge_order";
  sourceId: string;
  currency: string;
  totalPaise: number;
  taxablePaise: number;
  gstPaise: number;
  status: "issued" | "void";
  createdAt: string;
}

async function downloadBinaryFile(
  path: string,
  token: string,
  options?: { method?: "GET" | "POST"; body?: BodyInit | null }
): Promise<{ blob: Blob; filename: string }> {
  const hasJsonBody =
    options?.body !== undefined && options?.body !== null && !(options.body instanceof FormData);
  const response = await fetch(`${API_URL}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {})
    },
    body: options?.body ?? null
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error((payload as { error?: string }).error || `Request failed: ${response.status}`);
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get("content-disposition") ?? "";
  const match = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  const filename = match?.[1] ?? "download.bin";
  return { blob, filename };
}

export function fetchWorkspaceBillingOverview(token: string) {
  return apiRequest<{ overview: WorkspaceBillingOverview }>("/api/workspace/billing/overview", { token });
}

export function fetchWorkspaceBillingUsage(token: string, options?: { months?: number }) {
  const params = new URLSearchParams();
  if (typeof options?.months === "number") {
    params.set("months", String(options.months));
  }
  const query = params.toString();
  const path = query ? `/api/workspace/billing/usage?${query}` : "/api/workspace/billing/usage";
  return apiRequest<{ usage: WorkspaceBillingUsageSeries }>(path, { token });
}

export function fetchWorkspaceBillingTransactions(
  token: string,
  options?: { cursor?: string | null; limit?: number; type?: string | null }
) {
  const params = new URLSearchParams();
  if (options?.cursor) {
    params.set("cursor", options.cursor);
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  if (options?.type) {
    params.set("type", options.type);
  }
  const query = params.toString();
  const path = query ? `/api/workspace/billing/transactions?${query}` : "/api/workspace/billing/transactions";
  return apiRequest<{ items: WorkspaceBillingTransaction[]; nextCursor: string | null }>(path, { token });
}

export function fetchWorkspaceBillingRenewals(token: string, options?: { limit?: number }) {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const path = query ? `/api/workspace/billing/renewals?${query}` : "/api/workspace/billing/renewals";
  return apiRequest<{ renewals: WorkspaceRenewalHistoryItem[] }>(path, { token });
}

export function fetchWorkspaceBillingProfile(token: string) {
  return apiRequest<{ profile: WorkspaceBillingProfile }>("/api/workspace/billing/profile", { token });
}

export function updateWorkspaceBillingProfile(
  token: string,
  payload: Partial<{
    legalName: string | null;
    gstin: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    country: string | null;
    billingEmail: string | null;
    billingPhone: string | null;
    metadata: Record<string, unknown>;
  }>
) {
  return apiRequest<{ profile: WorkspaceBillingProfile }>("/api/workspace/billing/profile", {
    method: "PUT",
    token,
    body: JSON.stringify(payload)
  });
}

export function createWorkspaceBillingRechargeOrder(token: string, payload: { credits: number }) {
  return apiRequest<{ order: WorkspaceRechargeOrder }>("/api/workspace/billing/recharge/order", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function fetchWorkspaceAutoRechargeSettings(token: string) {
  return apiRequest<{ settings: WorkspaceAutoRechargeSettings }>("/api/workspace/billing/recharge/auto", { token });
}

export function upsertWorkspaceAutoRechargeSettings(
  token: string,
  payload: {
    enabled: boolean;
    thresholdCredits: number;
    rechargeCredits: number;
    maxRechargesPerDay: number;
    gatewayCustomerId?: string | null;
    gatewayTokenId?: string | null;
  }
) {
  return apiRequest<{ settings: WorkspaceAutoRechargeSettings }>("/api/workspace/billing/recharge/auto", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function disableWorkspaceAutoRecharge(token: string) {
  return apiRequest<{ settings: WorkspaceAutoRechargeSettings }>("/api/workspace/billing/recharge/auto/disable", {
    method: "POST",
    token
  });
}

export function fetchWorkspaceBillingInvoices(token: string, options?: { limit?: number }) {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const path = query ? `/api/workspace/billing/invoices?${query}` : "/api/workspace/billing/invoices";
  return apiRequest<{ invoices: WorkspaceBillingInvoice[] }>(path, { token });
}

export async function downloadWorkspaceBillingInvoice(token: string, invoiceId: string): Promise<{ blob: Blob; filename: string }> {
  return downloadBinaryFile(`/api/workspace/billing/invoices/${invoiceId}/download`, token);
}

export function connectWhatsApp(token: string, options?: { resetAuth?: boolean }) {
  return apiRequest<{ ok: boolean }>("/api/whatsapp/connect", {
    method: "POST",
    token,
    body: JSON.stringify({ resetAuth: Boolean(options?.resetAuth) })
  });
}

export function disconnectWhatsApp(token: string) {
  return apiRequest<{ ok: boolean }>("/api/whatsapp/disconnect", {
    method: "POST",
    token
  });
}

export function fetchWhatsAppStatus(token: string) {
  return apiRequest<{ status: string; phoneNumber: string | null; hasQr: boolean; qr: string | null }>(
    "/api/whatsapp/status",
    { token }
  );
}

export interface MetaBusinessConfig {
  configured: boolean;
  appId: string | null;
  embeddedSignupConfigId: string | null;
  redirectUri: string;
  graphVersion: string;
  webhookPath: string;
  pricing: {
    platformFeeInrMonthly: number;
    metaConversationChargesSeparate: boolean;
  };
}

export interface MetaBusinessConnection {
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

export interface MetaBusinessStatus {
  connected: boolean;
  connection: MetaBusinessConnection | null;
}

export interface CompleteMetaSignupPayload {
  code: string;
  redirectUri?: string;
  metaBusinessId?: string;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
}

export function fetchMetaBusinessConfig(token: string) {
  return apiRequest<MetaBusinessConfig>("/api/meta/business/config", { token });
}

export function fetchMetaBusinessStatus(token: string, options?: { forceRefresh?: boolean }) {
  const params = new URLSearchParams();
  if (options?.forceRefresh) {
    params.set("forceRefresh", "true");
  }
  const query = params.toString();
  const path = query ? `/api/meta/business/status?${query}` : "/api/meta/business/status";
  return apiRequest<MetaBusinessStatus>(path, { token });
}

export function completeMetaBusinessSignup(token: string, payload: CompleteMetaSignupPayload) {
  return apiRequest<{ ok: boolean; connection: MetaBusinessConnection }>("/api/meta/business/complete", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function disconnectMetaBusiness(token: string, payload?: { connectionId?: string }) {
  return apiRequest<{ ok: boolean }>("/api/meta/business/disconnect", {
    method: "POST",
    token,
    body: JSON.stringify(payload ?? {})
  });
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
  supportEmail: string;
  aiDoRules: string;
  aiDontRules: string;
  escalationWhenToEscalate: string;
  escalationContactPerson: string;
  escalationPhoneNumber: string;
  escalationEmail: string;
  websiteUrl?: string;
  manualFaq?: string;
}

export interface AgentProfilePayload {
  name: string;
  channelType: "web" | "qr" | "api";
  linkedNumber: string;
  businessBasics: BusinessBasicsPayload;
  personality: User["personality"];
  customPrompt?: string;
  objectiveType: "lead" | "feedback" | "complaint" | "hybrid";
  taskDescription: string;
  isActive?: boolean;
}

export interface AgentProfile {
  id: string;
  userId: string;
  name: string;
  channelType: "web" | "qr" | "api";
  linkedNumber: string;
  businessBasics: BusinessBasicsPayload;
  personality: User["personality"];
  customPrompt: string | null;
  objectiveType: "lead" | "feedback" | "complaint" | "hybrid";
  taskDescription: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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
  source_type: "file" | "pdf" | "website" | "manual";
  status: "queued" | "processing" | "completed" | "failed";
  stage: string;
  progress: number;
  chunks_created: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function ingestKnowledgeFiles(token: string, files: File[]) {
  const form = new FormData();
  for (const file of files) {
    form.append("file", file);
  }

  return apiRequest<{ ok: boolean; jobs: KnowledgeIngestJob[] }>("/api/knowledge/ingest/files", {
    method: "POST",
    token,
    body: form,
    timeoutMs: 5 * 60_000
  });
}

// Backward-compatible alias. Use ingestKnowledgeFiles for all supported formats.
export const ingestPdf = ingestKnowledgeFiles;

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
  source_type: "file" | "pdf" | "website" | "manual";
  source_name: string | null;
  chunks: number;
  last_ingested_at: string;
}

export interface KnowledgeChunkPreview {
  id: string;
  content_chunk: string;
  source_type: "file" | "pdf" | "website" | "manual";
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

export interface TestChatHistoryItem {
  sender: "user" | "bot";
  text: string;
}

export function requestTestChatbotReply(
  token: string,
  payload: {
    message: string;
    history?: TestChatHistoryItem[];
    phone?: string;
  }
) {
  return apiRequest<{
    ok: boolean;
    reply: string;
    model: string | null;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
    retrievalChunks: number;
  }>("/api/onboarding/test-chat", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function fetchAgentProfiles(token: string) {
  return apiRequest<{ profiles: AgentProfile[] }>("/api/agents/profiles", { token });
}

export function createAgentProfile(token: string, payload: AgentProfilePayload) {
  return apiRequest<{ ok: boolean; profile: AgentProfile }>("/api/agents/profiles", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function updateAgentProfile(token: string, profileId: string, payload: AgentProfilePayload) {
  return apiRequest<{ ok: boolean; profile: AgentProfile }>(`/api/agents/profiles/${profileId}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload)
  });
}

export function deleteAgentProfile(token: string, profileId: string) {
  return apiRequest<{ ok: boolean }>(`/api/agents/profiles/${profileId}`, {
    method: "DELETE",
    token
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
  metaApi: MetaBusinessStatus;
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
  contact_phone?: string | null;
  contact_email?: string | null;
  assigned_agent_name?: string | null;
  assigned_agent_profile_id: string | null;
  channel_type: "web" | "qr" | "api";
  channel_linked_number: string | null;
  lead_kind: "lead" | "feedback" | "complaint" | "other";
  classification_confidence: number;
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

export interface LeadConversation extends Conversation {
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  assigned_agent_name: string | null;
  requires_reply: boolean;
  ai_summary: string;
  summary_status: "ready" | "missing" | "stale";
  summary_updated_at: string | null;
}

export type ContactType = "lead" | "feedback" | "complaint" | "other";
export type ContactSourceType = "manual" | "import" | "web" | "qr" | "api";

export interface ContactRecord {
  id: string;
  display_name: string | null;
  phone_number: string;
  email: string | null;
  contact_type: ContactType;
  tags: string[];
  order_date: string | null;
  source_type: ContactSourceType;
  source_id: string | null;
  source_url: string | null;
  linked_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactImportResult {
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export function fetchContacts(
  token: string,
  options?: { q?: string; type?: ContactType; source?: ContactSourceType; limit?: number }
) {
  const params = new URLSearchParams();
  if (options?.q) {
    params.set("q", options.q);
  }
  if (options?.type) {
    params.set("type", options.type);
  }
  if (options?.source) {
    params.set("source", options.source);
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const path = query ? `/api/contacts?${query}` : "/api/contacts";
  return apiRequest<{ contacts: ContactRecord[] }>(path, { token });
}

export function createContact(
  token: string,
  payload: {
    name: string;
    phone: string;
    email?: string;
    type?: ContactType;
    tags?: string[];
    orderDate?: string;
    sourceId?: string;
    sourceUrl?: string;
  }
) {
  return apiRequest<{ contact: ContactRecord }>("/api/contacts", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function importContactsWorkbook(token: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return apiRequest<ContactImportResult>("/api/contacts/import", {
    method: "POST",
    token,
    body: form,
    timeoutMs: 120_000
  });
}

export function downloadContactsTemplate(token: string): Promise<{ blob: Blob; filename: string }> {
  return downloadBinaryFile("/api/contacts/template", token);
}

export function exportContactsWorkbook(
  token: string,
  payload: {
    ids?: string[];
    filters?: { q?: string; type?: ContactType; source?: ContactSourceType; limit?: number };
  }
): Promise<{ blob: Blob; filename: string }> {
  return downloadBinaryFile("/api/contacts/export", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function fetchLeadConversations(
  token: string,
  options?: {
    limit?: number;
    stage?: "hot" | "warm" | "cold";
    kind?: "lead" | "feedback" | "complaint" | "other";
    channelType?: "web" | "qr" | "api";
    todayOnly?: boolean;
    requiresReply?: boolean;
  }
) {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  if (options?.stage) {
    params.set("stage", options.stage);
  }
  if (options?.kind) {
    params.set("kind", options.kind);
  }
  if (options?.channelType) {
    params.set("channelType", options.channelType);
  }
  if (typeof options?.todayOnly === "boolean") {
    params.set("todayOnly", options.todayOnly ? "true" : "false");
  }
  if (typeof options?.requiresReply === "boolean") {
    params.set("requiresReply", options.requiresReply ? "true" : "false");
  }
  const query = params.toString();
  const path = query ? `/api/conversations/leads?${query}` : "/api/conversations/leads";
  return apiRequest<{ leads: LeadConversation[] }>(path, { token, timeoutMs: 120_000 });
}

export function summarizeLeadConversations(
  token: string,
  options?: { limit?: number; forceAll?: boolean }
) {
  return apiRequest<{
    ok: true;
    processed: number;
    updated: number;
    skipped: number;
    failed: number;
  }>("/api/conversations/leads/summarize", {
    method: "POST",
    token,
    body: JSON.stringify({
      limit: options?.limit,
      forceAll: options?.forceAll
    }),
    timeoutMs: 120_000
  });
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
  media_url: string | null;
  message_type: string;
  message_content: Record<string, unknown> | null;
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

export function assignConversationAgent(
  token: string,
  conversationId: string,
  agentProfileId: string | null
) {
  return apiRequest<{ ok: boolean }>(`/api/conversations/${conversationId}/assign-agent`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ agentProfileId })
  });
}

export interface PublishedFlowSummary {
  id: string;
  name: string;
}

export function fetchPublishedFlows(token: string) {
  return apiRequest<PublishedFlowSummary[]>("/api/flows/published", { token });
}

export function assignFlowToConversation(token: string, flowId: string, conversationId: string) {
  return apiRequest<{ sessionId: string; flowId: string; flowName: string }>(`/api/flows/${flowId}/assign`, {
    method: "POST",
    token,
    body: JSON.stringify({ conversationId })
  });
}

export function sendConversationManualMessage(
  token: string,
  conversationId: string,
  text: string,
  options?: { lockToManual?: boolean; mediaUrl?: string | null; mediaMimeType?: string | null }
) {
  return apiRequest<{
    ok: boolean;
    delivered: {
      conversationId: string;
      channelType: "web" | "qr" | "api";
      delivered: boolean;
    };
  }>(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    token,
    body: JSON.stringify({
      text,
      mediaUrl: options?.mediaUrl ?? undefined,
      mediaMimeType: options?.mediaMimeType ?? undefined,
      lockToManual: options?.lockToManual
    })
  });
}

export async function uploadConversationMedia(
  token: string,
  conversationId: string,
  file: File
): Promise<{ mediaId: string; url: string; mimeType: string }> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_URL}/api/conversations/${conversationId}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Upload failed" }));
    throw new Error((err as { error?: string }).error ?? "Upload failed");
  }
  return response.json() as Promise<{ mediaId: string; url: string; mimeType: string }>;
}

export interface AiReviewQueueItem {
  id: string;
  user_id: string;
  conversation_id: string | null;
  customer_phone: string;
  question: string;
  ai_response: string;
  confidence_score: number;
  trigger_signals: string[];
  status: "pending" | "resolved";
  resolution_answer: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export function fetchAiReviewQueue(
  token: string,
  options?: { status?: "all" | "pending" | "resolved"; limit?: number }
) {
  const params = new URLSearchParams();
  if (options?.status) {
    params.set("status", options.status);
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const path = query ? `/api/ai-review/queue?${query}` : "/api/ai-review/queue";
  return apiRequest<{ queue: AiReviewQueueItem[] }>(path, { token });
}

export function resolveAiReviewQueueItem(
  token: string,
  reviewId: string,
  payload: { resolutionAnswer?: string; addToKnowledgeBase?: boolean }
) {
  return apiRequest<{
    ok: boolean;
    item: AiReviewQueueItem;
    knowledgeChunks: number;
  }>(`/api/ai-review/${reviewId}/resolve`, {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

// ─── Message Templates ────────────────────────────────────────────────────────

export type TemplateStatus = "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "DISABLED";
export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export type TemplateStyle = "normal" | "poetic" | "exciting" | "funny";

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
  category: TemplateCategory;
  language: string;
  status: TemplateStatus;
  qualityScore: string | null;
  components: TemplateComponent[];
  metaRejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplatePayload {
  connectionId: string;
  name: string;
  category: TemplateCategory;
  language: string;
  components: TemplateComponent[];
}

export interface GeneratedTemplate {
  suggestedName: string;
  suggestedCategory: TemplateCategory;
  components: TemplateComponent[];
}

export function fetchTemplates(token: string, options?: { connectionId?: string; status?: TemplateStatus }) {
  const params = new URLSearchParams();
  if (options?.connectionId) params.set("connectionId", options.connectionId);
  if (options?.status) params.set("status", options.status);
  const query = params.toString();
  const path = query ? `/api/meta/templates?${query}` : "/api/meta/templates";
  return apiRequest<{ templates: MessageTemplate[] }>(path, { token });
}

export function createMessageTemplate(token: string, payload: CreateTemplatePayload) {
  return apiRequest<{ template: MessageTemplate }>("/api/meta/templates", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function syncMessageTemplates(token: string) {
  return apiRequest<{ ok: boolean; templates: MessageTemplate[] }>("/api/meta/templates/sync", {
    method: "POST",
    token
  });
}

export function deleteMessageTemplate(token: string, templateId: string) {
  return apiRequest<{ ok: boolean }>(`/api/meta/templates/${templateId}`, {
    method: "DELETE",
    token
  });
}

export function generateAITemplate(
  token: string,
  payload: { prompt: string; style: TemplateStyle }
) {
  return apiRequest<{ generated: GeneratedTemplate }>("/api/meta/templates/ai-generate", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function uploadTemplateMedia(token: string, connectionId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return apiRequest<{ handle: string }>(
    `/api/meta/templates/upload-media?connectionId=${encodeURIComponent(connectionId)}`,
    { method: "POST", token, body: form }
  );
}


// ── Contact Fields ────────────────────────────────────────────────────────────

export type ContactFieldType = "TEXT" | "MULTI_TEXT" | "NUMBER" | "SWITCH" | "DATE";

export interface ContactField {
  id: string;
  label: string;
  name: string;
  field_type: ContactFieldType;
  is_active: boolean;
  is_mandatory: boolean;
  sort_order: number;
  created_at: string;
}

export function listContactFields(token: string) {
  return apiRequest<{ fields: ContactField[] }>("/api/contact-fields", { token });
}

export function createContactField(
  token: string,
  payload: { label: string; name: string; field_type: ContactFieldType; is_active?: boolean; is_mandatory?: boolean }
) {
  return apiRequest<{ field: ContactField }>("/api/contact-fields", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function updateContactField(
  token: string,
  fieldId: string,
  patch: { label?: string; is_active?: boolean; is_mandatory?: boolean }
) {
  return apiRequest<{ field: ContactField }>(`/api/contact-fields/${fieldId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(patch)
  });
}

export function deleteContactField(token: string, fieldId: string) {
  return apiRequest<void>(`/api/contact-fields/${fieldId}`, { method: "DELETE", token });
}
