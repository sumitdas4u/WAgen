import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock("../db/pool.js", () => ({
  pool: {
    query: dbMocks.query
  }
}));

import {
  buildMetaBusinessProfileUpdatePayload,
  graphUploadFileHandle,
  listMetaBusinessConnections,
  normalizeMetaBusinessProfileImageMimeType,
  summarizeMetaWebhookMessage,
  validateMetaBusinessProfileImage
} from "./meta-whatsapp-service.js";

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
  vi.unstubAllGlobals();
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

describe("buildMetaBusinessProfileUpdatePayload", () => {
  it("maps editable profile fields to Meta payload names", () => {
    const payload = buildMetaBusinessProfileUpdatePayload({
      about: "  Usually replies in minutes  ",
      address: "  12 Market Street  ",
      businessDescription: "  Customer support and updates  ",
      email: " support@example.com ",
      vertical: "RETAIL",
      websites: ["https://example.com", "https://instagram.com/example"],
      profilePictureHandle: " h:profile-picture "
    });

    expect(payload).toEqual({
      messaging_product: "whatsapp",
      about: "Usually replies in minutes",
      address: "12 Market Street",
      description: "Customer support and updates",
      email: "support@example.com",
      vertical: "RETAIL",
      websites: ["https://example.com", "https://instagram.com/example"],
      profile_picture_handle: "h:profile-picture"
    });
  });

  it("allows the documented empty vertical value", () => {
    expect(buildMetaBusinessProfileUpdatePayload({ vertical: "" })).toEqual({
      messaging_product: "whatsapp",
      vertical: ""
    });
  });

  it("rejects invalid vertical values", () => {
    expect(() => buildMetaBusinessProfileUpdatePayload({ vertical: "CHARITY" })).toThrow(/Vertical/);
  });

  it("rejects empty about when provided", () => {
    expect(() => buildMetaBusinessProfileUpdatePayload({ about: "   " })).toThrow(/About cannot be empty/);
  });

  it("enforces documented field limits", () => {
    expect(() => buildMetaBusinessProfileUpdatePayload({ about: "a".repeat(140) })).toThrow(/About/);
    expect(() => buildMetaBusinessProfileUpdatePayload({ address: "a".repeat(257) })).toThrow(/Address/);
    expect(() => buildMetaBusinessProfileUpdatePayload({ businessDescription: "a".repeat(513) })).toThrow(/Description/);
    expect(() =>
      buildMetaBusinessProfileUpdatePayload({
        email: `${"a".repeat(117)}@example.com`
      })
    ).toThrow(/Email/);
  });

  it("accepts at most two websites", () => {
    expect(
      buildMetaBusinessProfileUpdatePayload({
        websites: ["https://one.example", "https://two.example"]
      }).websites
    ).toEqual(["https://one.example", "https://two.example"]);

    expect(() =>
      buildMetaBusinessProfileUpdatePayload({
        websites: ["https://one.example", "https://two.example", "https://three.example"]
      })
    ).toThrow(/at most 2 websites/);
  });

  it("rejects websites without http or https protocol", () => {
    expect(() => buildMetaBusinessProfileUpdatePayload({ websites: ["example.com"] })).toThrow(/http/);
  });

  it("uses websites over legacy websiteUrl when both are provided", () => {
    expect(
      buildMetaBusinessProfileUpdatePayload({
        websiteUrl: "https://legacy.example",
        websites: ["https://primary.example"]
      }).websites
    ).toEqual(["https://primary.example"]);
  });

  it("keeps legacy websiteUrl fallback when websites are missing", () => {
    expect(buildMetaBusinessProfileUpdatePayload({ websiteUrl: "https://legacy.example" }).websites).toEqual([
      "https://legacy.example"
    ]);
  });
});

describe("Meta profile picture upload helpers", () => {
  function makePng(width: number, height: number): Buffer {
    const buffer = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
    buffer.writeUInt32BE(13, 8);
    buffer.write("IHDR", 12, "ascii");
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
  }

  function makeJpeg(width: number, height: number): Buffer {
    const buffer = Buffer.alloc(32);
    buffer[0] = 0xff;
    buffer[1] = 0xd8;
    buffer[2] = 0xff;
    buffer[3] = 0xc0;
    buffer.writeUInt16BE(17, 4);
    buffer[6] = 8;
    buffer.writeUInt16BE(height, 7);
    buffer.writeUInt16BE(width, 9);
    return buffer;
  }

  it("normalizes accepted WhatsApp profile image MIME types", () => {
    expect(normalizeMetaBusinessProfileImageMimeType("image/jpg")).toBe("image/jpeg");
    expect(normalizeMetaBusinessProfileImageMimeType(" image/jpeg ")).toBe("image/jpeg");
    expect(normalizeMetaBusinessProfileImageMimeType("image/png")).toBe("image/png");
    expect(() => normalizeMetaBusinessProfileImageMimeType("image/webp")).toThrow(/JPG or PNG/);
  });

  it("validates square profile image dimensions", () => {
    expect(validateMetaBusinessProfileImage({ fileBuffer: makePng(640, 640), mimeType: "image/png" })).toEqual({
      mimeType: "image/png",
      width: 640,
      height: 640
    });
    expect(validateMetaBusinessProfileImage({ fileBuffer: makeJpeg(512, 512), mimeType: "image/jpeg" })).toEqual({
      mimeType: "image/jpeg",
      width: 512,
      height: 512
    });
    expect(() => validateMetaBusinessProfileImage({ fileBuffer: makePng(640, 320), mimeType: "image/png" })).toThrow(
      /must be square/
    );
    expect(() => validateMetaBusinessProfileImage({ fileBuffer: makeJpeg(128, 128), mimeType: "image/jpeg" })).toThrow(
      /at least 192x192/
    );
  });

  it("uploads resumable file data as raw bytes with Meta-required headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ h: "h:profile-handle" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const buffer = Buffer.from("profile-image");
    await expect(graphUploadFileHandle("upload-session-1", "token-1", buffer, "image/jpeg")).resolves.toEqual({
      h: "h:profile-handle"
    });

    const uploadBody = fetchMock.mock.calls[0]?.[1]?.body as ArrayBuffer;
    expect(Buffer.from(uploadBody)).toEqual(buffer);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/upload-session-1"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "OAuth token-1",
          Accept: "*/*",
          file_offset: "0",
          "Content-Type": "image/jpeg",
          "Content-Length": String(buffer.byteLength)
        })
      })
    );
  });
});
