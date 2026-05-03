import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  evaluateFrequencyCap,
  evaluateHardBlocks,
  evaluateMarketingConsent,
  recordFrequencyCapSend,
} from "./outbound-policy-service.js";
import type { Contact } from "../types/models.js";

// ─── Hoist mock variables so vi.mock factories can reference them ─────────────

const { mockRedis, redisStore, mockPoolQuery } = vi.hoisted(() => {
  const redisStore = new Map<string, { value: string; expiresAt: number }>();
  const mockRedis = {
    get: vi.fn(async (key: string): Promise<string | null> => {
      const entry = redisStore.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        redisStore.delete(key);
        return null;
      }
      return entry.value;
    }),
    set: vi.fn(async (key: string, value: string, _ex: string, ttlSeconds: number): Promise<string> => {
      redisStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return "OK";
    }),
  };
  const mockPoolQuery = vi.fn();
  return { mockRedis, redisStore, mockPoolQuery };
});

vi.mock("./queue-service.js", () => ({
  getQueueRedisConnection: vi.fn(() => mockRedis),
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery },
}));

vi.mock("./message-delivery-data-service.js", () => ({
  findSuppressedRecipients: vi.fn().mockResolvedValue(new Map()),
}));

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const USER_ID = "user-1";
const CONTACT_ID = "contact-sumit";
const TEMPLATE_ID = "tmpl-summer-sale";
const VARIANT_TEMPLATE_ID = "tmpl-summer-sale-variant";
const PHONE = "919876543210";

const subscribedContact: Contact = {
  id: CONTACT_ID,
  user_id: USER_ID,
  display_name: "Sumit Das",
  phone_number: PHONE,
  email: "sumitdas4u@gmail.com",
  contact_type: "lead",
  tags: [],
  marketing_consent_status: "subscribed",
  marketing_consent_recorded_at: null,
  marketing_consent_source: null,
  marketing_consent_text: null,
  marketing_consent_proof_ref: null,
  marketing_unsubscribed_at: null,
  marketing_unsubscribe_source: null,
  global_opt_out_at: null,
  last_incoming_message_at: null,
  last_outgoing_template_at: null,
  last_outgoing_marketing_at: null,
  last_outgoing_utility_at: null,
  source_type: "manual",
  source_id: null,
  source_url: null,
  linked_conversation_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  custom_field_values: [],
};

beforeEach(() => {
  redisStore.clear();
  mockRedis.get.mockClear();
  mockRedis.set.mockClear();
  mockPoolQuery.mockReset();
  // Default: no variant template found
  mockPoolQuery.mockResolvedValue({ rows: [] });
});

// ─── evaluateHardBlocks — pure function, no external deps ─────────────────────

describe("evaluateHardBlocks", () => {
  it("passes when no blocks apply", () => {
    const result = evaluateHardBlocks({ category: "MARKETING", marketingEnabled: true });
    expect(result.codes).toHaveLength(0);
    expect(result.suppressionAction).toBe("none");
  });

  it("blocks when marketing is disabled for MARKETING template", () => {
    const result = evaluateHardBlocks({ category: "MARKETING", marketingEnabled: false });
    expect(result.codes).toContain("marketing_disabled");
    expect(result.suppressionAction).toBe("block");
  });

  it("does not block UTILITY template even when marketingEnabled=false", () => {
    const result = evaluateHardBlocks({ category: "UTILITY", marketingEnabled: false });
    expect(result.codes).toHaveLength(0);
    expect(result.suppressionAction).toBe("none");
  });

  it("blocks when contact has globally opted out", () => {
    const result = evaluateHardBlocks({
      category: "MARKETING",
      marketingEnabled: true,
      globalOptOut: true,
    });
    expect(result.codes).toContain("global_opt_out");
    expect(result.suppressionAction).toBe("block");
  });

  it("blocks when contact is in suppression list (blocked reason)", () => {
    const result = evaluateHardBlocks({
      category: "MARKETING",
      marketingEnabled: true,
      suppression: { phone_number: PHONE, reason_code: "blocked" } as never,
    });
    expect(result.codes).toContain("suppressed_blocked");
    expect(result.suppressionAction).toBe("block");
  });

  it("blocks opt_out suppression for MARKETING but not for UTILITY", () => {
    const suppression = { phone_number: PHONE, reason_code: "opt_out" } as never;
    expect(
      evaluateHardBlocks({ category: "MARKETING", marketingEnabled: true, suppression }).codes
    ).toContain("suppressed_opt_out");
    expect(
      evaluateHardBlocks({ category: "UTILITY", marketingEnabled: true, suppression }).codes
    ).toHaveLength(0);
  });
});

