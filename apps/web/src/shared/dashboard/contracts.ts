import type { MetaBusinessStatus, PlanEntitlements, WorkspaceCreditsResponse } from "../../lib/api";

export interface DashboardBootstrapUserSummary {
  id: string;
  name: string;
  email: string;
  subscriptionPlan: string;
  aiActive: boolean;
  personality: string;
}

export interface DashboardChannelSummary {
  website: {
    enabled: boolean;
  };
  whatsapp: {
    status: string;
    phoneNumber: string | null;
    hasQr: boolean;
    qr: string | null;
  };
  metaApi: MetaBusinessStatus;
  anyConnected: boolean;
}

export interface DashboardBootstrapResponse {
  userSummary: DashboardBootstrapUserSummary;
  planEntitlements: PlanEntitlements;
  featureFlags: Record<string, boolean>;
  creditsSummary: WorkspaceCreditsResponse;
  channelSummary: DashboardChannelSummary;
}
