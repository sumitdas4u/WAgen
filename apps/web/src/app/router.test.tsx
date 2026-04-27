import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardBootstrapResponse } from "../shared/dashboard/contracts";
import { appRoutes } from "./router";

const mockUseAuth = vi.hoisted(() => vi.fn());
const mockApiRequest = vi.hoisted(() => vi.fn());
const mockContactsPrefetchData = vi.hoisted(() => vi.fn());
const mockSequencePrefetchData = vi.hoisted(() => vi.fn());

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

vi.mock("../modules/dashboard/contacts/route", () => ({
  Component: () => <div>Contacts module</div>,
  prefetchData: mockContactsPrefetchData
}));

vi.mock("../modules/dashboard/studio/knowledge/route", () => ({
  Component: () => <div>Knowledge module</div>
}));

vi.mock("../modules/dashboard/studio/test/route", () => ({
  Component: () => <div>Test module</div>
}));

vi.mock("../modules/dashboard/sequence/route", () => ({
  Component: () => <div>Sequence module</div>,
  prefetchData: mockSequencePrefetchData
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
      "dashboard.contacts": true,
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
        enabled: true,
        status: "disconnected",
        phoneNumber: null,
        hasQr: false,
        qr: null
      },
      metaApi: {
        connected: false,
        enabled: false,
        connection: null,
        connections: []
      },
      anyConnected: true
    },
    ...overrides
  };
}

function renderRoute(
  initialEntry: string,
  bootstrap = createBootstrap(),
  apiImplementation?: (path: string, options: unknown) => Promise<unknown>
) {
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
  if (apiImplementation) {
    mockApiRequest.mockImplementation(apiImplementation);
  } else {
    mockApiRequest.mockResolvedValue(bootstrap);
  }

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

  it("redirects legacy leads paths to contacts", async () => {
    const { router } = renderRoute("/dashboard?tab=leads");

    expect(await screen.findByText("Contacts module")).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/dashboard/leads");
    });
  });

  it("renders the contacts module on /dashboard/leads", async () => {
    const { router } = renderRoute("/dashboard/leads");

    expect(await screen.findByText("Contacts module")).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/dashboard/leads");
    });
  });

  it("redirects /dashboard/contacts to /dashboard/leads", async () => {
    const { router } = renderRoute("/dashboard/contacts");

    expect(await screen.findByText("Contacts module")).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/dashboard/leads");
    });
  });

  it("renders the billing module shell for deep links", async () => {
    renderRoute("/dashboard/billing");

    expect(await screen.findByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByText("Billing module")).toBeInTheDocument();
  });

  it("renders the sequence module on /dashboard/sequence", async () => {
    const { router } = renderRoute("/dashboard/sequence");

    expect(await screen.findByText("Sequence module")).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/dashboard/sequence");
    });
  });

  it("renders the sequence report route on /dashboard/sequence/:id/report", async () => {
    const { router } = renderRoute("/dashboard/sequence/abc123/report");

    expect(await screen.findByText("Sequence module")).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/dashboard/sequence/abc123/report");
    });
  });

  it("normalizes legacy bootstrap payloads that omit dashboard summaries", async () => {
    const { agentSummary: _agentSummary, channelSummary: _channelSummary, ...legacyBootstrap } = createBootstrap();

    renderRoute("/dashboard/billing", legacyBootstrap as DashboardBootstrapResponse);

    expect(await screen.findByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByText("Billing module")).toBeInTheDocument();
    expect(screen.queryByText("Unexpected Application Error!")).not.toBeInTheDocument();
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
    await user.hover(screen.getAllByRole("link", { name: /Contacts/i })[0]);

    await waitFor(() => {
      expect(mockContactsPrefetchData).toHaveBeenCalledTimes(1);
      expect(mockContactsPrefetchData).toHaveBeenCalledWith(
        expect.objectContaining({
          token: "test-token",
          bootstrap: expect.any(Object),
          queryClient: expect.any(Object)
        })
      );
    });
  });

  it("shows a waiting inbox state instead of the go-live setup when channels are offline", async () => {
    const bootstrap = createBootstrap({
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
          enabled: true,
          status: "disconnected",
          phoneNumber: null,
          hasQr: false,
          qr: null
        },
        metaApi: {
          connected: false,
          enabled: false,
          connection: null,
          connections: []
        },
        anyConnected: false
      }
    });

    renderRoute("/dashboard/inbox", bootstrap, async (path) => {
      if (path === "/api/dashboard/bootstrap") {
        return bootstrap;
      }
      if (path === "/api/conversations") {
        return { conversations: [] };
      }
      throw new Error(`Unhandled path in test: ${path}`);
    });

    expect(await screen.findByRole("heading", { name: "Chats" })).toBeInTheDocument();
    expect(
      await screen.findByText("No agent found yet. Create one to start receiving chats.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("No live channel connected.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Connect to Website")).not.toBeInTheDocument();
  });

});
