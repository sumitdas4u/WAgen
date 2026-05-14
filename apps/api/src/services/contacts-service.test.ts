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

vi.mock("./reminder-capture-trigger-service.js", () => ({
  processReminderCaptureEvent: vi.fn()
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

  it("matches an existing imported local phone when inbound webhook includes country code", async () => {
    const localPhoneContact = {
      ...mocks.existingContact,
      phone_number: "9875492875",
      tags: ["Nursing home"]
    };

    mocks.clientQueryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT *") && sql.includes("FROM contacts")) {
        if (String(sql).includes("right(regexp_replace")) {
          return { rows: [localPhoneContact], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM conversations")) {
        return { rows: [{ id: "conv-1" }], rowCount: 1 };
      }
      if (sql.includes("UPDATE contacts")) {
        return {
          rows: [{
            ...localPhoneContact,
            display_name: params?.[0],
            email: params?.[1],
            contact_type: params?.[2],
            tags: params?.[3],
            linked_conversation_id: params?.[15]
          }],
          rowCount: 1
        };
      }
      if (sql.includes("UPDATE conversations")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const contact = await upsertWebhookContact({
      userId: "user-1",
      phoneNumber: "919875492875",
      displayName: "Calcutta Institute"
    });

    expect(contact.id).toBe(localPhoneContact.id);
    expect(contact.tags).toEqual(["Nursing home"]);

    const insertCall = mocks.clientQueryMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO contacts"));
    expect(insertCall).toBeUndefined();
  });

  it("updates only the phone to include the webhook country code when suffix-matched", async () => {
    const localPhoneContact = {
      ...mocks.existingContact,
      display_name: "Mr Souvik Saha",
      phone_number: "8584033451",
      contact_type: "lead",
      tags: ["demo-user"]
    };

    mocks.clientQueryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT *") && sql.includes("FROM contacts")) {
        if (String(sql).includes("right(regexp_replace")) {
          return { rows: [localPhoneContact], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM conversations")) {
        return { rows: [{ id: "conv-1" }], rowCount: 1 };
      }
      if (sql.includes("UPDATE contacts")) {
        return {
          rows: [{
            ...localPhoneContact,
            display_name: params?.[0],
            email: params?.[1],
            contact_type: params?.[2],
            tags: params?.[3],
            linked_conversation_id: params?.[15],
            phone_number: params?.[16]
          }],
          rowCount: 1
        };
      }
      if (sql.includes("UPDATE conversations")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const contact = await upsertWebhookContact({
      userId: "user-1",
      phoneNumber: "918584033451",
      displayName: null
    });

    expect(contact.id).toBe(localPhoneContact.id);
    expect(contact.phone_number).toBe("918584033451");
    expect(contact.display_name).toBe("Mr Souvik Saha");
    expect(contact.contact_type).toBe("lead");
    expect(contact.tags).toEqual(["demo-user"]);

    const insertCall = mocks.clientQueryMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO contacts"));
    expect(insertCall).toBeUndefined();
  });

  it("matches country-code prefixes generically, not only India +91", async () => {
    const localPhoneContact = {
      ...mocks.existingContact,
      phone_number: "2025550188",
      tags: ["usa-lead"]
    };

    mocks.clientQueryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT *") && sql.includes("FROM contacts")) {
        if (String(sql).includes("right(regexp_replace")) {
          return { rows: [localPhoneContact], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM conversations")) {
        return { rows: [{ id: "conv-1" }], rowCount: 1 };
      }
      if (sql.includes("UPDATE contacts")) {
        return {
          rows: [{
            ...localPhoneContact,
            display_name: params?.[0],
            email: params?.[1],
            contact_type: params?.[2],
            tags: params?.[3],
            linked_conversation_id: params?.[15]
          }],
          rowCount: 1
        };
      }
      if (sql.includes("UPDATE conversations")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const contact = await upsertWebhookContact({
      userId: "user-1",
      phoneNumber: "12025550188",
      displayName: "US Lead"
    });

    expect(contact.id).toBe(localPhoneContact.id);
    expect(contact.tags).toEqual(["usa-lead"]);
  });
});
