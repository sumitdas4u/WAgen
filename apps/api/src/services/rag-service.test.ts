import { describe, expect, it, vi, beforeEach } from "vitest";
import { PlanLimitExceededError } from "./plan-entitlement-service.js";

const { mockPoolQuery, mockGetUserPlanEntitlements } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockGetUserPlanEntitlements: vi.fn(),
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery },
}));

vi.mock("./billing-service.js", () => ({
  getUserPlanEntitlements: mockGetUserPlanEntitlements,
}));

import { assertKnowledgeSourceLimit } from "./rag-service.js";

describe("assertKnowledgeSourceLimit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves when sources count is under limit", async () => {
    mockGetUserPlanEntitlements.mockResolvedValue({ maxKnowledgeSources: 2 });
    // listKnowledgeSources returns 1 existing source
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ source_type: "manual", source_name: "a", chunks: "5", last_ingested_at: new Date().toISOString() }],
    });

    await expect(assertKnowledgeSourceLimit("user-1")).resolves.toBeUndefined();
  });

  it("throws PlanLimitExceededError when at limit", async () => {
    mockGetUserPlanEntitlements.mockResolvedValue({ maxKnowledgeSources: 1 });
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ source_type: "manual", source_name: "a", chunks: "5", last_ingested_at: new Date().toISOString() }],
    });

    await expect(assertKnowledgeSourceLimit("user-1")).rejects.toBeInstanceOf(PlanLimitExceededError);
  });

  it("allows ingest when sources list is empty", async () => {
    mockGetUserPlanEntitlements.mockResolvedValue({ maxKnowledgeSources: 1 });
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await expect(assertKnowledgeSourceLimit("user-1")).resolves.toBeUndefined();
  });
});
