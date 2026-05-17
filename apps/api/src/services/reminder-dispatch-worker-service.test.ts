import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPoolQuery,
  mockGetOrCreateConversation,
  mockSendConversationFlowMessage,
  mockExpireStaleCaptureSessions
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockGetOrCreateConversation: vi.fn(),
  mockSendConversationFlowMessage: vi.fn(),
  mockExpireStaleCaptureSessions: vi.fn()
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery }
}));
vi.mock("./conversation-service.js", () => ({
  getOrCreateConversation: mockGetOrCreateConversation
}));
vi.mock("./channel-outbound-service.js", () => ({
  sendConversationFlowMessage: mockSendConversationFlowMessage
}));
vi.mock("./reminder-capture-session-service.js", () => ({
  expireStaleCaptureSessions: mockExpireStaleCaptureSessions
}));
vi.mock("./queue-service.js", () => ({
  createQueueWorkerConnection: vi.fn(),
  getReminderDispatchQueue: vi.fn()
}));

import {
  processUserReminders,
  shouldProcessReminderConfig
} from "./reminder-dispatch-worker-service.js";

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockGetOrCreateConversation.mockReset();
  mockSendConversationFlowMessage.mockReset();
  mockExpireStaleCaptureSessions.mockReset();
  mockExpireStaleCaptureSessions.mockResolvedValue(0);
});

describe("shouldProcessReminderConfig", () => {
  it("matches the configured send time in the configured timezone", () => {
    const now = new Date("2026-05-14T03:30:10.000Z"); // 09:00 in Asia/Kolkata

    expect(shouldProcessReminderConfig({
      campaign_send_time: "09:00:00",
      campaign_timezone: "Asia/Kolkata"
    }, now)).toBe(true);

    expect(shouldProcessReminderConfig({
      campaign_send_time: "09:01",
      campaign_timezone: "Asia/Kolkata"
    }, now)).toBe(false);
  });

  it("allows manual dispatch to bypass schedule matching", () => {
    expect(shouldProcessReminderConfig({
      campaign_send_time: "23:59",
      campaign_timezone: "Asia/Kolkata"
    }, new Date("2026-05-14T03:30:10.000Z"), true)).toBe(true);
  });
});

describe("processUserReminders", () => {
  const config = {
    id: "config-1",
    user_id: "user-1",
    config_key: "birthday",
    campaign_enabled: true,
    campaign_conditions_json: [{ field: "tags", operator: "contains", value: "vip" }],
    campaign_send_time: "09:00:00",
    campaign_timezone: "Asia/Kolkata",
    dispatch_mode: "annual"
  };

  it("skips configs that are not due yet", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: "agent-profile-1" }] })
      .mockResolvedValueOnce({ rows: [{ ...config, campaign_send_time: "09:01" }] });

    await processUserReminders("user-1", {
      now: new Date("2026-05-14T03:30:10.000Z")
    });

    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    expect(mockSendConversationFlowMessage).not.toHaveBeenCalled();
    expect(mockExpireStaleCaptureSessions).toHaveBeenCalledTimes(1);
  });

  it("dispatches due contacts with resolved template variables and condition filtering", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: "agent-profile-1" }] })
      .mockResolvedValueOnce({ rows: [config] })
      .mockResolvedValueOnce({
        rows: [{
          id: "step-1",
          config_id: "config-1",
          step_order: 1,
          days_before: 0,
          template_name: "birthday_offer",
          template_lang: "en",
          template_vars: {
            "1": { source: "contact", field: "display_name" },
            "2": { source: "static", value: "VIP10" }
          }
        }]
      })
      .mockResolvedValueOnce({ rows: [{ id: "field-1" }] })
      .mockResolvedValueOnce({
        rows: [{
          contact_id: "contact-1",
          phone_number: "919999999999",
          display_name: "Asha",
          email: "asha@example.com",
          contact_type: "lead",
          tags: ["vip"],
          source_type: "manual",
          source_id: null,
          source_url: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          custom_fields: {}
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    mockGetOrCreateConversation.mockResolvedValueOnce({ id: "conversation-1" });

    await processUserReminders("user-1", {
      now: new Date("2026-05-14T03:30:10.000Z")
    });

    expect(mockSendConversationFlowMessage).toHaveBeenCalledWith({
      userId: "user-1",
      conversationId: "conversation-1",
      payload: {
        type: "template",
        templateName: "birthday_offer",
        language: "en",
        variableValues: {
          "1": "Asha",
          "2": "VIP10"
        }
      }
    });
    expect(mockPoolQuery.mock.calls[5][1]).toEqual([
      "user-1",
      "contact-1",
      "birthday",
      "step-1",
      2026,
      "birthday_offer"
    ]);
  });
});
