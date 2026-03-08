import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardBootstrapResponse } from "../shared/dashboard/contracts";
import { appRoutes } from "./router";

const mockUseAuth = vi.hoisted(() => vi.fn());
const mockApiRequest = vi.hoisted(() => vi.fn());
const mockLeadsPrefetchData = vi.hoisted(() => vi.fn());

vi.mock("../lib/auth-context", () => ({
  useAuth: mockUseAuth
}));

vi.mock("../lib/use-realtime", () => ({
  useRealtime: () => undefined
}));

vi.mock("../shared/api/client", () => ({
  API_URL: "http://127.0.0.1:8000",
  apiRequest: mockApiRequest
}));

vi.mock("../components/dashboard-billing-center", () => ({
  DashboardBillingCenter: () => <div>Billing module</div>
}));

vi.mock("../modules/dashboard/leads/route", () => ({
  Component: () => <div>Leads module</div>,
  prefetchData: mockLeadsPrefetchData
}));

vi.mock("../modules/dashboard/studio/knowledge/route", () => ({
  Component: () => <div>Knowledge module</div>
}));

vi.mock("../modules/dashboard/studio/test/route", () => ({
  Component: () => <div>Test module</div>
}));

function createBootstrap(overrides: Partial<DashboardBootstrapResponse> = {}): DashboardBootstrapResponse {
  return {
    userSummary: {
      id: "user_123",
      name: "Demo Workspace",
      email: "demo@example.com",
      subscriptionPlan: "starter",
      aiActive: true,
      personality: "custom"
    },
    planEntitlements: {
      planCode: "starter",
      maxApiNumbers: 1,
      maxAgentProfiles: 1,
      prioritySupport: false
    },
    featureFlags: {
      "dashboard.inbox": true,
      "dashboard.leads": true,
      "dashboard.billing": true,
      "dashboard.agents": true,
      "dashboard.studio.knowledge": true,
      "dashboard.studio.personality": true,
      "dashboard.studio.review": true,
      "dashboard.studio.test": true,
      "dashboard.settings.web": true,
      "dashboard.settings.qr": true,
      "dashboard.settings.api": true
    },
    creditsSummary: {
      total_credits: 1000,
      used_credits: 100,
      remaining_credits: 900,
      low_credit: false,
      low_credit_threshold_percent: 10,
      low_credit_message: null
    },
    agentSummary: {
      configuredProfiles: 1,
      activeProfiles: 1,
      hasConfiguredProfile: true,
      hasActiveProfile: true
    },
    channelSummary: {
      website: {
        enabled: true
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
      anyConnected: true
    },
    ...overrides
  };
}

function renderRoute(initialEntry: string, bootstrap = createBootstrap()) {
  mockUseAuth.mockReturnValue({
    token: "test-token",
    loading: false,
    logout: vi.fn(),
    refreshUser: vi.fn(),
    user: {
      id: "user_123",
      business_basics: {
        companyName: "Demo Workspace",
        whatDoYouSell: "AI support",
        targetAudience: "Customers"
      }
    }
  });
  mockApiRequest.mockResolvedValue(bootstrap);

  const router = createMemoryRouter(appRoutes, {
    initialEntries: [initialEntry],
    future: {
      v7_relativeSplatPath: true
    }
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  return { router, queryClient };
}

describe("dashboard router", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("redirects legacy dashboard tabs to the new knowledge route", async () => {
    const { router } = renderRoute("/dashboard?tab=knowledge");

    expect(await screen.findByText("Knowledge module")).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/dashboard/studio/knowledge");
    });
  });

  it("renders the billing module shell for deep links", async () => {
    renderRoute("/dashboard/billing");

    expect(await screen.findByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByText("Billing module")).toBeInTheDocument();
    expect(mockApiRequest).toHaveBeenCalledWith("/api/dashboard/bootstrap", {
      token: "test-token"
    });
  });

  it("hides the paused-agent banner when no workflow is configured", async () => {
    renderRoute(
      "/dashboard/billing",
      createBootstrap({
        userSummary: {
          ...createBootstrap().userSummary,
          aiActive: false
        },
        agentSummary: {
          configuredProfiles: 0,
          activeProfiles: 0,
          hasConfiguredProfile: false,
          hasActiveProfile: false
        }
      })
    );

    expect(await screen.findByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.queryByText("Your agent workflow is paused.")).not.toBeInTheDocument();
  });

  it("shows the paused-agent banner when a workflow exists but automation is disabled", async () => {
    renderRoute(
      "/dashboard/billing",
      createBootstrap({
        userSummary: {
          ...createBootstrap().userSummary,
          aiActive: false
        },
        agentSummary: {
          configuredProfiles: 1,
          activeProfiles: 1,
          hasConfiguredProfile: true,
          hasActiveProfile: true
        }
      })
    );

    expect(await screen.findByText("Your agent workflow is paused.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate now" })).toBeInTheDocument();
  });

  it("keeps disabled feature-flag routes reachable but blocked", async () => {
    renderRoute(
      "/dashboard/studio/test",
      createBootstrap({
        featureFlags: {
          ...createBootstrap().featureFlags,
          "dashboard.studio.test": false
        }
      })
    );

    expect(await screen.findByText("Module unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Test module")).not.toBeInTheDocument();
  });

  it("prefetches code+data modules from the sidebar", async () => {
    const user = userEvent.setup();
    renderRoute("/dashboard/billing");

    await screen.findByText("Billing module");
    await user.hover(screen.getAllByRole("link", { name: /Leads/i })[0]);

    await waitFor(() => {
      expect(mockLeadsPrefetchData).toHaveBeenCalledTimes(1);
      expect(mockLeadsPrefetchData).toHaveBeenCalledWith(
        expect.objectContaining({
          token: "test-token",
          bootstrap: expect.any(Object),
          queryClient: expect.any(Object)
        })
      );
    });
  });
});
