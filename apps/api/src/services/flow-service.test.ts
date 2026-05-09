import { describe, expect, it, vi, beforeEach } from "vitest";
import { PlanLimitExceededError } from "./plan-entitlement-service.js";

const { mockPoolQuery, mockGetUserPlanEntitlements, mockRequireMetaConnection } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockGetUserPlanEntitlements: vi.fn(),
  mockRequireMetaConnection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery },
}));

vi.mock("./billing-service.js", () => ({
  getUserPlanEntitlements: mockGetUserPlanEntitlements,
}));

vi.mock("./meta-whatsapp-service.js", () => ({
  requireMetaConnection: mockRequireMetaConnection,
}));

import { publishFlow } from "./flow-service.js";

const makeFlowRow = (id: string, published: boolean, channel: "api" | "web" = "web") => ({
  id,
  user_id: "user-1",
  name: "Test Flow",
  channel,
  connection_id: channel === "api" ? "conn-1" : null,
  nodes: [],
  edges: [],
  triggers: [],
  variables: {},
  published,
  is_default_reply: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

describe("publishFlow — maxActiveFlows enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMetaConnection.mockResolvedValue(undefined);
  });

  it("allows publishing when no other active flows (under limit)", async () => {
    mockGetUserPlanEntitlements.mockResolvedValue({ maxActiveFlows: 1 });
    // getFlow returns the flow, getPublishedFlowsForUser returns no other active flows, UPDATE succeeds
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [makeFlowRow("flow-1", false)], rowCount: 1 }) // getFlow
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                              // getPublishedFlowsForUser
      .mockResolvedValueOnce({ rows: [makeFlowRow("flow-1", true)], rowCount: 1 }); // UPDATE

    const result = await publishFlow("user-1", "flow-1", true);
    expect(result?.published).toBe(true);
  });

  it("throws PlanLimitExceededError when another flow is already active", async () => {
    mockGetUserPlanEntitlements.mockResolvedValue({ maxActiveFlows: 1 });
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [makeFlowRow("flow-new", false)], rowCount: 1 }) // getFlow
      .mockResolvedValueOnce({ rows: [makeFlowRow("flow-other", true)], rowCount: 1 }); // getPublishedFlowsForUser

    await expect(publishFlow("user-1", "flow-new", true)).rejects.toBeInstanceOf(PlanLimitExceededError);
  });

  it("allows re-publishing an already-active flow (idempotent)", async () => {
    mockGetUserPlanEntitlements.mockResolvedValue({ maxActiveFlows: 1 });
    // The flow being published is already in the published list — otherPublished should be empty
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [makeFlowRow("flow-1", true)], rowCount: 1 })  // getFlow
      .mockResolvedValueOnce({ rows: [makeFlowRow("flow-1", true)], rowCount: 1 })  // getPublishedFlowsForUser (same flow)
      .mockResolvedValueOnce({ rows: [makeFlowRow("flow-1", true)], rowCount: 1 }); // UPDATE

    const result = await publishFlow("user-1", "flow-1", true);
    expect(result?.published).toBe(true);
  });

  it("allows unpublishing regardless of how many active flows exist", async () => {
    mockGetUserPlanEntitlements.mockResolvedValue({ maxActiveFlows: 1 });
    // unpublish should skip the cap check entirely
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [makeFlowRow("flow-1", true)], rowCount: 1 })   // getFlow
      .mockResolvedValueOnce({ rows: [makeFlowRow("flow-1", false)], rowCount: 1 }); // UPDATE

    const result = await publishFlow("user-1", "flow-1", false);
    expect(result?.published).toBe(false);
    expect(mockGetUserPlanEntitlements).not.toHaveBeenCalled();
  });
});