// ─── evaluateMarketingConsent — pure function ─────────────────────────────────

describe("evaluateMarketingConsent", () => {
  it("returns no codes for non-MARKETING templates", () => {
    expect(evaluateMarketingConsent({ category: "UTILITY", contact: null })).toHaveLength(0);
  });

  it("returns no codes for subscribed contact", () => {
    expect(
      evaluateMarketingConsent({ category: "MARKETING", contact: subscribedContact })
    ).toHaveLength(0);
  });

  it("returns missing_contact when contact is null", () => {
    expect(
      evaluateMarketingConsent({ category: "MARKETING", contact: null })
    ).toContain("missing_contact");
  });

  it("returns marketing_unsubscribed when contact has unsubscribed", () => {
    const contact: Contact = {
      ...subscribedContact,
      marketing_consent_status: "unsubscribed",
    };
    expect(
      evaluateMarketingConsent({ category: "MARKETING", contact })
    ).toContain("marketing_unsubscribed");
  });

  it("returns missing_marketing_consent when consent is unknown", () => {
    const contact: Contact = {
      ...subscribedContact,
      marketing_consent_status: "unknown",
    };
    expect(
      evaluateMarketingConsent({ category: "MARKETING", contact })
    ).toContain("missing_marketing_consent");
  });
});

// ─── evaluateFrequencyCap ─────────────────────────────────────────────────────

