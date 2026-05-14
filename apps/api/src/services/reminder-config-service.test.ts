import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn()
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery }
}));

import {
  listReminderConfigs,
  upsertReminderConfig,
  deleteReminderConfig,
  type ReminderConfigInput
} from "./reminder-config-service.js";

beforeEach(() => {
  mockPoolQuery.mockReset();
});

describe("listReminderConfigs", () => {
  it("returns existing configs when present", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] }) // ensure birthday
      .mockResolvedValueOnce({ rows: [] }) // ensure anniversary
      .mockResolvedValueOnce({
      rows: [
        { id: "uuid-1", config_key: "birthday", reminder_type: "birthday" },
        { id: "uuid-2", config_key: "anniversary", reminder_type: "anniversary" }
      ]
      });

    const result = await listReminderConfigs("user-1");
    expect(result).toHaveLength(2);
    expect(result[0].config_key).toBe("birthday");
  });

  it("seeds defaults and returns them when no configs exist", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] })   // INSERT birthday
      .mockResolvedValueOnce({ rows: [] })   // INSERT anniversary
      .mockResolvedValueOnce({
        rows: [
          { id: "uuid-1", config_key: "birthday", reminder_type: "birthday" },
          { id: "uuid-2", config_key: "anniversary", reminder_type: "anniversary" }
        ]
      });

    const result = await listReminderConfigs("user-1");
    expect(result).toHaveLength(2);
    expect(result[0].config_key).toBe("birthday");
  });
});

describe("upsertReminderConfig", () => {
  it("upserts a config and returns the updated row", async () => {
    const mockRow = {
      id: "uuid-1",
      user_id: "user-1",
      config_key: "birthday",
      reminder_type: "birthday",
      enabled: true
    };
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] }) // existing lookup
      .mockResolvedValueOnce({ rows: [mockRow] });

    const input: ReminderConfigInput = {
      configKey: "birthday",
      reminderType: "birthday",
      enabled: true
    };
    const result = await upsertReminderConfig("user-1", input);
    expect(result.config_key).toBe("birthday");
    expect(result.enabled).toBe(true);
  });

  it("preserves omitted fields on partial updates", async () => {
    const existingRow = {
      id: "uuid-1",
      user_id: "user-1",
      config_key: "birthday",
      reminder_type: "birthday",
      custom_label: null,
      enabled: true,
      capture_enabled: true,
      capture_template_name: "birthday_capture",
      capture_template_lang: "en",
      capture_template_vars: { "1": { source: "contact", field: "display_name" } },
      capture_flow_id: "flow-1",
      capture_trigger_type: "create",
      capture_conditions_json: [{ field: "custom:birthday", operator: "eq", value: "" }],
      retry_interval_days: 7,
      retry_max_count: 2,
      cooldown_days: 30,
      campaign_enabled: true,
      campaign_conditions_json: [{ field: "tags", operator: "contains", value: "vip" }],
      campaign_send_time: "09:30:00",
      campaign_timezone: "Asia/Kolkata",
      dispatch_mode: "annual",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    };

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [existingRow] })
      .mockResolvedValueOnce({ rows: [{ ...existingRow, capture_template_name: "birthday_capture_v2", campaign_send_time: "09:30:00" }] });

    const result = await upsertReminderConfig("user-1", {
      configKey: "birthday",
      reminderType: "birthday",
      captureTemplateName: "birthday_capture_v2"
    });

    const values = mockPoolQuery.mock.calls[1][1] as unknown[];
    expect(values[4]).toBe(true); // enabled preserved
    expect(values[15]).toBe(true); // campaign_enabled preserved
    expect(values[17]).toBe("09:30"); // db time normalized before writing
    expect(result.campaign_send_time).toBe("09:30");
  });
});

describe("deleteReminderConfig", () => {
  it("returns true when a custom config is deleted", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 });
    const result = await deleteReminderConfig("user-1", "kids_birthday");
    expect(result).toBe(true);
  });

  it("returns false when config not found", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 0 });
    const result = await deleteReminderConfig("user-1", "nonexistent");
    expect(result).toBe(false);
  });
});
