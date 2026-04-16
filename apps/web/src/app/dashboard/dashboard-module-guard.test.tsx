import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { DashboardBootstrapResponse } from "../../shared/dashboard/contracts";
import { DashboardShellContextProvider } from "../../shared/dashboard/shell-context";
import type { DashboardModuleDefinition } from "../../shared/dashboard/module-contracts";
import { DashboardModuleGuard } from "./dashboard-module-guard";

function createBootstrap(): DashboardBootstrapResponse {
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
    featureFlags: {},
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
    }
  };
}

function makeDefinition(overrides: Partial<DashboardModuleDefinition> = {}): DashboardModuleDefinition {
  return {
    id: "test-module",
    path: "test-module",
    navTo: "/dashboard/test-module",
    navLabel: "Test Module",
    subtitle: "Test",
    icon: "billing",
    section: "main",
    lazyRoute: async () => ({ Component: () => null }),
    prefetchStrategy: "code",
    requiresAuth: true,
    ...overrides
  };
}

function renderGuard(
  definition: DashboardModuleDefinition,
  bootstrapOverrides: Partial<DashboardBootstrapResponse> = {}
) {
  const bootstrap: DashboardBootstrapResponse = {
    ...createBootstrap(),
    ...bootstrapOverrides,
    planEntitlements: {
      ...createBootstrap().planEntitlements,
      ...(bootstrapOverrides.planEntitlements ?? {})
    }
  };

  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true }}>
      <DashboardShellContextProvider
        value={{
          token: "test-token",
          bootstrap,
          loading: false,
          refetchBootstrap: vi.fn(async () => undefined)
        }}
      >
        <DashboardModuleGuard definition={definition}>
          <div>Module content</div>
        </DashboardModuleGuard>
      </DashboardShellContextProvider>
    </MemoryRouter>
  );
}

