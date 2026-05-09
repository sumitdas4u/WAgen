import { describe, expect, it, vi, beforeEach } from "vitest";
import { PlanLimitExceededError } from "./plan-entitlement-service.js";

const {
  mockPoolQuery,
  mockGetUserPlanEntitlements,
  mockRequireMetaConnection,
  mockGetSegmentContacts,
  mockFindSuppressedRecipients,
  mockGetMessageTemplate,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockGetUserPlanEntitlements: vi.fn(),
  mockRequireMetaConnection: vi.fn().mockResolvedValue(undefined),
  mockGetSegmentContacts: vi.fn(),
  mockFindSuppressedRecipients: vi.fn().mockResolvedValue(new Map()),
  mockGetMessageTemplate: vi.fn(),
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery },
  withTransaction: vi.fn(),
}));

vi.mock("./billing-service.js", () => ({
  getUserPlanEntitlements: mockGetUserPlanEntitlements,
}));

vi.mock("./meta-whatsapp-service.js", () => ({
  requireMetaConnection: mockRequireMetaConnection,
}));

vi.mock("./contact-segments-service.js", () => ({
  getSegmentContacts: mockGetSegmentContacts,
}));

vi.mock("./message-delivery-data-service.js", () => ({
  findSuppressedRecipients: mockFindSuppressedRecipients,
}));

vi.mock("./template-service.js", () => ({
  getMessageTemplate: mockGetMessageTemplate,
  resolveTemplatePayload: vi.fn(),
  uploadMediaUrlToMetaId: vi.fn(),
}));

vi.mock("./outbound-policy-service.js", () => ({
  evaluateOutboundTemplatePolicy: vi.fn().mockResolvedValue({ allowed: true, reasons: [] }),
  summarizeOutboundPolicyReasons: vi.fn().mockReturnValue(""),
}));

import { launchCampaign } from "./campaign-service.js";

const makeCampaign = (overrides = {}) => ({
  id: "camp-1",
  user_id: "user-1",
  name: "Test Campaign",
  status: "draft",
  connection_id: "conn-1",
  template_id: "tmpl-1",
  target_segment_id: "seg-1",
  broadcast_type: "standard",
  source_campaign_id: null,
  retarget_status: null,
  audience_source_json: {},
  media_overrides_json: {},
  template_variables: {},
  scheduled_at: null,
  started_at: null,
  completed_at: null,
  total_count: 0,
  sent_count: 0,
  delivered_count: 0,
  read_count: 0,
  failed_count: 0,
  skipped_count: 0,
  enforce_marketing_policy: true,
  smart_retry_enabled: false,
  smart_retry_until: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const makeContact = (id: string) => ({
  id,
  phone_number: `+91900000${id.slice(-4)}`,
  name: `Contact ${id}`,
  email: null,
  metadata: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

describe("launchCampaign — monthly recipient cap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws PlanLimitExceededError when monthly cap would be exceeded", async () => {
    mockGetUserPlanEntitlements.mockResolvedValue({ broadcastMonthlyRecipients: 250 });
    mockGetSegmentContacts.mockResolvedValue(Array.from({ length: 20 }, (_, i) => makeContact(`c${i}`)));
    mockGetMessageTemplate.mockResolvedValue({
      id: "tmpl-1",
      connectionId: "conn-1",
      status: "APPROVED",
      components: [],
    });

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [makeCampaign()], rowCount: 1 })   // getCampaign
      .mockResolvedValueOnce({ rows: [{ monthly_used: "240" }] });       // getMonthlyRecipientCount

    await expect(launchCampaign("user-1", "camp-1")).rejects.toBeInstanceOf(PlanLimitExceededError);
  });

  it("does not throw when within monthly cap", async () => {
    mockGetUserPlanEntitlements.mockResolvedValue({ broadcastMonthlyRecipients: 1000 });
    mockGetSegmentContacts.mockResolvedValue(Array.from({ length: 10 }, (_, i) => makeContact(`c${i}`)));
    mockGetMessageTemplate.mockResolvedValue({
      id: "tmpl-1",
      connectionId: "conn-1",
      status: "APPROVED",
      components: [],
    });

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [makeCampaign()], rowCount: 1 })   // getCampaign
      .mockResolvedValueOnce({ rows: [{ monthly_used: "200" }] })        // getMonthlyRecipientCount
      .mockResolvedValue({ rows: [], rowCount: 0 });                    // remaining queries

    // Should not throw PlanLimitExceededError — may throw other errors from incomplete mocks
    const result = await launchCampaign("user-1", "camp-1").catch(e => e);
    expect(result).not.toBeInstanceOf(PlanLimitExceededError);
  });
});
