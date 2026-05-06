import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const existingContact = {
    id: "contact-1",
    user_id: "user-1",
    display_name: "Ada",
    phone_number: "919999999999",
    email: null,
    contact_type: "lead",
    tags: ["vip"],
    marketing_consent_status: "subscribed",
    marketing_consent_recorded_at: "2026-01-01T00:00:00.000Z",
    marketing_consent_source: "system",
    marketing_consent_text: null,
    marketing_consent_proof_ref: null,
    marketing_unsubscribed_at: null,
    marketing_unsubscribe_source: null,
    global_opt_out_at: null,
    source_type: "api",
    source_id: null,
    source_url: null,
    linked_conversation_id: "conv-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z"
  };

  return {
    existingContact,
    clientQueryMock: vi.fn(),
    poolQueryMock: vi.fn(),
    releaseMock: vi.fn()
  };
});

vi.mock("../db/pool.js", () => ({
  pool: {
    connect: vi.fn(async () => ({
      query: mocks.clientQueryMock,
      release: mocks.releaseMock
    })),
    query: mocks.poolQueryMock,
    on: vi.fn()
  },
  withTransaction: async <T>(fn: (client: { query: typeof mocks.clientQueryMock }) => Promise<T>) => {
    const client = { query: mocks.clientQueryMock };
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}));

vi.mock("./event-fanout-service.js", () => ({
  fanoutEvent: vi.fn()
}));

vi.mock("./realtime-hub.js", () => ({
  realtimeHub: {
    broadcast: vi.fn()
  }
}));

vi.mock("./sequence-event-service.js", () => ({
  processSequenceEvent: vi.fn()
}));

import { upsertWebhookContact } from "./contacts-service.js";

describe("upsertWebhookContact", () => {
  beforeEach(() => {
    mocks.clientQueryMock.mockReset();
    mocks.poolQueryMock.mockReset();
    mocks.releaseMock.mockReset();
    mocks.clientQueryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT *") && sql.includes("FROM contacts")) {
        return { rows: [mocks.existingContact], rowCount: 1 };
      }
      if (sql.includes("FROM conversations")) {
        return { rows: [{ id: "conv-1" }], rowCount: 1 };
      }
      if (sql.includes("UPDATE contacts")) {
        return {
          rows: [{
            ...mocks.existingContact,
            display_name: params?.[0],
            email: params?.[1],
            contact_type: params?.[2],
            tags: params?.[3]
          }],
          rowCount: 1
        };
      }
      if (sql.includes("UPDATE conversations")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    mocks.poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("preserves existing tags when inbound webhook contact data has no tags", async () => {
    await upsertWebhookContact({
      userId: "user-1",
      phoneNumber: "+919999999999",
      displayName: "Ada"
    });

    const updateCall = mocks.clientQueryMock.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE contacts") && String(sql).includes("tags = $4::text[]")
    );

    expect(updateCall?.[1]?.[3]).toEqual(["vip"]);
  });
});
