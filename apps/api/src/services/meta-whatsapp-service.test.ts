import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock("../db/pool.js", () => ({
  pool: {
    query: dbMocks.query
  }
}));

import { listMetaBusinessConnections, summarizeMetaWebhookMessage } from "./meta-whatsapp-service.js";

function makeMetaConnectionRow(overrides: Record<string, unknown>) {
  return {
    id: "connection-1",
    user_id: "user-1",
    meta_business_id: "business-1",
    waba_id: "waba-1",
    phone_number_id: "phone-1",
    display_phone_number: "+91 98765 43210",
    linked_number: "919876543210",
    access_token_encrypted: "encrypted-token",
    token_expires_at: null,
    enabled: false,
    subscription_status: "inactive",
    status: "disconnected",
    billing_mode: "none",
    billing_status: "not_configured",
    billing_owner_business_id: null,
    billing_attached_at: null,
    billing_error: null,
    billing_credit_line_id: null,
    billing_allocation_config_id: null,
    billing_currency: null,
    metadata_json: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

beforeEach(() => {
  dbMocks.query.mockReset();
});

describe("summarizeMetaWebhookMessage", () => {
  it("extracts plain text messages", () => {
    expect(
      summarizeMetaWebhookMessage({
        text: { body: "Hello from Meta" }
      })
    ).toEqual({
      text: "Hello from Meta",
      flowText: "Hello from Meta"
    });
  });

  it("summarizes shared contacts", () => {
    expect(
      summarizeMetaWebhookMessage({
        contacts: [
          {
            name: { formatted_name: "Ada Lovelace" },
            phones: [{ phone: "+15551234567" }],
            org: { company: "Analytical Engines" }
          }
        ]
      })
    ).toEqual({
      text: "[CONTACT] Ada Lovelace\nAnalytical Engines\n+15551234567",
      flowText: "[CONTACT] Ada Lovelace\nAnalytical Engines\n+15551234567"
    });
  });

  it("summarizes reactions", () => {
    expect(
      summarizeMetaWebhookMessage({
        reaction: { emoji: "🔥", message_id: "wamid.1" }
      })
    ).toEqual({
      text: "[REACTION] 🔥",
      flowText: "[REACTION] 🔥"
    });
  });

  it("falls back to sticker summary", () => {
    expect(
      summarizeMetaWebhookMessage({
        sticker: { id: "media-1" }
      })
    ).toEqual({
      text: "[Sticker received]",
      flowText: "[Sticker received]"
    });
  });
});

describe("listMetaBusinessConnections", () => {
  it("collapses duplicate deleted rows for the same physical phone number", async () => {
    dbMocks.query.mockResolvedValueOnce({
      rows: [
        makeMetaConnectionRow({
          id: "older-deleted",
          phone_number_id: "phone-old",
          linked_number: "91782453480",
          updated_at: "2026-01-01T00:00:00.000Z"
        }),
        makeMetaConnectionRow({
          id: "newer-deleted",
          phone_number_id: "phone-new",
          linked_number: "91782453480",
          updated_at: "2026-02-01T00:00:00.000Z"
        }),
        makeMetaConnectionRow({
          id: "different-number",
          phone_number_id: "phone-other",
          display_phone_number: "+91 90000 00000",
          linked_number: "919000000000",
          updated_at: "2026-01-15T00:00:00.000Z"
        })
      ],
      rowCount: 3
    });

    const connections = await listMetaBusinessConnections("user-1", {
      includeDisconnected: true
    });

    expect(connections.map((connection) => connection.id)).toEqual([
      "newer-deleted",
      "different-number"
    ]);
  });
});
