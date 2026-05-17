import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPoolQuery,
  mockEvaluate,
  mockLoadSnapshot,
  mockGetOrCreateConversation,
  mockSendConversationFlowMessage
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockEvaluate: vi.fn(),
  mockLoadSnapshot: vi.fn(),
  mockGetOrCreateConversation: vi.fn(),
  mockSendConversationFlowMessage: vi.fn()
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery }
}));
vi.mock("./sequence-condition-service.js", () => ({
  evaluateSequenceConditions: mockEvaluate
}));
vi.mock("./contact-snapshot-service.js", () => ({
  loadContactSnapshot: mockLoadSnapshot
}));
vi.mock("./conversation-service.js", () => ({
  getOrCreateConversation: mockGetOrCreateConversation
}));
vi.mock("./channel-outbound-service.js", () => ({
  sendConversationFlowMessage: mockSendConversationFlowMessage
}));

import { processReminderCaptureEvent } from "./reminder-capture-trigger-service.js";

const baseContact = {
  id: "contact-1",
  user_id: "user-1",
  display_name: "Test User",
  phone_number: "919999999999",
  email: null,
  contact_type: "customer",
  tags: [],
  source_type: "manual",
  source_id: null,
  source_url: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  custom_fields: {}
};

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockEvaluate.mockReset();
  mockLoadSnapshot.mockReset();
  mockGetOrCreateConversation.mockReset();
  mockSendConversationFlowMessage.mockReset();
});

describe("processReminderCaptureEvent", () => {
  it("skips when no enabled reminder configs exist", async () => {
    mockLoadSnapshot.mockResolvedValueOnce(baseContact);
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: "agent-profile-1" }] })
      .mockResolvedValueOnce({ rows: [] }); // no configs

    await processReminderCaptureEvent({
      userId: "user-1",
      event: "contact_created",
      contactId: "contact-1"
    });

    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });

  it("skips a config when trigger_type does not match event", async () => {
    mockLoadSnapshot.mockResolvedValueOnce(baseContact);
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: "agent-profile-1" }] })
      .mockResolvedValueOnce({
        rows: [{
          id: "rc-1",
          user_id: "user-1",
          config_key: "birthday",
          reminder_type: "birthday",
          enabled: true,
          capture_enabled: true,
          capture_trigger_type: "update", // event is create -> skip
          capture_conditions_json: [],
          capture_template_name: "bday_ask",
          capture_template_lang: "en",
          capture_template_vars: {},
          retry_interval_days: 7,
          retry_max_count: 1,
          cooldown_days: 30
        }]
      });

    await processReminderCaptureEvent({
      userId: "user-1",
      event: "contact_created",
      contactId: "contact-1"
    });

    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });

  it("skips when conditions do not match", async () => {
    mockLoadSnapshot.mockResolvedValueOnce(baseContact);
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: "agent-profile-1" }] })
      .mockResolvedValueOnce({
        rows: [{
          id: "rc-1",
          user_id: "user-1",
          config_key: "birthday",
          reminder_type: "birthday",
          enabled: true,
          capture_enabled: true,
          capture_trigger_type: "create",
          capture_conditions_json: [{ field: "contact_type", operator: "eq", value: "VIP" }],
          capture_template_name: "bday_ask",
          capture_template_lang: "en",
          capture_template_vars: {},
          retry_interval_days: 7,
          retry_max_count: 1,
          cooldown_days: 30
        }]
      });

    mockEvaluate.mockReturnValue(false);

    await processReminderCaptureEvent({
      userId: "user-1",
      event: "contact_created",
      contactId: "contact-1"
    });

    expect(mockEvaluate).toHaveBeenCalledTimes(1);
    expect(mockPoolQuery).toHaveBeenCalledTimes(2); // API-channel check and configs SELECT
  });
});
