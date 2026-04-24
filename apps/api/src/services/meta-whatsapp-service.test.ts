import { describe, expect, it } from "vitest";
import { summarizeMetaWebhookMessage } from "./meta-whatsapp-service.js";

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