describe("evaluateFrequencyCap", () => {
  const capInput = {
    category: "MARKETING" as const,
    templateId: TEMPLATE_ID,
    contactId: CONTACT_ID,
    contact: subscribedContact,
    userId: USER_ID,
  };

  it("TC-1: returns 'send' on first contact (no prior Redis key, no contact history)", async () => {
    const decision = await evaluateFrequencyCap(capInput);
    expect(decision.action).toBe("send");
  });

  it("TC-2: returns 'send' after a FAILED broadcast (failure does not set Redis key)", async () => {
    // Simulate: broadcast was attempted but failed — recordFrequencyCapSend was never called
    // Redis key is absent → should allow send
    const decision = await evaluateFrequencyCap(capInput);
    expect(decision.action).toBe("send");
  });

  it("TC-3: returns 'delay' when same template was SUCCESSFULLY sent within 24h (no variant)", async () => {
    // Simulate a successful send 2 hours ago
    await recordFrequencyCapSend(CONTACT_ID, TEMPLATE_ID);

    const decision = await evaluateFrequencyCap(capInput);
    expect(decision.action).toBe("delay");
    if (decision.action === "delay") {
      const delayUntil = new Date(decision.delayUntil).getTime();
      // delayUntil should be ~24h from now (within 1 minute tolerance)
      expect(delayUntil).toBeGreaterThan(Date.now() + 23.9 * 60 * 60 * 1000);
    }
  });

  it("TC-4: returns 'variant' when cap is hit and an approved variant exists", async () => {
    // Simulate a successful send → cap recorded
    await recordFrequencyCapSend(CONTACT_ID, TEMPLATE_ID);
    // Simulate DB returns a variant template
    mockPoolQuery.mockResolvedValue({ rows: [{ id: VARIANT_TEMPLATE_ID }] });

    const decision = await evaluateFrequencyCap(capInput);
    expect(decision.action).toBe("variant");
    if (decision.action === "variant") {
      expect(decision.variantTemplateId).toBe(VARIANT_TEMPLATE_ID);
    }
  });

  it("TC-5: returns 'send' after the 24h window expires", async () => {
    // Manually inject a Redis entry timestamped 25 hours ago
    const expiredTimestamp = Date.now() - 25 * 60 * 60 * 1000;
    redisStore.set(`freq_cap:${CONTACT_ID}:${TEMPLATE_ID}`, {
      value: String(expiredTimestamp),
      expiresAt: Date.now() + 60_000,
    });

    const decision = await evaluateFrequencyCap(capInput);
    expect(decision.action).toBe("send");
  });

  it("TC-6: different template has its own independent cap — no cap on second template", async () => {
    // First template: cap recorded
    await recordFrequencyCapSend(CONTACT_ID, TEMPLATE_ID);

    // Second template: different ID → no cap recorded → should pass
    const decision = await evaluateFrequencyCap({
      ...capInput,
      templateId: "tmpl-welcome-offer-v1",
    });
    expect(decision.action).toBe("send");
  });

  it("TC-7: UTILITY templates bypass frequency cap always", async () => {
    // Even if a MARKETING key exists for this contact, UTILITY should be unaffected
    await recordFrequencyCapSend(CONTACT_ID, TEMPLATE_ID);
    const decision = await evaluateFrequencyCap({ ...capInput, category: "UTILITY" });
    expect(decision.action).toBe("send");
  });

  it("TC-8: templateId present + no Redis key → 'send' (fallback suppressed, no cross-template block)", async () => {
    // A different template was recently sent (last_outgoing_marketing_at set),
    // but THIS template's Redis key is absent. With a known templateId the
    // fallback must not trigger — different templates are independent.
    const contactWithRecentOtherSend: Contact = {
      ...subscribedContact,
      last_outgoing_marketing_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    };

    const decision = await evaluateFrequencyCap({
      ...capInput, // has templateId
      contact: contactWithRecentOtherSend,
    });
    expect(decision.action).toBe("send");
  });

  it("TC-9: no templateId + recent last_outgoing_marketing_at → fallback fires → 'delay'", async () => {
    // Edge case: templateId is unknown. Fallback to contact-level timestamp is
    // the only signal available, so it should still protect the contact.
    const contactWithRecentSend: Contact = {
      ...subscribedContact,
      last_outgoing_marketing_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    };

    const decision = await evaluateFrequencyCap({
      ...capInput,
      templateId: null, // unknown template
      contact: contactWithRecentSend,
    });
    expect(decision.action).toBe("delay");
  });

  it("TC-10: no templateId + last_outgoing_marketing_at older than 24h → 'send'", async () => {
    const contactWithOldSend: Contact = {
      ...subscribedContact,
      last_outgoing_marketing_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    };

    const decision = await evaluateFrequencyCap({
      ...capInput,
      templateId: null,
      contact: contactWithOldSend,
    });
    expect(decision.action).toBe("send");
  });
});

// ─── recordFrequencyCapSend ───────────────────────────────────────────────────

describe("recordFrequencyCapSend", () => {
  it("stores a timestamp in Redis with the correct key pattern", async () => {
    const before = Date.now();
    await recordFrequencyCapSend(CONTACT_ID, TEMPLATE_ID);
    const after = Date.now();

    expect(mockRedis.set).toHaveBeenCalledOnce();
    const [key, value, _ex, ttl] = mockRedis.set.mock.calls[0] as [string, string, string, number];
    expect(key).toBe(`freq_cap:${CONTACT_ID}:${TEMPLATE_ID}`);

    const storedMs = Number(value);
    expect(storedMs).toBeGreaterThanOrEqual(before);
    expect(storedMs).toBeLessThanOrEqual(after);

    // TTL should be 25 hours (90000 seconds)
    expect(ttl).toBe(90_000);
  });

  it("subsequent reads within 24h confirm the cap is set", async () => {
    await recordFrequencyCapSend(CONTACT_ID, TEMPLATE_ID);

    const decision = await evaluateFrequencyCap({
      category: "MARKETING",
      templateId: TEMPLATE_ID,
      contactId: CONTACT_ID,
      contact: subscribedContact,
      userId: USER_ID,
    });
    expect(decision.action).not.toBe("send");
  });
});
