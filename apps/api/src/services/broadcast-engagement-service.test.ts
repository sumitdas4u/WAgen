import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPoolQuery, mockWithTransaction } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockWithTransaction: vi.fn(),
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery },
  withTransaction: mockWithTransaction,
}));

import {
  recordBroadcastEngagement,
  getBroadcastEngagementTimeline,
  type BroadcastEngagementInput,
} from "./broadcast-engagement-service.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordBroadcastEngagement", () => {
  it("inserts clicked_button event when wamid matches campaign message", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: "msg-1", campaign_id: "camp-1", contact_id: "contact-1", clicked_at: null, replied_at: null, quote_replied_at: null }],
    });
    mockWithTransaction.mockImplementation(async (fn: (client: unknown) => Promise<void>) => {
      const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      await fn(mockClient);
    });

    const input: BroadcastEngagementInput = {
      eventType: "clicked_button",
      wamid: "wamid.ABC123",
      contactId: "contact-1",
    };

    await recordBroadcastEngagement(input);

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM campaign_messages"),
      ["wamid.ABC123"]
    );
    expect(mockWithTransaction).toHaveBeenCalledOnce();
  });

  it("does nothing when wamid does not match any campaign message", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await recordBroadcastEngagement({
      eventType: "clicked_button",
      wamid: "wamid.UNKNOWN",
      contactId: null,
    });

    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("inserts replied_any event by contact lookup when no wamid", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: "msg-2", campaign_id: "camp-2", contact_id: "contact-2", clicked_at: null, replied_at: null, quote_replied_at: null }],
    });
    mockWithTransaction.mockImplementation(async (fn: (client: unknown) => Promise<void>) => {
      const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      await fn(mockClient);
    });

    await recordBroadcastEngagement({
      eventType: "replied_any",
      wamid: null,
      contactId: "contact-2",
    });

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM campaign_messages"),
      expect.arrayContaining(["contact-2"])
    );
    expect(mockWithTransaction).toHaveBeenCalledOnce();
  });

  it("skips counter increment when clicked_at already set", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: "msg-1", campaign_id: "camp-1", contact_id: "contact-1", clicked_at: "2026-01-01T00:00:00Z", replied_at: null, quote_replied_at: null }],
    });
    const mockClientQuery = vi.fn().mockResolvedValue({ rows: [] });
    mockWithTransaction.mockImplementation(async (fn: (client: unknown) => Promise<void>) => {
      await fn({ query: mockClientQuery });
    });

    await recordBroadcastEngagement({
      eventType: "clicked_button",
      wamid: "wamid.ABC123",
      contactId: "contact-1",
    });

    expect(mockWithTransaction).toHaveBeenCalledOnce();
    // Only 2 queries (insert event + update timestamp), NOT 3 (no counter increment)
    expect(mockClientQuery).toHaveBeenCalledTimes(2);
  });

  it("looks up by campaignMsgId when provided", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: "msg-3", campaign_id: "camp-3", contact_id: null, clicked_at: null, replied_at: null, quote_replied_at: null }],
    });
    mockWithTransaction.mockImplementation(async (fn: (client: unknown) => Promise<void>) => {
      await fn({ query: vi.fn().mockResolvedValue({ rows: [] }) });
    });

    await recordBroadcastEngagement({
      eventType: "clicked_url",
      wamid: null,
      contactId: null,
      campaignMsgId: "msg-3",
    });

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = $1"),
      ["msg-3"]
    );
  });
});

describe("getBroadcastEngagementTimeline", () => {
  it("returns aggregated buckets grouped by day", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        { period: "2026-01-23T00:00:00.000Z", clicked_button: "12", clicked_url: "3", replied_any: "5", replied_quote: "2" },
        { period: "2026-01-24T00:00:00.000Z", clicked_button: "8", clicked_url: "1", replied_any: "3", replied_quote: "1" },
      ],
    });

    const result = await getBroadcastEngagementTimeline("camp-1", "day");

    expect(result).toEqual([
      { period: "2026-01-23T00:00:00.000Z", clicked_button: 12, clicked_url: 3, replied_any: 5, replied_quote: 2 },
      { period: "2026-01-24T00:00:00.000Z", clicked_button: 8, clicked_url: 1, replied_any: 3, replied_quote: 1 },
    ]);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("date_trunc"),
      ["camp-1"]
    );
  });

  it("returns empty array when no events exist", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getBroadcastEngagementTimeline("camp-1", "week");
    expect(result).toEqual([]);
  });
});
