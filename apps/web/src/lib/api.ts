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

export function fetchGoogleSheetsConnectionById(token: string, connectionId: string) {
  return apiRequest<{ connection: { id: string; googleEmail: string; displayName: string | null; status: string } | null }>(
    `/api/google/sheets/connections/${encodeURIComponent(connectionId)}`,
    { token }
  );
}

export function fetchGoogleCalendarConnectionById(token: string, connectionId: string) {
  return apiRequest<{ connection: { id: string; googleEmail: string; displayName: string | null; status: string } | null }>(
    `/api/google/calendar/connections/${encodeURIComponent(connectionId)}`,
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
  phone_number: string | null;
  phone_verified: boolean;
  ai_token_balance: number;
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

export interface AiProviderMeta {
  id: "openai" | "anthropic" | "gemini";
  label: string;
  chatModels: string[];
  supportsEmbeddings: boolean;
  supportsVision: boolean;
}

export function fetchAdminProvider(token: string) {
  return apiRequest<{
    providers: AiProviderMeta[];
    active: { provider: string; model: string | null; hasApiKey: boolean } | null;
  }>("/api/admin/provider", { token });
}

export function updateAdminProvider(
  token: string,
  payload: { provider: string; apiKey: string; model?: string }
) {
  return apiRequest<{ ok: boolean; provider: string }>("/api/admin/provider", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function clearAdminProvider(token: string) {
  return apiRequest<{ ok: boolean }>("/api/admin/provider", {
    method: "DELETE",
    token
  });
}

export function testAdminProvider(token: string) {
  return apiRequest<
    | { ok: true; provider: string; model: string; reply: string; latencyMs: number }
    | { ok: false; provider: string; error: string }
  >("/api/admin/provider/test", { method: "POST", token });
}

export interface AiWalletStatus {
  balance: number;
  planCode: string;
  monthlyQuota: number;
  canUseAiGeneration: boolean;
  isLow: boolean;
}

export interface AiLedgerRow {
  id: string;
  amount: number;
  action_type: string;
  reference_id: string | null;
  balance_after: number;
  created_at: string;
}

export interface AiUsageByAction {
  action_type: string;
  tokens_used: number;
  calls: number;
}

export interface AiUsageByDay {
  day: string;
  tokens_used: number;
  calls: number;
}

export function fetchAiWallet(token: string) {
  return apiRequest<{
    status: AiWalletStatus;
    ledger: AiLedgerRow[];
    usageByAction: AiUsageByAction[];
    usageByDay: AiUsageByDay[];
  }>("/api/auth/ai-wallet", { token });
}

export function fetchMe(token: string) {
  return apiRequest<{ user: User }>("/api/auth/me", { token });
}

export function updateMyProfile(
  token: string,
  payload: {
    name?: string;
    businessType?: string;
    companyName?: string;
    websiteUrl?: string;
    supportEmail?: string;
    phoneNumber?: string;
    phoneVerified?: boolean;
  }
) {
  return apiRequest<{ user: User }>("/api/auth/me", {
    method: "PATCH",
    token,
    body: JSON.stringify(payload)
  });
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

export function setWhatsAppChannelEnabled(token: string, enabled: boolean) {
  return apiRequest<{ ok: boolean }>("/api/whatsapp/channel", {
    method: "POST",
    token,
    body: JSON.stringify({ enabled })
  });
}

export function fetchWhatsAppStatus(token: string) {
  return apiRequest<{
    enabled: boolean;
    status: string;
    phoneNumber: string | null;
    hasQr: boolean;
    qr: string | null;
    needsRelink?: boolean;
    statusMessage?: string | null;
  }>(
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
  sharedBillingSupported: boolean;
  sharedBillingRequired: boolean;
  sharedBillingCurrency: string | null;
  partnerBusinessId: string | null;
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
  connection: MetaBusinessConnection | null;
  connections: MetaBusinessConnection[];
}

export type ChannelDefaultReplyMode = "manual" | "flow" | "ai";

export interface ChannelDefaultReplyConfig {
  channel: "web" | "qr" | "api";
  mode: ChannelDefaultReplyMode;
  flowId: string | null;
  agentProfileId: string | null;
  invalidReplyLimit: number;
  source: "explicit" | "legacy_flow_ai" | "legacy_default_flow" | "default";
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

export function fetchMetaBusinessConnections(token: string, options?: { forceRefresh?: boolean }) {
  const params = new URLSearchParams();
  if (options?.forceRefresh) {
    params.set("forceRefresh", "true");
  }
  const query = params.toString();
  const path = query ? `/api/meta/business/connections?${query}` : "/api/meta/business/connections";
  return apiRequest<{ connections: MetaBusinessConnection[] }>(path, { token });
}

export function fetchChannelDefaultReply(token: string, channel: "web" | "qr" | "api") {
  return apiRequest<{ config: ChannelDefaultReplyConfig }>(`/api/channels/default-reply/${channel}`, {
    token
  });
}

export function saveChannelDefaultReply(
  token: string,
  channel: "web" | "qr" | "api",
  payload: {
    mode: ChannelDefaultReplyMode;
    flowId?: string | null;
    agentProfileId?: string | null;
    invalidReplyLimit?: number | null;
  }
) {
  return apiRequest<{ ok: boolean; config: ChannelDefaultReplyConfig }>(
    `/api/channels/default-reply/${channel}`,
    {
      method: "PUT",
      token,
      body: JSON.stringify(payload)
    }
  );
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

export function setMetaBusinessChannelEnabled(
  token: string,
  payload: { enabled: boolean; connectionId?: string }
) {
  return apiRequest<{ ok: boolean; connection: MetaBusinessConnection | null }>("/api/meta/business/channel", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function fetchMetaBusinessProfile(token: string, options?: { connectionId?: string }) {
  const params = new URLSearchParams();
  if (options?.connectionId) {
    params.set("connectionId", options.connectionId);
  }
  const query = params.toString();
  const path = query ? `/api/meta/business/profile?${query}` : "/api/meta/business/profile";
  return apiRequest<{ profile: MetaBusinessProfile }>(path, { token });
}

export function updateMetaBusinessProfile(
  token: string,
  payload: {
    connectionId?: string;
    address?: string | null;
    businessDescription?: string | null;
    email?: string | null;
    vertical?: string | null;
    websiteUrl?: string | null;
    about?: string | null;
    profilePictureHandle?: string | null;
  }
) {
  return apiRequest<{ ok: boolean; profile: MetaBusinessProfile }>("/api/meta/business/profile", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function uploadMetaBusinessProfileLogo(token: string, file: File, options?: { connectionId?: string }) {
  const params = new URLSearchParams();
  if (options?.connectionId) {
    params.set("connectionId", options.connectionId);
  }
  const formData = new FormData();
  formData.append("file", file);
  const query = params.toString();
  const path = query ? `/api/meta/business/profile/logo?${query}` : "/api/meta/business/profile/logo";
  return apiRequest<{ ok: boolean; connectionId: string; phoneNumberId: string; handle: string }>(path, {
    method: "POST",
    token,
    body: formData
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
    enabled: boolean;
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
  unread_count?: number;
  visitor_online?: boolean;
}

export function fetchConversations(token: string) {
  return apiRequest<{ conversations: Conversation[] }>("/api/conversations", { token });
}

export function createOutboundConversation(
  token: string,
  contactId: string,
  channelType: "qr" | "api",
  connectionId?: string | null
) {
  return apiRequest<{ conversationId: string }>("/api/conversations/outbound", {
    method: "POST",
    token,
    body: JSON.stringify({ contactId, channelType, connectionId: connectionId ?? null })
  });
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

export interface ContactFieldValue {
  field_id: string;
  field_name: string;
  field_label: string;
  field_type: string;
  value: string | null;
}

export interface ContactRecord {
  id: string;
  display_name: string | null;
  phone_number: string;
  email: string | null;
  contact_type: ContactType;
  tags: string[];
  marketing_consent_status: "unknown" | "subscribed" | "unsubscribed" | "revoked";
  marketing_consent_recorded_at: string | null;
  marketing_consent_source: string | null;
  marketing_consent_text: string | null;
  marketing_consent_proof_ref: string | null;
  marketing_unsubscribed_at: string | null;
  marketing_unsubscribe_source: string | null;
  global_opt_out_at: string | null;
  last_incoming_message_at: string | null;
  last_outgoing_template_at: string | null;
  last_outgoing_marketing_at: string | null;
  last_outgoing_utility_at: string | null;
  source_type: ContactSourceType;
  source_id: string | null;
  source_url: string | null;
  linked_conversation_id: string | null;
  created_at: string;
  updated_at: string;
  custom_field_values: ContactFieldValue[];
}

export interface ContactImportResult {
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export interface ContactImportPreview {
  columns: string[];
  sampleRows: Array<Record<string, string>>;
  suggestedMapping: Record<string, string>;
}

export type ContactImportColumnMapping = Record<string, string>;

export function fetchContacts(
  token: string,
  options?: { q?: string; type?: ContactType; source?: ContactSourceType; tag?: string; consent?: string; limit?: number }
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
  if (options?.tag) {
    params.set("tag", options.tag);
  }
  if (options?.consent) {
    params.set("consent", options.consent);
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
    sourceId?: string;
    sourceUrl?: string;
    customFields?: Record<string, string>;
    marketingConsentStatus?: "unknown" | "subscribed" | "unsubscribed" | "revoked";
    marketingConsentRecordedAt?: string;
    marketingConsentSource?: string;
    marketingConsentText?: string;
    marketingConsentProofRef?: string;
  }
) {
  return apiRequest<{ contact: ContactRecord }>("/api/contacts", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function fetchContactByConversation(token: string, conversationId: string) {
  return apiRequest<{ contact: ContactRecord }>(`/api/contacts/by-conversation/${conversationId}`, { token });
}

export function previewContactsImportWorkbook(token: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return apiRequest<{ ok: boolean; preview: ContactImportPreview }>("/api/contacts/import/preview", {
    method: "POST",
    token,
    body: form,
    timeoutMs: 120_000
  });
}

export function importContactsWorkbook(
  token: string,
  file: File,
  options?: { mapping?: ContactImportColumnMapping }
) {
  const form = new FormData();
  form.append("file", file);
  if (options?.mapping) {
    form.append("mapping", JSON.stringify(options.mapping));
  }
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
    filters?: { q?: string; type?: ContactType; source?: ContactSourceType; tag?: string; limit?: number };
    columns?: string[];
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

export function markConversationRead(token: string, conversationId: string) {
  return apiRequest<{ ok: boolean; unreadCount: number }>(`/api/conversations/${conversationId}/read`, {
    method: "POST",
    token
  });
}

export interface ConversationNote {
  id: string;
  conversation_id: string;
  user_id: string;
  author_name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function fetchConversationNotes(token: string, conversationId: string) {
  return apiRequest<{ notes: ConversationNote[] }>(`/api/conversations/${conversationId}/notes`, { token });
}

export function createConversationNote(token: string, conversationId: string, content: string) {
  return apiRequest<{ note: ConversationNote }>(`/api/conversations/${conversationId}/notes`, {
    method: "POST",
    token,
    body: JSON.stringify({ content })
  });
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
  channel: "web" | "qr" | "api";
}

export type GeneratedFlowChannel = "web" | "qr" | "api";

export interface GeneratedFlowTrigger {
  id: string;
  type: "keyword" | "any_message" | "template_reply" | "qr_start" | "website_start";
  value: string;
}

export interface GeneratedFlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface GeneratedFlowEdge {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
}

export interface GenerateFlowDraftRequest {
  prompt: string;
  channel: GeneratedFlowChannel;
}

export interface GenerateFlowDraftResponse {
  name: string;
  channel: GeneratedFlowChannel;
  nodes: GeneratedFlowNode[];
  edges: GeneratedFlowEdge[];
  triggers: GeneratedFlowTrigger[];
  warnings: string[];
}

export function generateFlowDraft(token: string, payload: GenerateFlowDraftRequest) {
  return apiRequest<GenerateFlowDraftResponse>("/api/flows/generate-draft", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function fetchPublishedFlows(token: string) {
  return apiRequest<PublishedFlowSummary[]>("/api/flows/published", { token });
}

export function sendTestTemplate(
  token: string,
  payload: {
    templateId: string;
    to: string;
    variableValues?: Record<string, string>;
  }
) {
  return apiRequest<{ ok: boolean; messageId: string | null }>("/api/meta/templates/test-send", {
    method: "POST",
    token,
    body: JSON.stringify({
      templateId: payload.templateId,
      to: payload.to,
      variableValues: payload.variableValues ?? {}
    })
  });
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
  recurrence_count: number;
  created_at: string;
}

export interface AiReviewAuditLogItem {
  id: string;
  user_id: string;
  question: string;
  ai_response: string;
  confidence_score: number;
  triage_category: "noise" | "monitor";
  dismiss_reason: string;
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

export function fetchAiReviewAuditLog(
  token: string,
  options?: { limit?: number }
) {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const path = query ? `/api/ai-review/audit-log?${query}` : "/api/ai-review/audit-log";
  return apiRequest<{ items: AiReviewAuditLogItem[] }>(path, { token });
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
  linkedNumber: string | null;
  displayPhoneNumber: string | null;
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

export function uploadTemplateMedia(
  token: string,
  connectionId: string,
  mediaType: "IMAGE" | "VIDEO" | "DOCUMENT",
  file: File
) {
  const form = new FormData();
  form.append("file", file);
  return apiRequest<{ handle: string }>(
    `/api/meta/templates/upload-media?connectionId=${encodeURIComponent(connectionId)}&mediaType=${encodeURIComponent(mediaType)}`,
    { method: "POST", token, body: form }
  );
}

export function sendConversationTemplate(
  token: string,
  conversationId: string,
  templateId: string,
  variableValues?: Record<string, string>
) {
  return apiRequest<{ ok: boolean; messageId: string | null }>(
    `/api/conversations/${conversationId}/send-template`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ templateId, variableValues: variableValues ?? {} })
    }
  );
}

export function sendTestTemplateMessage(
  token: string,
  payload: { templateId: string; to: string; variableValues: Record<string, string> }
) {
  return apiRequest<{ ok: boolean; messageId: string | null }>("/api/meta/templates/test-send", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "cancelled";
export type CampaignMessageStatus = "queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "skipped";
export type CampaignTemplateVariableSource = "contact" | "static";
export type BroadcastType = "standard" | "retarget";
export type RetargetStatus = "sent" | "delivered" | "read" | "failed" | "skipped";

export interface CampaignTemplateVariableBinding {
  source: CampaignTemplateVariableSource;
  field?: string;
  value?: string;
  fallback?: string;
}

export type CampaignTemplateVariables = Record<string, CampaignTemplateVariableBinding>;
export type CampaignAudienceSource = Record<string, unknown>;
export type CampaignMediaOverrides = Record<string, string>;

export interface Campaign {
  id: string;
  user_id: string;
  name: string;
  status: CampaignStatus;
  broadcast_type: BroadcastType;
  connection_id: string | null;
  template_id: string | null;
  template_variables: CampaignTemplateVariables;
  target_segment_id: string | null;
  source_campaign_id: string | null;
  retarget_status: RetargetStatus | null;
  audience_source_json: CampaignAudienceSource;
  media_overrides_json: CampaignMediaOverrides;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_count: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  skipped_count: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignMessage {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  phone_number: string;
  wamid: string | null;
  status: CampaignMessageStatus;
  retry_count: number;
  next_retry_at: string | null;
  error_code: string | null;
  error_message: string | null;
  resolved_variables_json: Record<string, string> | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BroadcastSummary {
  totalBroadcasts: number;
  recipients: number;
  sent: number;
  delivered: number;
  engaged: number;
  failed: number;
  suppressed: number;
  frequencyLimited: number;
}

export interface BroadcastReport {
  campaign: Campaign;
  messages: CampaignMessage[];
  total: number;
  buckets: Record<RetargetStatus, number>;
}

export interface CampaignLaunchPreview {
  eligibleCount: number;
  ineligibleCount: number;
  reasons: Array<{ code: string; count: number; label: string }>;
  sampleBlockedContacts: Array<{
    contactId: string | null;
    phoneNumber: string;
    displayName: string | null;
    reasonCodes: string[];
    nextAllowedAt: string | null;
  }>;
}

export interface BroadcastRetargetPreview {
  campaign: Campaign;
  status: RetargetStatus;
  recipients: ContactRecord[];
  count: number;
}

export interface BroadcastAudienceImportResponse {
  ok: boolean;
  importResult: ContactImportResult;
  segment: ContactSegment;
  batchTag: string;
}

export interface BroadcastAudienceImportPreviewResponse {
  ok: boolean;
  preview: ContactImportPreview;
}

export interface BroadcastAudienceImportOptions {
  segmentName?: string;
  marketingOptIn?: boolean;
  phoneNumberFormat?: "with_country_code" | "without_country_code";
  defaultCountryCode?: string;
  mapping?: ContactImportColumnMapping;
}

export interface CampaignDeliveryAnalytics {
  campaignId: string;
  counts: {
    total: number;
    queued: number;
    sending: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    skipped: number;
  };
  retries: {
    totalAttempts: number;
    retryAttempts: number;
    pendingRetries: number;
  };
  failureRate: number;
  topErrors: Array<{
    errorCode: string | null;
    errorMessage: string | null;
    count: number;
  }>;
}

export type DeliveryAlertType = "high_failure_rate" | "webhook_delay" | "api_downtime";
export type DeliveryAlertSeverity = "info" | "warning" | "critical";
export type DeliveryAlertStatus = "open" | "resolved";

export interface DeliveryAlert {
  id: string;
  user_id: string;
  campaign_id: string | null;
  connection_id: string | null;
  alert_type: DeliveryAlertType;
  severity: DeliveryAlertSeverity;
  status: DeliveryAlertStatus;
  summary: string;
  details_json: Record<string, unknown>;
  triggered_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryOverview {
  windowSeconds: number;
  attempts: {
    total: number;
    sent: number;
    failed: number;
    retryScheduled: number;
    successRate: number;
  };
  queuedCampaignMessages: number;
  openAlerts: number;
  suppressedRecipients: number;
}

export type DeliveryReportStatus = "sending" | "sent" | "delivered" | "read" | "failed" | "retrying";

export interface DeliveryReportChannel {
  key: string;
  label: string;
  messages: number;
  failed: number;
}

export interface DeliverySummaryCard {
  label: string;
  count: number;
  percentage: number;
}

export interface DeliverySummaryDay {
  day: string;
  sent: number;
  delivered: number;
  engaged: number;
  failed: number;
}

export interface DeliveryFailureReason {
  errorCode: string | null;
  message: string;
  count: number;
}

export interface DeliveryReportSummary {
  rangeDays: number;
  cards: {
    recipients: DeliverySummaryCard;
    sent: DeliverySummaryCard;
    delivered: DeliverySummaryCard;
    engaged: DeliverySummaryCard;
    notInWhatsApp: DeliverySummaryCard;
    frequencyLimit: DeliverySummaryCard;
    failed: DeliverySummaryCard;
  };
  channels: DeliveryReportChannel[];
  daily: DeliverySummaryDay[];
  topFailureReasons: DeliveryFailureReason[];
}

export interface DeliveryLogRow {
  rowId: string;
  messageId: string;
  status: DeliveryReportStatus;
  sender: string;
  channelKey: string;
  channelLabel: string;
  messageContent: string;
  to: string;
  dateTime: string;
  remarks: string | null;
  errorCode: string | null;
}

export function fetchCampaigns(token: string) {
  return apiRequest<{ campaigns: Campaign[] }>("/api/campaigns", { token });
}

export function createCampaignDraft(
  token: string,
  payload: {
    name: string;
    broadcastType?: BroadcastType;
    connectionId?: string | null;
    templateId?: string | null;
    templateVariables?: CampaignTemplateVariables;
    targetSegmentId?: string | null;
    sourceCampaignId?: string | null;
    retargetStatus?: RetargetStatus | null;
    audienceSource?: CampaignAudienceSource;
    mediaOverrides?: CampaignMediaOverrides;
    scheduledAt?: string | null;
    enforceMarketingPolicy?: boolean;
  }
) {
  return apiRequest<{ campaign: Campaign }>("/api/campaigns", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function updateCampaignDraft(
  token: string,
  campaignId: string,
  payload: Partial<{
    name: string;
    broadcastType: BroadcastType;
    connectionId: string | null;
    templateId: string | null;
    templateVariables: CampaignTemplateVariables;
    targetSegmentId: string | null;
    sourceCampaignId: string | null;
    retargetStatus: RetargetStatus | null;
    audienceSource: CampaignAudienceSource;
    mediaOverrides: CampaignMediaOverrides;
    scheduledAt: string | null;
    enforceMarketingPolicy: boolean;
  }>
) {
  return apiRequest<{ campaign: Campaign }>(`/api/campaigns/${campaignId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload)
  });
}

export function launchCampaignDraft(token: string, campaignId: string) {
  return apiRequest<{ campaign: Campaign }>(`/api/campaigns/${campaignId}/launch`, {
    method: "POST",
    token
  });
}

export function cancelCampaignRun(token: string, campaignId: string) {
  return apiRequest<{ campaign: Campaign }>(`/api/campaigns/${campaignId}/cancel`, {
    method: "POST",
    token
  });
}

export function fetchCampaignMessages(
  token: string,
  campaignId: string,
  options?: { limit?: number; offset?: number; status?: CampaignMessageStatus }
) {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  if (typeof options?.offset === "number") {
    params.set("offset", String(options.offset));
  }
  if (options?.status) {
    params.set("status", options.status);
  }
  const query = params.toString();
  const path = query ? `/api/campaigns/${campaignId}/messages?${query}` : `/api/campaigns/${campaignId}/messages`;
  return apiRequest<{ messages: CampaignMessage[]; total: number }>(path, { token });
}

export function fetchCampaignDeliveryAnalytics(token: string, campaignId: string) {
  return apiRequest<{ analytics: CampaignDeliveryAnalytics }>(`/api/campaigns/${campaignId}/analytics`, { token });
}

export function fetchCampaignLaunchPreview(token: string, campaignId: string) {
  return apiRequest<{ preview: CampaignLaunchPreview }>(`/api/campaigns/${campaignId}/launch-preview`, { token });
}

export function fetchBroadcasts(token: string) {
  return apiRequest<{ broadcasts: Campaign[]; summary: BroadcastSummary }>("/api/broadcasts", { token });
}

export function fetchBroadcastSummary(token: string) {
  return apiRequest<{ summary: BroadcastSummary }>("/api/broadcasts/summary", { token });
}

export function fetchBroadcastReport(
  token: string,
  campaignId: string,
  options?: { limit?: number; offset?: number; status?: CampaignMessageStatus }
) {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  if (typeof options?.offset === "number") {
    params.set("offset", String(options.offset));
  }
  if (options?.status) {
    params.set("status", options.status);
  }
  const query = params.toString();
  const path = query ? `/api/broadcasts/${campaignId}/report?${query}` : `/api/broadcasts/${campaignId}/report`;
  return apiRequest<{ report: BroadcastReport }>(path, { token });
}

export function fetchBroadcastRetargetPreview(
  token: string,
  campaignId: string,
  status: RetargetStatus
) {
  return apiRequest<{ preview: BroadcastRetargetPreview }>(
    `/api/broadcasts/${campaignId}/retarget-preview?status=${encodeURIComponent(status)}`,
    { token }
  );
}

export async function previewBroadcastAudienceWorkbookImport(
  token: string,
  file: File
): Promise<BroadcastAudienceImportPreviewResponse> {
  const form = new FormData();
  form.append("file", file);
  return apiRequest<BroadcastAudienceImportPreviewResponse>("/api/broadcasts/audience/import/preview", {
    method: "POST",
    token,
    body: form,
    timeoutMs: 120_000
  });
}

export async function importBroadcastAudienceWorkbook(
  token: string,
  file: File,
  options?: BroadcastAudienceImportOptions
): Promise<BroadcastAudienceImportResponse> {
  const form = new FormData();
  form.append("file", file);
  if (options?.segmentName?.trim()) {
    form.append("segmentName", options.segmentName.trim());
  }
  if (options?.marketingOptIn !== undefined) {
    form.append("marketingOptIn", options.marketingOptIn ? "yes" : "no");
  }
  if (options?.phoneNumberFormat) {
    form.append("phoneNumberFormat", options.phoneNumberFormat);
  }
  if (options?.defaultCountryCode?.trim()) {
    form.append("defaultCountryCode", options.defaultCountryCode.trim());
  }
  if (options?.mapping) {
    form.append("mapping", JSON.stringify(options.mapping));
  }
  return apiRequest<BroadcastAudienceImportResponse>("/api/broadcasts/audience/import", {
    method: "POST",
    token,
    body: form,
    timeoutMs: 120_000
  });
}

export async function uploadBroadcastMedia(
  token: string,
  file: File
): Promise<{ mediaId: string; url: string; mimeType: string }> {
  const form = new FormData();
  form.append("file", file);
  return apiRequest<{ mediaId: string; url: string; mimeType: string }>("/api/broadcasts/media/upload", {
    method: "POST",
    token,
    body: form,
    timeoutMs: 120_000
  });
}

export type SequenceStatus = "draft" | "published" | "paused";
export type SequenceTriggerType = "create" | "update" | "both";
export type SequenceDelayUnit = "minutes" | "hours" | "days";
export type SequenceConditionType = "start" | "stop_success" | "stop_failure";
export type SequenceConditionOperator = "eq" | "neq" | "gt" | "lt" | "contains";
export type SequenceEnrollmentStatus = "active" | "completed" | "failed" | "stopped";

export interface SequenceStep {
  id: string;
  sequence_id: string;
  step_order: number;
  delay_value: number;
  delay_unit: SequenceDelayUnit;
  message_template_id: string;
  custom_delivery_json: Record<string, unknown>;
  template_variables_json?: CampaignTemplateVariables;
  media_overrides_json?: CampaignMediaOverrides;
  created_at: string;
  updated_at: string;
}

export interface SequenceCondition {
  id: string;
  sequence_id: string;
  condition_type: SequenceConditionType;
  field: string;
  operator: SequenceConditionOperator;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface Sequence {
  id: string;
  user_id: string;
  name: string;
  status: SequenceStatus;
  connection_id: string | null;
  base_type: "contact";
  trigger_type: SequenceTriggerType;
  channel: "whatsapp";
  allow_once: boolean;
  require_previous_delivery: boolean;
  retry_enabled: boolean;
  retry_window_hours: number;
  allowed_days_json: string[];
  time_mode: "any_time" | "window";
  time_window_start: string | null;
  time_window_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface SequenceListItem extends Sequence {
  steps_count: number;
  enrolled_count: number;
  completed_count: number;
  failed_count: number;
  active_count: number;
}

export interface SequenceDetail extends Sequence {
  steps: SequenceStep[];
  conditions: SequenceCondition[];
  metrics: {
    enrolled: number;
    active: number;
    completed: number;
    failed: number;
    stopped: number;
  };
}

export interface SequenceEnrollment {
  id: string;
  sequence_id: string;
  contact_id: string;
  contact_phone: string;
  contact_name: string | null;
  status: SequenceEnrollmentStatus;
  current_step: number;
  entered_at: string;
  next_run_at: string;
  last_executed_at: string | null;
  last_message_id: string | null;
  last_delivery_status: string | null;
  retry_count: number;
  retry_started_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SequenceLog {
  id: string;
  enrollment_id: string;
  sequence_id: string;
  step_id: string | null;
  status: "pending" | "sent" | "failed" | "stopped" | "skipped" | "retrying";
  response_id: string | null;
  error_message: string | null;
  meta_json: Record<string, unknown>;
  created_at: string;
}

export interface SequenceStepFunnelRow {
  step_id: string;
  step_order: number;
  delay_value: number;
  delay_unit: SequenceDelayUnit;
  message_template_id: string;
  reached: number;
}

export interface SequenceWriteStepInput {
  id?: string;
  stepOrder: number;
  delayValue: number;
  delayUnit: SequenceDelayUnit;
  messageTemplateId: string;
  templateVariables?: CampaignTemplateVariables;
  mediaOverrides?: CampaignMediaOverrides;
  customDelivery?: Record<string, unknown>;
}

export interface SequenceWriteConditionInput {
  id?: string;
  conditionType: SequenceConditionType;
  field: string;
  operator: SequenceConditionOperator;
  value: string;
}

export interface SequenceWriteInput {
  name: string;
  connectionId?: string | null;
  baseType?: "contact";
  triggerType: SequenceTriggerType;
  channel?: "whatsapp";
  allowOnce?: boolean;
  requirePreviousDelivery?: boolean;
  retryEnabled?: boolean;
  retryWindowHours?: number;
  allowedDays?: string[];
  timeMode?: "any_time" | "window";
  timeWindowStart?: string | null;
  timeWindowEnd?: string | null;
  steps?: SequenceWriteStepInput[];
  conditions?: SequenceWriteConditionInput[];
}

export function fetchSequences(token: string) {
  return apiRequest<{ sequences: SequenceListItem[] }>("/api/sequences", { token });
}

export function createSequence(token: string, payload: SequenceWriteInput) {
  return apiRequest<{ sequence: SequenceDetail }>("/api/sequences", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function fetchSequence(token: string, sequenceId: string) {
  return apiRequest<{ sequence: SequenceDetail }>(`/api/sequences/${sequenceId}`, { token });
}

export function updateSequenceDraft(token: string, sequenceId: string, payload: Partial<SequenceWriteInput>) {
  return apiRequest<{ sequence: SequenceDetail }>(`/api/sequences/${sequenceId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload)
  });
}

export function deleteSequence(token: string, sequenceId: string) {
  return apiRequest<{ ok: boolean }>(`/api/sequences/${sequenceId}`, {
    method: "DELETE",
    token
  });
}

export function publishSequence(token: string, sequenceId: string) {
  return apiRequest<{ sequence: SequenceDetail }>(`/api/sequences/${sequenceId}/publish`, {
    method: "POST",
    token
  });
}

export function pauseSequence(token: string, sequenceId: string) {
  return apiRequest<{ sequence: SequenceDetail }>(`/api/sequences/${sequenceId}/pause`, {
    method: "POST",
    token
  });
}

export function resumeSequence(token: string, sequenceId: string) {
  return apiRequest<{ sequence: SequenceDetail }>(`/api/sequences/${sequenceId}/resume`, {
    method: "POST",
    token
  });
}

export function fetchSequenceEnrollments(
  token: string,
  sequenceId: string,
  status?: SequenceEnrollmentStatus
) {
  const query = status ? `?status=${status}` : "";
  return apiRequest<{ enrollments: SequenceEnrollment[] }>(
    `/api/sequences/${sequenceId}/enrollments${query}`,
    { token }
  );
}

export function fetchSequenceStepFunnel(token: string, sequenceId: string) {
  return apiRequest<{ funnel: SequenceStepFunnelRow[] }>(
    `/api/sequences/${sequenceId}/step-funnel`,
    { token }
  );
}

export function fetchSequenceLogs(token: string, enrollmentId: string) {
  return apiRequest<{ logs: SequenceLog[] }>(`/api/enrollments/${enrollmentId}/logs`, { token });
}

export function fetchDeliveryOverview(token: string) {
  return apiRequest<{ overview: DeliveryOverview }>("/api/delivery/overview", { token });
}

export function fetchDeliveryReportSummary(
  token: string,
  options?: { days?: number; channelKey?: string | null }
) {
  const params = new URLSearchParams();
  if (typeof options?.days === "number") {
    params.set("days", String(options.days));
  }
  if (options?.channelKey) {
    params.set("channelKey", options.channelKey);
  }
  const query = params.toString();
  const path = query ? `/api/delivery/summary?${query}` : "/api/delivery/summary";
  return apiRequest<{ summary: DeliveryReportSummary }>(path, { token });
}

export function fetchDeliveryNotifications(
  token: string,
  options?: {
    days?: number;
    channelKey?: string | null;
    status?: DeliveryReportStatus | null;
    limit?: number;
    offset?: number;
  }
) {
  const params = new URLSearchParams();
  if (typeof options?.days === "number") {
    params.set("days", String(options.days));
  }
  if (options?.channelKey) {
    params.set("channelKey", options.channelKey);
  }
  if (options?.status) {
    params.set("status", options.status);
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  if (typeof options?.offset === "number") {
    params.set("offset", String(options.offset));
  }
  const query = params.toString();
  const path = query ? `/api/delivery/notifications?${query}` : "/api/delivery/notifications";
  return apiRequest<{ rows: DeliveryLogRow[]; total: number }>(path, { token });
}

export function fetchDeliveryFailures(
  token: string,
  options?: { days?: number; channelKey?: string | null; limit?: number; offset?: number }
) {
  const params = new URLSearchParams();
  if (typeof options?.days === "number") {
    params.set("days", String(options.days));
  }
  if (options?.channelKey) {
    params.set("channelKey", options.channelKey);
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  if (typeof options?.offset === "number") {
    params.set("offset", String(options.offset));
  }
  const query = params.toString();
  const path = query ? `/api/delivery/failures?${query}` : "/api/delivery/failures";
  return apiRequest<{ rows: DeliveryLogRow[]; total: number }>(path, { token });
}

export function fetchDeliveryConversations(
  token: string,
  options?: { days?: number; channelKey?: string | null }
) {
  const params = new URLSearchParams();
  if (typeof options?.days === "number") {
    params.set("days", String(options.days));
  }
  if (options?.channelKey) {
    params.set("channelKey", options.channelKey);
  }
  const query = params.toString();
  const path = query ? `/api/delivery/conversations?${query}` : "/api/delivery/conversations";
  return apiRequest<{ conversations: Conversation[] }>(path, { token });
}

export function fetchDeliveryAlerts(
  token: string,
  options?: { status?: DeliveryAlertStatus; limit?: number }
) {
  const params = new URLSearchParams();
  if (options?.status) {
    params.set("status", options.status);
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const path = query ? `/api/delivery/alerts?${query}` : "/api/delivery/alerts";
  return apiRequest<{ alerts: DeliveryAlert[] }>(path, { token });
}

export function resolveDeliveryAlertItem(token: string, alertId: string) {
  return apiRequest<{ alert: DeliveryAlert }>(`/api/delivery/alerts/${alertId}/resolve`, {
    method: "POST",
    token
  });
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

// ── Contact Segments ──────────────────────────────────────────────────────────

export type SegmentFilterOp =
  | "is"
  | "is_not"
  | "contains"
  | "not_contains"
  | "before"
  | "after"
  | "is_empty"
  | "is_not_empty";

export interface SegmentFilter {
  field: string;
  op: SegmentFilterOp;
  value: string;
}

export interface ContactSegment {
  id: string;
  user_id: string;
  name: string;
  filters: SegmentFilter[];
  created_at: string;
  updated_at: string;
}

export function listContactSegments(token: string) {
  return apiRequest<{ segments: ContactSegment[] }>("/api/contact-segments", { token });
}

export function createContactSegment(
  token: string,
  payload: { name: string; filters: SegmentFilter[] }
) {
  return apiRequest<{ segment: ContactSegment }>("/api/contact-segments", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function updateContactSegment(
  token: string,
  segmentId: string,
  patch: { name?: string; filters?: SegmentFilter[] }
) {
  return apiRequest<{ segment: ContactSegment }>(`/api/contact-segments/${segmentId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(patch)
  });
}

export function deleteContactSegment(token: string, segmentId: string) {
  return apiRequest<void>(`/api/contact-segments/${segmentId}`, { method: "DELETE", token });
}

export function fetchSegmentContacts(token: string, segmentId: string) {
  return apiRequest<{ contacts: ContactRecord[] }>(`/api/contact-segments/${segmentId}/contacts`, { token });
}

export function previewSegmentContacts(token: string, filters: SegmentFilter[]) {
  return apiRequest<{ contacts: ContactRecord[]; count: number }>("/api/contact-segments/preview", {
    method: "POST",
    token,
    body: JSON.stringify({ filters })
  });
}

// ── Generic Webhooks ─────────────────────────────────────────────────────────

export type GenericWebhookConditionOperator = "is_not_empty" | "is_empty" | "equals" | "not_equals";
export type GenericWebhookMatchMode = "all" | "any";
export type GenericWebhookChannelMode = "api" | "qr";
export type GenericWebhookDelayUnit = "minutes" | "hours" | "days";
export type GenericWebhookTagOperation = "append" | "replace" | "add_if_empty";
export type GenericWebhookLogStatus = "queued" | "completed" | "skipped" | "failed";

export interface GenericWebhookCondition {
  comparator: string;
  operator: GenericWebhookConditionOperator;
  value?: string;
}

export interface GenericWebhookContactFieldMapping {
  contactFieldName: string;
  payloadPath: string;
}

export interface GenericWebhookContactPaths {
  displayNamePath?: string;
  phoneNumberPath?: string;
  emailPath?: string;
}

export interface GenericWebhookContactAction {
  contactPaths?: GenericWebhookContactPaths;
  tagOperation?: GenericWebhookTagOperation;
  tags?: string[];
  fieldMappings?: GenericWebhookContactFieldMapping[];
}

export interface GenericWebhookTemplateAction {
  templateId: string;
  recipientNamePath: string;
  recipientPhonePath: string;
  variableMappings: Record<string, { source: "payload"; path: string }>;
  fallbackValues?: Record<string, string>;
}

export interface GenericWebhookQrFlowAction {
  flowId: string;
  recipientPhonePath: string;
  recipientNamePath?: string;
}

export interface GenericWebhookIntegration {
  id: string;
  userId: string;
  name: string;
  webhookKey: string;
  secretToken: string;
  enabled: boolean;
  endpointUrlPath: string;
  lastPayloadJson: Record<string, unknown>;
  lastPayloadFlatJson: Record<string, string>;
  lastReceivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenericWebhookWorkflow {
  id: string;
  userId: string;
  integrationId: string;
  name: string;
  enabled: boolean;
  channelMode: GenericWebhookChannelMode;
  matchMode: GenericWebhookMatchMode;
  defaultCountryCode?: string;
  delayValue?: number;
  delayUnit?: GenericWebhookDelayUnit;
  conditions: GenericWebhookCondition[];
  contactAction: GenericWebhookContactAction;
  templateAction: GenericWebhookTemplateAction | null;
  qrFlowAction: GenericWebhookQrFlowAction | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenericWebhookLog {
  id: string;
  requestId: string;
  workflowId: string | null;
  status: GenericWebhookLogStatus;
  customerName: string | null;
  customerPhone: string | null;
  contactId: string | null;
  templateId: string | null;
  providerMessageId: string | null;
  errorMessage: string | null;
  payloadJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  createdAt: string;
}

export function fetchGenericWebhookIntegrations(token: string) {
  return apiRequest<{ integrations: GenericWebhookIntegration[] }>("/api/integrations/webhooks", { token });
}

export function fetchGenericWebhookIntegration(token: string, integrationId: string) {
  return apiRequest<{ integration: GenericWebhookIntegration }>(`/api/integrations/webhooks/${integrationId}`, { token });
}

export function createGenericWebhookIntegration(token: string, payload: { name: string }) {
  return apiRequest<{ integration: GenericWebhookIntegration }>("/api/integrations/webhooks", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function updateGenericWebhookIntegration(token: string, integrationId: string, patch: { name?: string; enabled?: boolean }) {
  return apiRequest<{ integration: GenericWebhookIntegration }>(`/api/integrations/webhooks/${integrationId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(patch)
  });
}

export function deleteGenericWebhookIntegration(token: string, integrationId: string) {
  return apiRequest<void>(`/api/integrations/webhooks/${integrationId}`, {
    method: "DELETE",
    token
  });
}

export function rotateGenericWebhookSecret(token: string, integrationId: string) {
  return apiRequest<{ integration: GenericWebhookIntegration }>(`/api/integrations/webhooks/${integrationId}/rotate-secret`, {
    method: "POST",
    token
  });
}

export function fetchGenericWebhookWorkflows(token: string, integrationId: string) {
  return apiRequest<{ workflows: GenericWebhookWorkflow[] }>(`/api/integrations/webhooks/${integrationId}/workflows`, { token });
}

export function createGenericWebhookWorkflow(
  token: string,
  integrationId: string,
  payload: {
    name: string;
    enabled?: boolean;
    channelMode: GenericWebhookChannelMode;
    matchMode: GenericWebhookMatchMode;
    defaultCountryCode?: string | null;
    delayValue?: number | null;
    delayUnit?: GenericWebhookDelayUnit | null;
    conditions: GenericWebhookCondition[];
    contactAction?: GenericWebhookContactAction;
    templateAction?: GenericWebhookTemplateAction | null;
    qrFlowAction?: GenericWebhookQrFlowAction | null;
  }
) {
  return apiRequest<{ workflow: GenericWebhookWorkflow }>(`/api/integrations/webhooks/${integrationId}/workflows`, {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export function updateGenericWebhookWorkflow(
  token: string,
  integrationId: string,
  workflowId: string,
  patch: Partial<{
    name: string;
    enabled: boolean;
    channelMode: GenericWebhookChannelMode;
    matchMode: GenericWebhookMatchMode;
    defaultCountryCode: string | null;
    delayValue: number | null;
    delayUnit: GenericWebhookDelayUnit | null;
    conditions: GenericWebhookCondition[];
    contactAction: GenericWebhookContactAction;
    templateAction: GenericWebhookTemplateAction | null;
    qrFlowAction: GenericWebhookQrFlowAction | null;
  }>
) {
  return apiRequest<{ workflow: GenericWebhookWorkflow }>(`/api/integrations/webhooks/${integrationId}/workflows/${workflowId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(patch)
  });
}

export function deleteGenericWebhookWorkflow(token: string, integrationId: string, workflowId: string) {
  return apiRequest<void>(`/api/integrations/webhooks/${integrationId}/workflows/${workflowId}`, {
    method: "DELETE",
    token
  });
}

export function fetchGenericWebhookLogs(token: string, integrationId: string) {
  return apiRequest<{ logs: GenericWebhookLog[] }>(`/api/integrations/webhooks/${integrationId}/logs`, { token });
}

export function getNotificationSettings(token: string): Promise<{ dailyReportEnabled: boolean }> {
  return apiRequest("/api/notifications/settings", { token });
}

export function updateNotificationSettings(
  token: string,
  dailyReportEnabled: boolean
): Promise<{ dailyReportEnabled: boolean }> {
  return apiRequest("/api/notifications/settings", {
    method: "PATCH",
    token,
    body: JSON.stringify({ dailyReportEnabled })
  });
}

export type DailyReportSnapshot = {
  date: string;
  range: {
    dateLabel: string;
    startAt: string;
    endAt: string;
  };
  overview: {
    totalConversations: number;
    leads: number;
    complaints: number;
    feedback: number;
    responseRate: number | null;
    avgResponseTimeMinutes: number | null;
    aiHandled: {
      count: number;
      percent: number | null;
    };
    humanTakeover: {
      count: number;
      percent: number | null;
    };
  };
  priority: {
    staleLeads: Array<{
      conversationId: string;
      contactLabel: string;
      phoneNumber: string;
      lastMessage: string;
      lastActivityAt: string | null;
      reason: string;
      suggestedAction: string;
      suggestedActionTag: string;
    }>;
    stuckConversations: Array<{
      conversationId: string;
      contactLabel: string;
      phoneNumber: string;
      lastMessage: string;
      lastActivityAt: string | null;
      reason: string;
      suggestedAction: string;
      suggestedActionTag: string;
    }>;
    lowConfidenceChats: Array<{
      conversationId: string | null;
      contactLabel: string;
      phoneNumber: string;
      question: string;
      confidenceScore: number;
      createdAt: string;
      kbSuggestion: string;
    }>;
  };
  topLeads: {
    conversationId: string;
    displayName: string | null;
    phoneNumber: string;
    contactLabel: string;
    summary: string;
    score: number;
    status: string;
    lastMessage: string;
    lastActivityAt: string | null;
    suggestedAction: string;
    suggestedActionTag: string;
  }[];
  topComplaints: {
    conversationId: string;
    displayName: string | null;
    phoneNumber: string;
    contactLabel: string;
    summary: string;
    sentiment: string | null;
    score: number;
    status: string;
    lastMessage: string;
    lastActivityAt: string | null;
    comparisonNote: string;
  }[];
  topFeedback: {
    conversationId: string;
    displayName: string | null;
    phoneNumber: string;
    contactLabel: string;
    summary: string;
    sentiment: string | null;
    status: string;
    lastActivityAt: string | null;
    insight: string;
    repeatCount: number;
  }[];
  aiPerformance: {
    aiHandled: {
      count: number;
      percent: number | null;
    };
    humanTakeover: {
      count: number;
      percent: number | null;
    };
    failedResponses: number;
    unansweredQuestions: Array<{
      conversationId: string | null;
      contactLabel: string;
      phoneNumber: string;
      question: string;
      confidenceScore: number;
      createdAt: string;
      kbSuggestion: string;
    }>;
    kbSuggestions: string[];
  };
  insights: string[];
  improvements: string[];
  timeline: Array<{
    time: string;
    contactLabel: string;
    eventType: "inbound" | "outbound" | "ai_alert";
    description: string;
  }>;
  comparisons: {
    leadsDelta: number;
    complaintsDelta: number;
    feedbackDelta: number;
    responseRateDelta: number | null;
    summary: string[];
  };
  broadcasts: { sent: number; delivered: number; failed: number };
  automation: { sequencesCompleted: number; flowsCompleted: number };
  alerts: string[];
};

export type DailyReportEntry = {
  id: string;
  reportDate: string;
  snapshot: DailyReportSnapshot;
};

export function fetchTodayReport(token: string): Promise<DailyReportSnapshot> {
  return apiRequest("/api/reports/daily/today", { token });
}

export function fetchDailyReports(token: string): Promise<{ reports: DailyReportEntry[] }> {
  return apiRequest("/api/reports/daily", { token });
}
