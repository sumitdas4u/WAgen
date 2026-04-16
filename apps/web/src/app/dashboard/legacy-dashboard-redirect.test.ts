import { describe, expect, it } from "vitest";
import { resolveLegacyDashboardPath } from "./legacy-dashboard-redirect";

describe("resolveLegacyDashboardPath", () => {
  // ── Main section tabs ─────────────────────────────────────────────────────

  it("resolves ?tab=knowledge to studio/knowledge", () => {
    expect(resolveLegacyDashboardPath("?tab=knowledge")).toBe("/dashboard/studio/knowledge");
  });

  it("resolves ?tab=leads to /dashboard/leads", () => {
    expect(resolveLegacyDashboardPath("?tab=leads")).toBe("/dashboard/leads");
  });

  it("resolves ?tab=contacts (legacy alias) to /dashboard/leads", () => {
    expect(resolveLegacyDashboardPath("?tab=contacts")).toBe("/dashboard/leads");
  });

  it("resolves ?tab=billing to /dashboard/billing", () => {
    expect(resolveLegacyDashboardPath("?tab=billing")).toBe("/dashboard/billing");
  });

  it("resolves ?tab=conversations to /dashboard/inbox", () => {
    expect(resolveLegacyDashboardPath("?tab=conversations")).toBe("/dashboard/inbox");
  });

  it("resolves ?tab=chatbot_personality to /dashboard/studio/personality", () => {
    expect(resolveLegacyDashboardPath("?tab=chatbot_personality")).toBe("/dashboard/studio/personality");
  });

  it("resolves ?tab=unanswered_questions to /dashboard/studio/review", () => {
    expect(resolveLegacyDashboardPath("?tab=unanswered_questions")).toBe("/dashboard/studio/review");
  });

  it("resolves ?tab=bot_agents to /dashboard/agents", () => {
    expect(resolveLegacyDashboardPath("?tab=bot_agents")).toBe("/dashboard/agents");
  });

  it("resolves ?tab=test_chatbot to /dashboard/studio/test", () => {
    expect(resolveLegacyDashboardPath("?tab=test_chatbot")).toBe("/dashboard/studio/test");
  });

  // ── Settings with submenus ────────────────────────────────────────────────

  it("resolves ?tab=settings (no submenu) to /dashboard/settings/web", () => {
    expect(resolveLegacyDashboardPath("?tab=settings")).toBe("/dashboard/settings/web");
  });

  it("resolves ?tab=settings&submenu=setup_qr to /dashboard/settings/qr", () => {
    expect(resolveLegacyDashboardPath("?tab=settings&submenu=setup_qr")).toBe("/dashboard/settings/qr");
  });

  it("resolves ?tab=settings&submenu=setup_api to /dashboard/settings/api", () => {
    expect(resolveLegacyDashboardPath("?tab=settings&submenu=setup_api")).toBe("/dashboard/settings/api");
  });

  it("resolves ?tab=settings with unknown submenu to /dashboard/settings/web", () => {
    expect(resolveLegacyDashboardPath("?tab=settings&submenu=unknown_submenu")).toBe("/dashboard/settings/web");
  });

  // ── Fallback / edge cases ─────────────────────────────────────────────────

  it("resolves empty search string to /dashboard/inbox", () => {
    expect(resolveLegacyDashboardPath("")).toBe("/dashboard/inbox");
  });

  it("resolves unknown tab to /dashboard/inbox", () => {
    expect(resolveLegacyDashboardPath("?tab=nonexistent_tab")).toBe("/dashboard/inbox");
  });

  it("resolves ?tab=conversations with extra unrelated params to /dashboard/inbox", () => {
    expect(resolveLegacyDashboardPath("?tab=conversations&foo=bar")).toBe("/dashboard/inbox");
  });

  it("resolves ?tab=settings with extra unrelated params (no submenu) to /dashboard/settings/web", () => {
    expect(resolveLegacyDashboardPath("?tab=settings&foo=bar")).toBe("/dashboard/settings/web");
  });
});
