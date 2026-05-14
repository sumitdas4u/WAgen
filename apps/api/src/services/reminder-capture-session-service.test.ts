import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn()
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery }
}));
vi.mock("./flow-engine-service.js", () => ({
  startFlowForConversation: vi.fn()
}));
vi.mock("./channel-outbound-service.js", () => ({
  sendConversationFlowMessage: vi.fn()
}));

import {
  getActiveCaptureSession,
  handleCaptureSessionReply,
  type CaptureSession
} from "./reminder-capture-session-service.js";

beforeEach(() => mockPoolQuery.mockReset());

describe("getActiveCaptureSession", () => {
  it("returns null when no active session exists", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getActiveCaptureSession("conv-1");
    expect(result).toBeNull();
  });

  it("returns the active session row", async () => {
    const mockSession = {
      id: "sess-1",
      conversation_id: "conv-1",
      status: "active",
      state: "ASK_PERMISSION",
      config_key: "birthday"
    };
    mockPoolQuery.mockResolvedValueOnce({ rows: [mockSession] });
    const result = await getActiveCaptureSession("conv-1");
    expect(result?.id).toBe("sess-1");
  });
});

describe("handleCaptureSessionReply", () => {
  const baseSession: CaptureSession = {
    id: "sess-1",
    user_id: "user-1",
    contact_id: "contact-1",
    conversation_id: "conv-1",
    config_key: "birthday",
    state: "ASK_PERMISSION",
    status: "active",
    retry_count: 0,
    context: {},
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  it("marks session complete when YES payload received", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ capture_flow_id: null }] }) // config lookup (no flow)
      .mockResolvedValueOnce({ rows: [] }); // session UPDATE

    await handleCaptureSessionReply(baseSession, "start_flow_birthday");

    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    const updateCall = mockPoolQuery.mock.calls[1][0] as string;
    expect(updateCall).toContain("complete");
  });

  it("marks session cancelled on NOT NOW reply", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // session UPDATE

    await handleCaptureSessionReply(baseSession, "not_now");

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    const updateCall = mockPoolQuery.mock.calls[0][0] as string;
    expect(updateCall).toContain("cancelled");
  });

  it("does nothing for unrecognized messages", async () => {
    await handleCaptureSessionReply(baseSession, "hello there");
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});
