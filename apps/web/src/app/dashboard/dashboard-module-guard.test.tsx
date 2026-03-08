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
    }
  };
}

describe("DashboardModuleGuard", () => {
  it("renders an upgrade-required state for plan-restricted modules", () => {
    const definition: DashboardModuleDefinition = {
      id: "premium",
      path: "premium",
      navTo: "/dashboard/premium",
      navLabel: "Premium",
      subtitle: "Premium tooling",
      icon: "billing",
      section: "main",
      lazyRoute: async () => ({
        Component: () => null
      }),
      requiredPlan: "pro",
      prefetchStrategy: "code",
      requiresAuth: true
    };

    render(
      <MemoryRouter
        future={{
          v7_relativeSplatPath: true
        }}
      >
        <DashboardShellContextProvider
          value={{
            token: "test-token",
            bootstrap: createBootstrap(),
            loading: false,
            refetchBootstrap: vi.fn(async () => undefined)
          }}
        >
          <DashboardModuleGuard definition={definition}>
            <div>Premium module</div>
          </DashboardModuleGuard>
        </DashboardShellContextProvider>
      </MemoryRouter>
    );

    expect(screen.getByText("Upgrade required")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open billing" })).toHaveAttribute("href", "/dashboard/billing");
    expect(screen.queryByText("Premium module")).not.toBeInTheDocument();
  });
});
