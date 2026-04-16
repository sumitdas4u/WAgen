import { describe, expect, it } from "vitest";
import { normalizeDashboardBootstrap } from "./bootstrap";

describe("normalizeDashboardBootstrap", () => {
  // ── Null / undefined input ─────────────────────────────────────────────────

  it("returns full default structure when called with null", () => {
    const result = normalizeDashboardBootstrap(null);
    expect(result.userSummary.id).toBe("");
    expect(result.userSummary.aiActive).toBe(false);
    expect(result.planEntitlements.planCode).toBe("trial");
    expect(result.planEntitlements.maxApiNumbers).toBe(0);
    expect(result.creditsSummary.remaining_credits).toBe(0);
    expect(result.agentSummary.hasConfiguredProfile).toBe(false);
    expect(result.channelSummary.anyConnected).toBe(false);
  });

  it("returns full default structure when called with undefined", () => {
    const result = normalizeDashboardBootstrap(undefined);
    expect(result.planEntitlements.planCode).toBe("trial");
    expect(result.channelSummary.whatsapp.status).toBe("disconnected");
  });

  // ── Partial input merging ──────────────────────────────────────────────────

  it("merges partial userSummary over defaults", () => {
    const result = normalizeDashboardBootstrap({
      userSummary: {
        id: "user_abc",
        name: "Food Studio",
        email: "admin@food-studio.in",
        subscriptionPlan: "starter",
        aiActive: true,
        personality: "friendly"
      }
    });
    expect(result.userSummary.id).toBe("user_abc");
    expect(result.userSummary.aiActive).toBe(true);
    expect(result.userSummary.personality).toBe("friendly");
  });

  it("merges partial planEntitlements over defaults", () => {
    const result = normalizeDashboardBootstrap({
      planEntitlements: {
        planCode: "pro",
        maxApiNumbers: 3,
        maxAgentProfiles: 5,
        prioritySupport: true
      }
    });
    expect(result.planEntitlements.planCode).toBe("pro");
    expect(result.planEntitlements.maxApiNumbers).toBe(3);
    expect(result.planEntitlements.prioritySupport).toBe(true);
  });

  it("merges partial creditsSummary over defaults", () => {
    const result = normalizeDashboardBootstrap({
      creditsSummary: {
        total_credits: 5000,
        used_credits: 200,
        remaining_credits: 4800,
        low_credit: false,
        low_credit_threshold_percent: 10,
        low_credit_message: null
      }
    });
    expect(result.creditsSummary.total_credits).toBe(5000);
    expect(result.creditsSummary.remaining_credits).toBe(4800);
  });

  it("deep-merges whatsapp channelSummary preserving optional fields", () => {
    const result = normalizeDashboardBootstrap({
      channelSummary: {
        website: { enabled: false },
        whatsapp: {
          enabled: true,
          status: "connected",
          phoneNumber: "+919804735837",
          hasQr: true,
          qr: null,
          needsRelink: true,
          statusMessage: "Session expired"
        },
        metaApi: {
          connected: false,
          enabled: false,
          connection: null,
          connections: []
        },
        anyConnected: true
      }
    });
    expect(result.channelSummary.whatsapp.status).toBe("connected");
    expect(result.channelSummary.whatsapp.phoneNumber).toBe("+919804735837");
    expect(result.channelSummary.whatsapp.needsRelink).toBe(true);
    expect(result.channelSummary.whatsapp.statusMessage).toBe("Session expired");
    expect(result.channelSummary.anyConnected).toBe(true);
  });

  it("deep-merges metaApi channelSummary", () => {
    const result = normalizeDashboardBootstrap({
      channelSummary: {
        website: { enabled: true },
        whatsapp: {
          enabled: false,
          status: "disconnected",
          phoneNumber: null,
          hasQr: false,
          qr: null
        },
        metaApi: {
          connected: true,
          enabled: true,
          connection: { id: "conn_1" } as never,
          connections: []
        },
        anyConnected: true
      }
    });
    expect(result.channelSummary.metaApi.connected).toBe(true);
    expect(result.channelSummary.website.enabled).toBe(true);
  });

  // ── Feature flag aliasing ──────────────────────────────────────────────────

  it("aliases dashboard.contacts from dashboard.leads when only leads is set", () => {
    const result = normalizeDashboardBootstrap({
      featureFlags: { "dashboard.leads": true }
    });
    expect(result.featureFlags["dashboard.contacts"]).toBe(true);
    expect(result.featureFlags["dashboard.leads"]).toBe(true);
  });

  it("aliases dashboard.leads from dashboard.contacts when only contacts is set", () => {
    const result = normalizeDashboardBootstrap({
      featureFlags: { "dashboard.contacts": false }
    });
    expect(result.featureFlags["dashboard.leads"]).toBe(false);
    expect(result.featureFlags["dashboard.contacts"]).toBe(false);
  });

  it("defaults both contacts and leads to true when neither flag is set", () => {
    const result = normalizeDashboardBootstrap({ featureFlags: {} });
    expect(result.featureFlags["dashboard.contacts"]).toBe(true);
    expect(result.featureFlags["dashboard.leads"]).toBe(true);
  });

  it("preserves other feature flags unchanged", () => {
    const result = normalizeDashboardBootstrap({
      featureFlags: {
        "dashboard.inbox": true,
        "dashboard.billing": false,
        "dashboard.studio.test": true
      }
    });
    expect(result.featureFlags["dashboard.inbox"]).toBe(true);
    expect(result.featureFlags["dashboard.billing"]).toBe(false);
    expect(result.featureFlags["dashboard.studio.test"]).toBe(true);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it("is idempotent — normalizing an already-normalized result produces the same output", () => {
    const once = normalizeDashboardBootstrap({
      userSummary: {
        id: "u1", name: "Test", email: "t@t.com",
        subscriptionPlan: "pro", aiActive: true, personality: "custom"
      },
      planEntitlements: {
        planCode: "pro", maxApiNumbers: 2,
        maxAgentProfiles: 3, prioritySupport: false
      },
      featureFlags: { "dashboard.inbox": true },
      creditsSummary: {
        total_credits: 1000, used_credits: 100,
        remaining_credits: 900, low_credit: false,
        low_credit_threshold_percent: 10, low_credit_message: null
      },
      agentSummary: {
        configuredProfiles: 1, activeProfiles: 1,
        hasConfiguredProfile: true, hasActiveProfile: true
      },
      channelSummary: {
        website: { enabled: true },
        whatsapp: {
          enabled: true, status: "connected",
          phoneNumber: "+91999", hasQr: false, qr: null
        },
        metaApi: { connected: false, enabled: false, connection: null, connections: [] },
        anyConnected: true
      }
    });
    const twice = normalizeDashboardBootstrap(once);
    expect(twice).toEqual(once);
  });

  // ── Missing top-level sections ─────────────────────────────────────────────

  it("handles missing agentSummary by using defaults", () => {
    const result = normalizeDashboardBootstrap({ userSummary: undefined } as never);
    expect(result.agentSummary.configuredProfiles).toBe(0);
    expect(result.agentSummary.hasConfiguredProfile).toBe(false);
  });

  it("handles missing channelSummary by using defaults", () => {
    const result = normalizeDashboardBootstrap({} as never);
    expect(result.channelSummary.anyConnected).toBe(false);
    expect(result.channelSummary.whatsapp.status).toBe("disconnected");
    expect(result.channelSummary.metaApi.connected).toBe(false);
  });
});