describe("DashboardModuleGuard", () => {
  // ── Plan gating ────────────────────────────────────────────────────────────

  it("renders an upgrade-required state for plan-restricted modules", () => {
    renderGuard(makeDefinition({ requiredPlan: "pro" }));
    // starter < pro → blocked
    expect(screen.getByText("Upgrade required")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open billing" })).toHaveAttribute("href", "/dashboard/billing");
    expect(screen.queryByText("Module content")).not.toBeInTheDocument();
  });

  it("renders content when current plan meets the required plan exactly", () => {
    renderGuard(
      makeDefinition({ requiredPlan: "starter" }),
      { planEntitlements: { planCode: "starter", maxApiNumbers: 1, maxAgentProfiles: 1, prioritySupport: false } }
    );
    expect(screen.getByText("Module content")).toBeInTheDocument();
    expect(screen.queryByText("Upgrade required")).not.toBeInTheDocument();
  });

  it("renders content when current plan exceeds the required plan", () => {
    renderGuard(
      makeDefinition({ requiredPlan: "starter" }),
      { planEntitlements: { planCode: "business", maxApiNumbers: 5, maxAgentProfiles: 10, prioritySupport: true } }
    );
    expect(screen.getByText("Module content")).toBeInTheDocument();
  });

  it("renders content when no requiredPlan is specified", () => {
    renderGuard(makeDefinition({ requiredPlan: undefined }));
    expect(screen.getByText("Module content")).toBeInTheDocument();
  });

  it("blocks trial plan from pro-gated module", () => {
    renderGuard(
      makeDefinition({ requiredPlan: "pro" }),
      { planEntitlements: { planCode: "trial", maxApiNumbers: 0, maxAgentProfiles: 0, prioritySupport: false } }
    );
    expect(screen.getByText("Upgrade required")).toBeInTheDocument();
  });

  it("allows business plan on any plan-gated module", () => {
    renderGuard(
      makeDefinition({ requiredPlan: "business" }),
      { planEntitlements: { planCode: "business", maxApiNumbers: 10, maxAgentProfiles: 20, prioritySupport: true } }
    );
    expect(screen.getByText("Module content")).toBeInTheDocument();
  });

  // ── Feature flag gating ────────────────────────────────────────────────────

  it("renders module-unavailable when feature flag is explicitly false", () => {
    renderGuard(
      makeDefinition({ featureFlag: "dashboard.some.feature" }),
      { featureFlags: { "dashboard.some.feature": false } }
    );
    expect(screen.getByText("Module unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Module content")).not.toBeInTheDocument();
  });

  it("renders content when feature flag is true", () => {
    renderGuard(
      makeDefinition({ featureFlag: "dashboard.some.feature" }),
      { featureFlags: { "dashboard.some.feature": true } }
    );
    expect(screen.getByText("Module content")).toBeInTheDocument();
  });

  it("renders content when no featureFlag is specified on definition", () => {
    renderGuard(makeDefinition({ featureFlag: undefined }), { featureFlags: {} });
    expect(screen.getByText("Module content")).toBeInTheDocument();
  });

  // ── Entitlements gating ────────────────────────────────────────────────────

  it("blocks module when maxApiNumbers entitlement is not met", () => {
    renderGuard(
      makeDefinition({ requiredEntitlements: { maxApiNumbers: 3 } }),
      { planEntitlements: { planCode: "starter", maxApiNumbers: 1, maxAgentProfiles: 1, prioritySupport: false } }
    );
    expect(screen.getByText("Upgrade required")).toBeInTheDocument();
    expect(screen.queryByText("Module content")).not.toBeInTheDocument();
  });

  it("allows module when maxApiNumbers entitlement is met exactly", () => {
    renderGuard(
      makeDefinition({ requiredEntitlements: { maxApiNumbers: 2 } }),
      { planEntitlements: { planCode: "pro", maxApiNumbers: 2, maxAgentProfiles: 3, prioritySupport: false } }
    );
    expect(screen.getByText("Module content")).toBeInTheDocument();
  });

  it("blocks module when maxAgentProfiles entitlement is not met", () => {
    renderGuard(
      makeDefinition({ requiredEntitlements: { maxAgentProfiles: 5 } }),
      { planEntitlements: { planCode: "starter", maxApiNumbers: 1, maxAgentProfiles: 1, prioritySupport: false } }
    );
    expect(screen.getByText("Upgrade required")).toBeInTheDocument();
  });

  it("allows module when maxAgentProfiles entitlement is met", () => {
    renderGuard(
      makeDefinition({ requiredEntitlements: { maxAgentProfiles: 5 } }),
      { planEntitlements: { planCode: "pro", maxApiNumbers: 2, maxAgentProfiles: 10, prioritySupport: false } }
    );
    expect(screen.getByText("Module content")).toBeInTheDocument();
  });

  it("blocks module when prioritySupport is required but not available", () => {
    renderGuard(
      makeDefinition({ requiredEntitlements: { prioritySupport: true } }),
      { planEntitlements: { planCode: "pro", maxApiNumbers: 2, maxAgentProfiles: 3, prioritySupport: false } }
    );
    expect(screen.getByText("Upgrade required")).toBeInTheDocument();
  });

  it("allows module when prioritySupport entitlement is met", () => {
    renderGuard(
      makeDefinition({ requiredEntitlements: { prioritySupport: true } }),
      { planEntitlements: { planCode: "business", maxApiNumbers: 5, maxAgentProfiles: 10, prioritySupport: true } }
    );
    expect(screen.getByText("Module content")).toBeInTheDocument();
  });

  it("blocks when multiple entitlements are required and one is missing", () => {
    renderGuard(
      makeDefinition({ requiredEntitlements: { maxApiNumbers: 3, prioritySupport: true } }),
      { planEntitlements: { planCode: "pro", maxApiNumbers: 3, maxAgentProfiles: 3, prioritySupport: false } }
    );
    expect(screen.getByText("Upgrade required")).toBeInTheDocument();
  });

  it("allows when all multiple entitlements are met", () => {
    renderGuard(
      makeDefinition({ requiredEntitlements: { maxApiNumbers: 3, prioritySupport: true } }),
      { planEntitlements: { planCode: "business", maxApiNumbers: 5, maxAgentProfiles: 10, prioritySupport: true } }
    );
    expect(screen.getByText("Module content")).toBeInTheDocument();
  });

  // ── Null bootstrap edge case ───────────────────────────────────────────────

  it("allows access when bootstrap is null (entitlement check skipped)", () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true }}>
        <DashboardShellContextProvider
          value={{
            token: "test-token",
            bootstrap: null,
            loading: true,
            refetchBootstrap: vi.fn(async () => undefined)
          }}
        >
          <DashboardModuleGuard definition={makeDefinition({ requiredEntitlements: { prioritySupport: true } })}>
            <div>Module content</div>
          </DashboardModuleGuard>
        </DashboardShellContextProvider>
      </MemoryRouter>
    );
    expect(screen.getByText("Module content")).toBeInTheDocument();
  });
});
