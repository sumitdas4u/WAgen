import type { DashboardBootstrapResponse } from "./contracts";

const DEFAULT_DASHBOARD_BOOTSTRAP: DashboardBootstrapResponse = {
  userSummary: {
    id: "",
    name: "",
    email: "",
    subscriptionPlan: "",
    aiActive: false,
    personality: "custom"
  },
  planEntitlements: {
    planCode: "trial",
    maxApiNumbers: 0,
    maxAgentProfiles: 0,
    prioritySupport: false
  },
  featureFlags: {},
  creditsSummary: {
    total_credits: 0,
    used_credits: 0,
    remaining_credits: 0,
    low_credit: false,
    low_credit_threshold_percent: 0,
    low_credit_message: null
  },
  agentSummary: {
    configuredProfiles: 0,
    activeProfiles: 0,
    hasConfiguredProfile: false,
    hasActiveProfile: false
  },
  channelSummary: {
    website: {
      enabled: false
    },
    whatsapp: {
      status: "disconnected",
      phoneNumber: null,
      hasQr: false,
      qr: null
    },
    metaApi: {
      connected: false,
      connection: null
    },
    anyConnected: false
  }
};

export function normalizeDashboardBootstrap(
  value: Partial<DashboardBootstrapResponse> | null | undefined
): DashboardBootstrapResponse {
  return {
    userSummary: {
      ...DEFAULT_DASHBOARD_BOOTSTRAP.userSummary,
      ...(value?.userSummary ?? {})
    },
    planEntitlements: {
      ...DEFAULT_DASHBOARD_BOOTSTRAP.planEntitlements,
      ...(value?.planEntitlements ?? {})
    },
    featureFlags: value?.featureFlags ?? DEFAULT_DASHBOARD_BOOTSTRAP.featureFlags,
    creditsSummary: {
      ...DEFAULT_DASHBOARD_BOOTSTRAP.creditsSummary,
      ...(value?.creditsSummary ?? {})
    },
    agentSummary: {
      ...DEFAULT_DASHBOARD_BOOTSTRAP.agentSummary,
      ...(value?.agentSummary ?? {})
    },
    channelSummary: {
      ...DEFAULT_DASHBOARD_BOOTSTRAP.channelSummary,
      ...(value?.channelSummary ?? {}),
      website: {
        ...DEFAULT_DASHBOARD_BOOTSTRAP.channelSummary.website,
        ...(value?.channelSummary?.website ?? {})
      },
      whatsapp: {
        ...DEFAULT_DASHBOARD_BOOTSTRAP.channelSummary.whatsapp,
        ...(value?.channelSummary?.whatsapp ?? {})
      },
      metaApi: {
        ...DEFAULT_DASHBOARD_BOOTSTRAP.channelSummary.metaApi,
        ...(value?.channelSummary?.metaApi ?? {})
      }
    }
  };
}
