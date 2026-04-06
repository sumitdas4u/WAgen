import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../../../lib/api";
import { normalizeMessage } from "./message-renderer";

function buildMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: "msg_1",
    direction: "outbound",
    sender_name: "Agent",
    message_text: "Legacy fallback text",
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    ai_model: null,
    retrieval_chunks: null,
    media_url: null,
    message_type: "text",
    message_content: null,
    created_at: "2026-04-06T00:00:00.000Z",
    ...overrides
  };
}

describe("normalizeMessage", () => {
  it("prefers structured payload type over legacy message text", () => {
    const normalized = normalizeMessage(
      buildMessage({
        direction: "outbound",
        message_text: "1. Old guess\n2. Should not matter",
        message_type: "text",
        message_content: {
          type: "text_buttons",
          text: "Choose an option",
          buttons: [
            { id: "one", label: "One" },
            { id: "two", label: "Two" }
          ]
        }
      })
    );

    expect(normalized.type).toBe("buttons");
    expect(normalized.content.text).toBe("Choose an option");
    expect(normalized.content.buttons).toEqual([
      { id: "one", label: "One" },
      { id: "two", label: "Two" }
    ]);
  });

  it("maps canonical media payloads independently of channel storage format", () => {
    const normalized = normalizeMessage(
      buildMessage({
        direction: "outbound",
        message_type: "file",
        media_url: "/api/media/fallback",
        message_content: {
          type: "media",
          mediaType: "image",
          url: "/api/media/primary",
          caption: "Look here"
        }
      })
    );

    expect(normalized.type).toBe("image");
    expect(normalized.content.media_url).toContain("/api/media/primary");
    expect(normalized.content.text).toBe("Look here");
  });

  it("keeps legacy fallback parsing when message_content is absent", () => {
    const normalized = normalizeMessage(
      buildMessage({
        direction: "inbound",
        message_text: "[LOCATION]\nOffice\nKolkata\n22.5726, 88.3639",
        message_content: null
      })
    );

    expect(normalized.type).toBe("location");
    expect(normalized.content.location).toEqual({
      latitude: 22.5726,
      longitude: 88.3639,
      name: "Office",
      address: "Kolkata"
    });
  });
});
