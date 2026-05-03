/**
 * Broadcast frequency-cap integration tests
 *
 * Tests the end-to-end behavior of deliverCampaignMessage() against the
 * frequency-cap state machine shown in the flow diagram:
 *
 *   Send template
 *   └─ Same template sent in last 24h?
 *       NO  → send original immediately
 *       YES → Approved variant?
 *               YES → send variant
 *               NO  → delay until last_sent + 24h
 *
 * Key invariants:
 *   - A FAILED dispatch does NOT record the frequency cap (no Redis write on error)
 *   - A SUCCESSFUL dispatch DOES record it (Redis key set, 25h TTL)
 *   - Cap is per (contact × template) — a different template always sends clean
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { deliverCampaignMessage } from "./message-delivery-service.js";
import type { Contact } from "../types/models.js";
import type { Campaign, CampaignMessage } from "./campaign-service.js";
import type { MessageTemplate, TemplateDispatchResult } from "./template-service.js";

// ─── Hoist all mock variables ─────────────────────────────────────────────────

const {
  redisStore, mockRedis,
  mockPoolQuery,
  mockRecordDeliveryAttemptStart, mockMarkDeliveryAttemptSuccess,
  mockMarkDeliveryAttemptFailure, mockClassifyDeliveryFailure,
  mockUpsertRecipientSuppression,
  mockMarkCampaignMessageSent, mockMarkCampaignMessageFailed,
  mockDeferCampaignMessageToNextDay,
  mockGetContactByPhone, mockMarkContactActivity,
  mockGetMessageTemplate, mockDispatchTemplate,
} = vi.hoisted(() => {
  const redisStore = new Map<string, string>();
  const mockRedis = {
    get: vi.fn(async (key: string): Promise<string | null> => redisStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string): Promise<string> => {
      redisStore.set(key, value);
      return "OK";
    }),
    watch: vi.fn(async () => "OK"),
    multi: vi.fn(() => ({
      set: vi.fn((key: string, value: string) => { redisStore.set(key, value); }),
      exec: vi.fn(async () => ["OK"]),
    })),
  };
  return {
    redisStore,
    mockRedis,
    mockPoolQuery: vi.fn(),
    mockRecordDeliveryAttemptStart: vi.fn().mockResolvedValue({ id: "attempt-1" }),
    mockMarkDeliveryAttemptSuccess: vi.fn().mockResolvedValue(undefined),
    mockMarkDeliveryAttemptFailure: vi.fn().mockResolvedValue(undefined),
    mockClassifyDeliveryFailure: vi.fn(),
    mockUpsertRecipientSuppression: vi.fn().mockResolvedValue(undefined),
    mockMarkCampaignMessageSent: vi.fn().mockResolvedValue(undefined),
    mockMarkCampaignMessageFailed: vi.fn().mockResolvedValue(undefined),
    mockDeferCampaignMessageToNextDay: vi.fn().mockResolvedValue(undefined),
    mockGetContactByPhone: vi.fn(),
    mockMarkContactActivity: vi.fn().mockResolvedValue(undefined),
    mockGetMessageTemplate: vi.fn(),
    mockDispatchTemplate: vi.fn(),
  };
});

vi.mock("./queue-service.js", () => ({
  getQueueRedisConnection: vi.fn(() => mockRedis),
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery },
}));

vi.mock("./message-delivery-data-service.js", () => ({
  findSuppressedRecipients: vi.fn().mockResolvedValue(new Map()),
  recordDeliveryAttemptStart: mockRecordDeliveryAttemptStart,
  markDeliveryAttemptSuccess: mockMarkDeliveryAttemptSuccess,
  markDeliveryAttemptFailure: mockMarkDeliveryAttemptFailure,
  classifyDeliveryFailure: mockClassifyDeliveryFailure,
  isSmartRetryableCode: vi.fn().mockReturnValue(false),
  smartRetryDelayMs: vi.fn().mockReturnValue(6 * 60 * 60 * 1000),
  retryDelayMs: vi.fn().mockReturnValue(5 * 60 * 1000),
  upsertRecipientSuppression: mockUpsertRecipientSuppression,
  MAX_SMART_RETRIES: 3,
}));

vi.mock("./campaign-service.js", () => ({
  markCampaignMessageSent: mockMarkCampaignMessageSent,
  markCampaignMessageFailed: mockMarkCampaignMessageFailed,
  deferCampaignMessageToNextDay: mockDeferCampaignMessageToNextDay,
}));

vi.mock("./contacts-service.js", () => ({
  getContactByPhoneForUser: mockGetContactByPhone,
  markContactTemplateOutboundActivity: mockMarkContactActivity,
}));

vi.mock("./conversation-service.js", () => ({
  getOrCreateConversation: vi.fn().mockResolvedValue({
    id: "conv-1",
    phone_number: "919876543210",
    score: 50,
    stage: "prospect",
    channel_linked_number: "+15551234567",
  }),
  trackOutboundMessage: vi.fn().mockResolvedValue(undefined),
  setConversationResolved: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./template-service.js", () => ({
  getMessageTemplate: mockGetMessageTemplate,
  dispatchTemplateMessage: mockDispatchTemplate,
}));

vi.mock("./realtime-hub.js", () => ({
  realtimeHub: { broadcast: vi.fn() },
}));

vi.mock("../config/env.js", () => ({
  env: {
    DELIVERY_PER_CONNECTION_RATE_LIMIT: 50,
    QUEUE_PREFIX: "test",
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONTACT: Contact = {
  id: "contact-sumit",
  user_id: "user-1",
  display_name: "Sumit Das",
  phone_number: "919876543210",
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

const PROMO_TEMPLATE: MessageTemplate = {
  id: "tmpl-summer-sale",
  userId: "user-1",
  connectionId: "conn-1",
  phoneNumberId: "phone-id-1",
  templateId: "meta-tmpl-summer",
  name: "summer_sale_v1",
  category: "MARKETING",
  language: "en_US",
  status: "APPROVED",
  qualityScore: null,
  components: [],
  metaRejectionReason: null,
  linkedNumber: "+15551234567",
  displayPhoneNumber: "+1 555 123 4567",
  headerMediaUrl: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const WELCOME_TEMPLATE: MessageTemplate = {
  ...PROMO_TEMPLATE,
  id: "tmpl-welcome-offer",
  name: "welcome_offer_v1",
};

const DISPATCH_SUCCESS: TemplateDispatchResult = {
  messageId: "wamid.test_abc123",
  template: PROMO_TEMPLATE,
  connection: {
    id: "conn-1",
    phoneNumberId: "phone-id-1",
    linkedNumber: "+15551234567",
    displayPhoneNumber: "+1 555 123 4567",
  },
  resolvedVariables: {},
  messagePayload: {
    type: "template",
    templateName: "summer_sale_v1",
    language: "en_US",
    components: [],
  },
  summaryText: "Summer Sale — up to 50% off!",
};

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "camp-1",
    user_id: "user-1",
    name: "Summer Sale Broadcast",
    status: "running",
    broadcast_type: "standard",
    connection_id: "conn-1",
    template_id: "tmpl-summer-sale",
    template_variables: {},
    target_segment_id: null,
    source_campaign_id: null,
    retarget_status: null,
    audience_source_json: {},
    media_overrides_json: {},
    scheduled_at: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    total_count: 1,
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
  };
}

function makeMessage(overrides: Partial<CampaignMessage> = {}): CampaignMessage {
  return {
    id: "msg-1",
    campaign_id: "camp-1",
    contact_id: "contact-sumit",
    phone_number: "919876543210",
    wamid: null,
    status: "queued",
    retry_count: 0,
    next_retry_at: null,
    error_code: null,
    error_message: null,
    resolved_variables_json: {},
    sent_at: null,
    delivered_at: null,
    read_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// Pool query helper — return "no daily cap exceeded" by default
function setupPoolForNormalDailyTier() {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("messagingLimitTier")) {
      return Promise.resolve({ rows: [{ tier: "TIER_100K" }] });
    }
    if (sql.includes("message_delivery_attempts")) {
      return Promise.resolve({ rows: [{ count: "0" }] });
    }
    // variant template lookup — none by default
    if (sql.includes("variant_of_template_id")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  redisStore.clear();
  vi.clearAllMocks();
  mockGetContactByPhone.mockResolvedValue(CONTACT);
  mockGetMessageTemplate.mockResolvedValue(PROMO_TEMPLATE);
  mockDispatchTemplate.mockResolvedValue(DISPATCH_SUCCESS);
  mockClassifyDeliveryFailure.mockReturnValue({
    category: "permanent",
    errorCode: "UNKNOWN",
    errorMessage: "Meta send failed (test)",
    retryable: false,
    suppressionReason: null,
  });
  mockRecordDeliveryAttemptStart.mockResolvedValue({ id: "attempt-1" });
  setupPoolForNormalDailyTier();
});

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("Broadcast frequency-cap flow (sumitdas4u@gmail.com)", () => {
  /**
   * TC-1: First-ever broadcast to a contact
   * Expectation: sends immediately, records freq cap in Redis
   */
  it("TC-1: first broadcast sends immediately and records the frequency cap", async () => {
    const result = await deliverCampaignMessage({
      userId: "user-1",
      campaign: makeCampaign(),
      message: makeMessage(),
      senderName: "Typo Support",
    });

    expect(result.status).toBe("sent");
    // Frequency cap must be recorded after success
    expect(redisStore.has(`freq_cap:${CONTACT.id}:${PROMO_TEMPLATE.id}`)).toBe(true);
    expect(mockMarkCampaignMessageSent).toHaveBeenCalledOnce();
  });

  /**
   * TC-2: Broadcast fails (Meta error) → RETRY should go through
   *
   * A failed dispatch must NOT write a frequency cap Redis key.
   * When retried, evaluateFrequencyCap returns action:"send" → message is delivered.
   */
  it("TC-2: failed broadcast does NOT set freq cap → retry succeeds", async () => {
    // First attempt: Meta throws
    mockDispatchTemplate.mockRejectedValueOnce(new Error("Meta API error (test)"));

    const firstAttempt = await deliverCampaignMessage({
      userId: "user-1",
      campaign: makeCampaign(),
      message: makeMessage(),
      senderName: "Typo Support",
    });

    expect(firstAttempt.status).toBe("failed");
    // CRITICAL: freq cap must NOT be set after a failure
    expect(redisStore.has(`freq_cap:${CONTACT.id}:${PROMO_TEMPLATE.id}`)).toBe(false);

    // Second attempt (retry): Meta succeeds now
    mockDispatchTemplate.mockResolvedValueOnce(DISPATCH_SUCCESS);

    const retryAttempt = await deliverCampaignMessage({
      userId: "user-1",
      campaign: makeCampaign(),
      message: makeMessage({ retry_count: 1 }),
      senderName: "Typo Support",
    });

    expect(retryAttempt.status).toBe("sent");
    // Freq cap recorded after successful retry
    expect(redisStore.has(`freq_cap:${CONTACT.id}:${PROMO_TEMPLATE.id}`)).toBe(true);
  });

  /**
   * TC-3: Successful broadcast → resend same template within 24h → DEFERRED
   *
   * After a successful send the Redis key is present.
   * A resend within 24h with no variant must return status:"retrying" and defer the message.
   */
  it("TC-3: resending same template within 24h defers delivery (frequency cap hit)", async () => {
    // First send succeeds → records cap
    await deliverCampaignMessage({
      userId: "user-1",
      campaign: makeCampaign(),
      message: makeMessage(),
      senderName: "Typo Support",
    });
    expect(redisStore.has(`freq_cap:${CONTACT.id}:${PROMO_TEMPLATE.id}`)).toBe(true);

    // Resend — same template, within 24h, no variant
    const resend = await deliverCampaignMessage({
      userId: "user-1",
      campaign: makeCampaign(),
      message: makeMessage({ id: "msg-2" }),
      senderName: "Typo Support",
    });

    expect(resend.status).toBe("retrying");
    expect(resend.errorMessage).toMatch(/frequency cap/i);
    expect(mockDeferCampaignMessageToNextDay).toHaveBeenCalledOnce();
    // Meta dispatch must NOT have been called for the blocked resend
    expect(mockDispatchTemplate).toHaveBeenCalledOnce(); // only the first send
  });

  /**
   * TC-4: Successful broadcast → resend with approved variant → sends variant
   *
   * When the original template's 24h cap is hit but an approved variant exists,
   * the variant is dispatched instead (no delay, no drop).
   */
  it("TC-4: resend with approved variant swaps to variant template and sends", async () => {
    const VARIANT_TEMPLATE: MessageTemplate = {
      ...PROMO_TEMPLATE,
      id: "tmpl-summer-sale-variant",
      name: "summer_sale_variant_v1",
    };

    // First send → cap recorded for original template
    await deliverCampaignMessage({
      userId: "user-1",
      campaign: makeCampaign(),
      message: makeMessage(),
      senderName: "Typo Support",
    });

    // Configure pool to return a variant on resend
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("messagingLimitTier")) {
        return Promise.resolve({ rows: [{ tier: "TIER_100K" }] });
      }
      if (sql.includes("message_delivery_attempts")) {
        return Promise.resolve({ rows: [{ count: "0" }] });
      }
      if (sql.includes("variant_of_template_id")) {
        return Promise.resolve({ rows: [{ id: VARIANT_TEMPLATE.id }] });
      }
      return Promise.resolve({ rows: [] });
    });

    // getMessageTemplate is called for both original and variant
    mockGetMessageTemplate
      .mockResolvedValueOnce(PROMO_TEMPLATE)  // original lookup
      .mockResolvedValueOnce(VARIANT_TEMPLATE); // variant lookup

    mockDispatchTemplate.mockResolvedValueOnce({
      ...DISPATCH_SUCCESS,
      template: VARIANT_TEMPLATE,
      messageId: "wamid.variant_send",
    });

    const resend = await deliverCampaignMessage({
      userId: "user-1",
      campaign: makeCampaign(),
      message: makeMessage({ id: "msg-2" }),
      senderName: "Typo Support",
    });

    expect(resend.status).toBe("sent");
    // Should NOT have deferred
    expect(mockDeferCampaignMessageToNextDay).not.toHaveBeenCalled();
    // Dispatch called with variant template
    const dispatchCall = mockDispatchTemplate.mock.calls[1];
    expect(dispatchCall[1].templateId).toBe(VARIANT_TEMPLATE.id);
  });

  /**
   * TC-5: Successful broadcast → send a DIFFERENT template → goes through
   *
   * Frequency cap is keyed on (contact × template). A different template ID
   * has no Redis key — and the last_outgoing_marketing_at fallback must NOT
   * fire when a templateId is known (Option B fix).
   */
  it("TC-5: different template sends clean even when last_outgoing_marketing_at is recent", async () => {
    // Simulate contact having a recent marketing send (last_outgoing_marketing_at set)
    // as would happen after the first broadcast succeeded.
    const contactAfterFirstSend: Contact = {
      ...CONTACT,
      last_outgoing_marketing_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    };
    mockGetContactByPhone.mockResolvedValue(contactAfterFirstSend);

    // Also seed the Redis key for PROMO_TEMPLATE (first template was sent)
    redisStore.set(`freq_cap:${CONTACT.id}:${PROMO_TEMPLATE.id}`, String(Date.now() - 2 * 60 * 60 * 1000));

    // Switch to a completely different template
    mockGetMessageTemplate.mockResolvedValue(WELCOME_TEMPLATE);
    mockDispatchTemplate.mockResolvedValueOnce({
      ...DISPATCH_SUCCESS,
      template: WELCOME_TEMPLATE,
      messageId: "wamid.welcome_send",
    });

    const secondSend = await deliverCampaignMessage({
      userId: "user-1",
      campaign: makeCampaign({ template_id: WELCOME_TEMPLATE.id }),
      message: makeMessage({ id: "msg-2" }),
      senderName: "Typo Support",
    });

    expect(secondSend.status).toBe("sent");
    // Neither a defer nor a policy block
    expect(mockDeferCampaignMessageToNextDay).not.toHaveBeenCalled();
    expect(mockMarkCampaignMessageFailed).not.toHaveBeenCalled();
    // Freq cap for second template also now recorded
    expect(redisStore.has(`freq_cap:${CONTACT.id}:${WELCOME_TEMPLATE.id}`)).toBe(true);
  });

  /**
   * TC-6: Hard policy block — contact opted out
   *
   * Globally opted-out contacts are always hard-blocked regardless of freq cap.
   */
  it("TC-6: opted-out contact is hard-blocked before frequency cap is evaluated", async () => {
    const optedOut: Contact = {
      ...CONTACT,
      global_opt_out_at: new Date().toISOString(),
    };
    mockGetContactByPhone.mockResolvedValue(optedOut);

    const result = await deliverCampaignMessage({
      userId: "user-1",
      campaign: makeCampaign(),
      message: makeMessage(),
      senderName: "Typo Support",
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/opted out/i);
    expect(mockDispatchTemplate).not.toHaveBeenCalled();
    expect(redisStore.size).toBe(0);
  });

  /**
   * TC-7: Daily tier cap exceeded → message deferred, NOT marked as freq-cap
   */
  it("TC-7: daily tier cap exceeded defers message without touching freq cap", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("messagingLimitTier")) {
        return Promise.resolve({ rows: [{ tier: "TIER_250" }] });
      }
      if (sql.includes("message_delivery_attempts")) {
        // Return 250 — at cap for TIER_250
        return Promise.resolve({ rows: [{ count: "250" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await deliverCampaignMessage({
      userId: "user-1",
      campaign: makeCampaign(),
      message: makeMessage(),
      senderName: "Typo Support",
    });

    expect(result.status).toBe("retrying");
    expect(result.errorMessage).toMatch(/daily tier/i);
    expect(mockDispatchTemplate).not.toHaveBeenCalled();
    // No freq cap recorded (message was never sent)
    expect(redisStore.has(`freq_cap:${CONTACT.id}:${PROMO_TEMPLATE.id}`)).toBe(false);
  });
});
