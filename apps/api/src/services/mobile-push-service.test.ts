import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentNotificationPayload } from "../types/ws-events.js";

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn()
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery }
}));

import {
  buildExpoPushMessage,
  isExpoPushToken,
  sendAgentNotificationPush
} from "./mobile-push-service.js";

const messageNotification: AgentNotificationPayload = {
  id: "notif-1",
  type: "message",
  conversation_id: "conv-1",
  actor_name: "Priya",
  body: "New customer reply",
  created_at: "2026-05-17T10:00:00.000Z"
};

describe("mobile push service", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates Expo push token shape", () => {
    expect(isExpoPushToken("ExpoPushToken[abc_123-XYZ]")).toBe(true);
    expect(isExpoPushToken("ExponentPushToken[abc_123-XYZ]")).toBe(true);
    expect(isExpoPushToken("firebase-token")).toBe(false);
  });

  it("builds Android high-priority message payloads that deep-link to a conversation", () => {
    expect(buildExpoPushMessage({
      expoPushToken: "ExpoPushToken[token]",
      notification: messageNotification
    })).toEqual({
      to: "ExpoPushToken[token]",
      sound: "default",
      priority: "high",
      title: "Priya",
      body: "New customer reply",
      data: {
        type: "message",
        notificationId: "notif-1",
        conversationId: "conv-1"
      }
    });
  });

  it("builds fallback titles for non-message notifications", () => {
    expect(buildExpoPushMessage({
      expoPushToken: "ExpoPushToken[token]",
      notification: {
        ...messageNotification,
        type: "bot_alert",
        actor_name: undefined,
        conversation_id: undefined
      }
    })).toMatchObject({
      title: "Automation alert",
      data: {
        type: "bot_alert",
        notificationId: "notif-1",
        conversationId: null
      }
    });
  });

  it("fans out non-message notifications too", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ expo_push_token: "ExpoPushToken[assigned]" }]
    });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ status: "ok", id: "ticket-1" }] })
    } as Response);

    await sendAgentNotificationPush({
      userId: "user-1",
      notification: { ...messageNotification, type: "assigned" }
    });

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM mobile_push_tokens"),
      ["user-1"]
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/send",
      expect.objectContaining({
        body: expect.stringContaining("\"type\":\"assigned\"")
      })
    );
  });

  it("sends notifications and revokes DeviceNotRegistered tokens", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        { expo_push_token: "ExpoPushToken[good]" },
        { expo_push_token: "ExpoPushToken[old]" }
      ]
    });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { status: "ok", id: "ticket-1" },
          { status: "error", details: { error: "DeviceNotRegistered" } }
        ]
      })
    } as Response);
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await sendAgentNotificationPush({
      userId: "user-1",
      notification: messageNotification
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/send",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("ExpoPushToken[good]")
      })
    );
    expect(mockPoolQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("WHERE expo_push_token = $1"),
      ["ExpoPushToken[old]"]
    );
  });
});
