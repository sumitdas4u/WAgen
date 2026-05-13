import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardOverviewResponse } from "../../lib/api";
import type { DashboardBootstrapResponse } from "../../shared/dashboard/contracts";
import { DashboardShellContextProvider } from "../../shared/dashboard/shell-context";
import { DashboardHomePage } from "./DashboardHomePage";

const mockFetchDashboardOverview = vi.hoisted(() => vi.fn());
const mockPreviewCoupon = vi.hoisted(() => vi.fn());

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    fetchDashboardOverview: mockFetchDashboardOverview,
    previewCoupon: mockPreviewCoupon
  };
});

function createBootstrap(overrides: Partial<DashboardBootstrapResponse> = {}): DashboardBootstrapResponse {
  return {
    userSummary: {
      id: "user_123",
      name: "Demo Workspace",
      email: "demo@example.com",
      subscriptionPlan: "starter",
      aiActive: true,
      personality: "friendly"
    },
    planEntitlements: {
      planCode: "starter",
      maxApiNumbers: 1,
      maxAgentProfiles: 1,
      maxActiveFlows: 1,
      maxKnowledgeSources: 2,
      aiCreditsMonthly: 750,
      annualAmountInr: 7990,
      prioritySupport: false,
      modules: {
        inbox: true,
        contacts: true,
        billing: true,
        qrChannel: true,
        webWidget: true,
        broadcast: true,
        flows: true,
        sequences: true,
        webhooks: false,
        apiChannel: true,
        googleSheets: false,
        googleCalendar: false,
        apiAccess: false
      }
    },
    featureFlags: {},
    creditsSummary: {
      total_credits: 1000,
      used_credits: 250,
      remaining_credits: 750,
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
      website: { enabled: true },
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

function createOverview(overrides: Partial<DashboardOverviewResponse> = {}): DashboardOverviewResponse {
  return {
    overview: {
      leadsToday: 2,
      hotLeads: 1,
      warmLeads: 3,
      closedDeals: 0,
      openConversations: 5,
      totalContacts: 42,
      activeBroadcasts: 1,
      activeSequences: 2
    },
    knowledge: { chunks: 8 },
    whatsapp: {
      enabled: true,
      status: "disconnected",
      phoneNumber: null,
      hasQr: false,
      qr: null
    },
    metaApi: {
      connected: true,
      enabled: true,
      connection: null,
      connections: []
    },
    agent: {
      active: true,
      personality: "friendly"
    },
    automation: {
      configuredAgents: 1,
      activeAgents: 1,
      knowledgeChunks: 8,
      activeFlows: 1
    },
    channels: {
      website: { label: "Website Widget", connected: false, status: "not_connected" },
      qr: { label: "WhatsApp QR", connected: false, status: "disconnected", phoneNumber: null },
      api: { label: "Official WhatsApp API", connected: true, status: "connected", phoneNumber: "+911234567890" }
    },
    setup: {
      connected: true,
      stepsLeft: 0,
      checklist: [
        {
          id: "connect-channel",
          label: "Connect a channel",
          complete: true,
          primaryCta: { label: "Connect API", to: "/dashboard/settings/api" },
          secondaryCtas: []
        }
      ]
    },
    ...overrides
  };
}

function renderHome(bootstrap = createBootstrap()) {
  render(
    <MemoryRouter>
      <DashboardShellContextProvider value={{ token: "test-token", bootstrap, loading: false, refetchBootstrap: vi.fn() }}>
        <DashboardHomePage />
      </DashboardShellContextProvider>
    </MemoryRouter>
  );
}

describe("DashboardHomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchDashboardOverview.mockResolvedValue(createOverview());
    mockPreviewCoupon.mockResolvedValue({
      preview: {
        code: "SAVE20",
        title: "Save 20%",
        scope: "subscription",
        discountType: "percent",
        discountValue: 20,
        purchaseType: "subscription",
        originalAmountPaise: 199900,
        discountAmountPaise: 39980,
        finalAmountPaise: 159920,
        currency: "INR",
        gatewayNote: "Razorpay offer will be applied at checkout."
      }
    });
  });

  it("shows connected workspace state from the API channel", async () => {
    renderHome();

    expect(await screen.findByText("Workspace Channels")).toBeInTheDocument();
    expect(screen.getAllByText("Official API").length).toBeGreaterThan(0);
    expect(screen.getByText("Official API is feeding the dashboard")).toBeInTheDocument();
  });

  it("shows setup-first state when no channel is connected", async () => {
    mockFetchDashboardOverview.mockResolvedValue(createOverview({
      channels: {
        website: { label: "Website Widget", connected: false, status: "not_connected" },
        qr: { label: "WhatsApp QR", connected: false, status: "disconnected", phoneNumber: null },
        api: { label: "Official WhatsApp API", connected: false, status: "not_connected", phoneNumber: null }
      },
      setup: { connected: false, stepsLeft: 3, checklist: [] }
    }));

    renderHome(createBootstrap({
      userSummary: { ...createBootstrap().userSummary, aiActive: false },
      channelSummary: {
        ...createBootstrap().channelSummary,
        website: { enabled: false },
        anyConnected: false
      }
    }));

    expect(await screen.findByText("Setup required")).toBeInTheDocument();
    expect(screen.getByText("Connect Website, QR, or Official API")).toBeInTheDocument();
  });

  it("uses the default YouTube nocookie embed", async () => {
    renderHome();

    const iframe = await screen.findByTitle("WAgen dashboard demo");
    expect(iframe).toHaveAttribute("src", expect.stringContaining("youtube-nocookie.com/embed/M7lc1UVf-VE"));
  });

  it("validates offer access codes before sending users to purchase", async () => {
    renderHome();

    fireEvent.change(screen.getByLabelText("Offer access code"), { target: { value: "SAVE20" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate ->" }));

    await waitFor(() => {
      expect(mockPreviewCoupon).toHaveBeenCalledWith("test-token", {
        code: "SAVE20",
        purchaseType: "subscription",
        planCode: "pro"
      });
    });
  });
});
