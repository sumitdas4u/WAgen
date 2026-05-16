import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPoolQuery, mockSend } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockSend: vi.fn()
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery }
}));
vi.mock("./channel-outbound-service.js", () => ({
  sendConversationFlowMessage: mockSend
}));

import {
  getActiveCaptureSession,
  handleCaptureSessionReply,
  type CaptureSession
} from "./reminder-capture-session-service.js";

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockSend.mockReset();
  mockSend.mockResolvedValue({ delivered: true });
});

const baseSession: CaptureSession = {
  id: "sess-1",
  user_id: "user-1",
  contact_id: "contact-1",
  conversation_id: "conv-1",
  config_key: "birthday",
  state: "ASK_PERMISSION",
  status: "active",
  field_name: null,
  captured_date: null,
  retry_count: 0,
  context: {},
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

describe("getActiveCaptureSession", () => {
  it("returns null when no active session exists", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getActiveCaptureSession("conv-1");
    expect(result).toBeNull();
  });

  it("returns the active session row", async () => {
    const mockRow = { id: "sess-1", conversation_id: "conv-1", status: "active", state: "ASK_PERMISSION", config_key: "birthday", field_name: null, captured_date: null };
    mockPoolQuery.mockResolvedValueOnce({ rows: [mockRow] });
    const result = await getActiveCaptureSession("conv-1");
    expect(result?.id).toBe("sess-1");
  });
});

describe("handleCaptureSessionReply — ASK_PERMISSION state", () => {
  it("moves to ASK_DATE and sends date-request message when YES payload received", async () => {
    // getConfigFieldInfo: reminder_configs + contact_fields label
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ date_field_name: "birthday", capture_template_name: "bday_tpl" }] })
      .mockResolvedValueOnce({ rows: [{ label: "Birthday" }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE session to ASK_DATE

    await handleCaptureSessionReply(baseSession, "start_flow_birthday");

    expect(mockSend).toHaveBeenCalledOnce();
    const sentPayload = mockSend.mock.calls[0][0].payload;
    expect(sentPayload.type).toBe("text");
    expect(sentPayload.text).toContain("Birthday");
    expect(sentPayload.text).toContain("YYYY-MM-DD");
  });

  it("marks session cancelled on NOT NOW payload", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] }) // UPDATE CANCELLED
      .mockResolvedValueOnce({ rows: [] }); // INSERT log

    await handleCaptureSessionReply(baseSession, "not_now");

    const updateCall = mockPoolQuery.mock.calls[0][0] as string;
    expect(updateCall).toContain("CANCELLED");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does nothing for unrecognized messages", async () => {
    await handleCaptureSessionReply(baseSession, "hello there");
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("handleCaptureSessionReply — ASK_DATE state", () => {
  const askDateSession: CaptureSession = {
    ...baseSession,
    state: "ASK_DATE",
    field_name: "birthday"
  };

  it("saves valid YYYY-MM-DD date to contact field and marks COMPLETE", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: "field-uuid-1" }] })  // field lookup
      .mockResolvedValueOnce({ rows: [] })                          // field value upsert
      .mockResolvedValueOnce({ rows: [{ date_field_name: "birthday", capture_template_name: null }] }) // getConfigFieldInfo config
      .mockResolvedValueOnce({ rows: [{ label: "Birthday" }] })    // getConfigFieldInfo label
      .mockResolvedValueOnce({ rows: [] })                          // UPDATE COMPLETE
      .mockResolvedValueOnce({ rows: [] });                         // INSERT log

    await handleCaptureSessionReply(askDateSession, "1990-06-15");

    const fieldUpsertCall = mockPoolQuery.mock.calls[1][0] as string;
    expect(fieldUpsertCall).toContain("contact_field_values");
    expect(mockPoolQuery.mock.calls[1][1]).toContain("1990-06-15");

    const updateCall = mockPoolQuery.mock.calls[4][0] as string;
    expect(updateCall).toContain("COMPLETE");
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("accepts DD/MM/YYYY format and converts to ISO", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: "field-uuid-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ date_field_name: "birthday", capture_template_name: null }] })
      .mockResolvedValueOnce({ rows: [{ label: "Birthday" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await handleCaptureSessionReply(askDateSession, "15/06/1990");

    expect(mockPoolQuery.mock.calls[1][1]).toContain("1990-06-15");
  });

  it("sends error message and stays in ASK_DATE for invalid date", async () => {
    await handleCaptureSessionReply(askDateSession, "not a date at all");

    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledOnce();
    const sentPayload = mockSend.mock.calls[0][0].payload;
    expect(sentPayload.text).toContain("YYYY-MM-DD");
  });

  it("cancels on decline message in ASK_DATE", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] }) // UPDATE CANCELLED
      .mockResolvedValueOnce({ rows: [] }); // INSERT log

    await handleCaptureSessionReply(askDateSession, "cancel");

    const updateCall = mockPoolQuery.mock.calls[0][0] as string;
    expect(updateCall).toContain("CANCELLED");
  });
});
