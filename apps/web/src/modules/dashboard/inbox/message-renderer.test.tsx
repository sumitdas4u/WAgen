import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../../../lib/api";
import { normalizeMessage, renderFormattedText } from "./message-renderer";

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

  // ── Payload-path: additional structured types ─────────────────────────────

  it("maps media_buttons payload to buttons type with media_url", () => {
    const normalized = normalizeMessage(
      buildMessage({
        message_content: {
          type: "media_buttons",
          url: "/api/media/banner.jpg",
          caption: "Pick one",
          buttons: [
            { id: "a", label: "Option A" },
            { id: "b", label: "Option B" }
          ]
        }
      })
    );
    expect(normalized.type).toBe("buttons");
    expect(normalized.content.media_url).toContain("/api/media/banner.jpg");
    expect(normalized.content.text).toBe("Pick one");
    expect(normalized.content.buttons).toHaveLength(2);
    expect(normalized.content.buttons![0].label).toBe("Option A");
  });

  it("maps product_list payload to list type", () => {
    const normalized = normalizeMessage(
      buildMessage({
        message_content: {
          type: "product_list",
          bodyText: "Browse products",
          sections: [
            { title: "Shirts", productIds: ["sku_1", "sku_2"] }
          ]
        }
      })
    );
    expect(normalized.type).toBe("list");
    expect(normalized.content.list?.title).toBe("Browse products");
    expect(normalized.content.list?.items).toHaveLength(2);
    expect(normalized.content.list?.items[0].id).toBe("sku_1");
  });

  it("maps contact_share payload to contact type", () => {
    const normalized = normalizeMessage(
      buildMessage({
        direction: "inbound",
        message_content: {
          type: "contact_share",
          name: "Alice Smith",
          phone: "+919876543210",
          org: "Acme Corp"
        }
      })
    );
    expect(normalized.type).toBe("contact");
    expect(normalized.content.contact?.name).toBe("Alice Smith");
    expect(normalized.content.contact?.phone).toBe("+919876543210");
    expect(normalized.content.contact?.org).toBe("Acme Corp");
  });

  it("maps poll payload to poll type", () => {
    const normalized = normalizeMessage(
      buildMessage({
        direction: "inbound",
        message_content: {
          type: "poll",
          question: "Best fruit?",
          options: ["Apple", "Mango", "Banana"]
        }
      })
    );
    expect(normalized.type).toBe("poll");
    expect(normalized.content.poll?.question).toBe("Best fruit?");
    expect(normalized.content.poll?.options).toEqual(["Apple", "Mango", "Banana"]);
  });

  // ── Legacy text-path: additional pattern detection ─────────────────────────

  it("detects [AUDIO] prefix text as audio type", () => {
    const normalized = normalizeMessage(
      buildMessage({
        direction: "inbound",
        message_text: "[AUDIO]\nVoice note",
        message_content: null,
        media_url: "/api/media/voice.opus"
      })
    );
    expect(normalized.type).toBe("audio");
    expect(normalized.content.media_url).toContain("/api/media/voice.opus");
  });

  it("detects [VIDEO] prefix text as video type", () => {
    const normalized = normalizeMessage(
      buildMessage({
        direction: "inbound",
        message_text: "[VIDEO]\nFunny clip",
        message_content: null,
        media_url: "/api/media/clip.mp4"
      })
    );
    expect(normalized.type).toBe("video");
    expect(normalized.content.media_url).toContain("/api/media/clip.mp4");
    expect(normalized.content.text).toBe("Funny clip");
  });

  it("detects [CONTACT] with 3 lines and extracts org", () => {
    const normalized = normalizeMessage(
      buildMessage({
        direction: "inbound",
        message_text: "[CONTACT]\nBob Jones\nWayne Enterprises\n+911234567890",
        message_content: null
      })
    );
    expect(normalized.type).toBe("contact");
    expect(normalized.content.contact?.name).toBe("Bob Jones");
    expect(normalized.content.contact?.org).toBe("Wayne Enterprises");
    expect(normalized.content.contact?.phone).toBe("+911234567890");
  });

  it("detects [POLL] text and parses question + options", () => {
    const normalized = normalizeMessage(
      buildMessage({
        direction: "inbound",
        message_text: "[POLL]\nFavorite color?\n1. Red\n2. Blue\n3. Green",
        message_content: null
      })
    );
    expect(normalized.type).toBe("poll");
    expect(normalized.content.poll?.question).toBe("Favorite color?");
    expect(normalized.content.poll?.options).toEqual(["Red", "Blue", "Green"]);
  });

  it("detects [Template: name] text as template type", () => {
    const normalized = normalizeMessage(
      buildMessage({
        direction: "outbound",
        message_text: "[Template: order_confirmation]",
        message_content: null
      })
    );
    expect(normalized.type).toBe("template");
    expect(normalized.content.template?.name).toBe("order_confirmation");
  });

  it("detects numbered-only list after double newline as buttons", () => {
    const normalized = normalizeMessage(
      buildMessage({
        direction: "outbound",
        message_text: "Pick an option\n\n1. Yes\n2. No",
        message_content: null
      })
    );
    expect(normalized.type).toBe("buttons");
    expect(normalized.content.text).toBe("Pick an option");
    expect(normalized.content.buttons).toHaveLength(2);
    expect(normalized.content.buttons![0].label).toBe("Yes");
    expect(normalized.content.buttons![1].label).toBe("No");
  });

  it("detects section header + numbered items as list", () => {
    const normalized = normalizeMessage(
      buildMessage({
        direction: "outbound",
        message_text: "Choose a service\n\nCategories\n1. Support\n2. Sales",
        message_content: null
      })
    );
    expect(normalized.type).toBe("list");
    expect(normalized.content.list?.title).toBe("Choose a service");
    expect(normalized.content.list?.button_label).toBe("Categories");
    expect(normalized.content.list?.items).toHaveLength(2);
    expect(normalized.content.list?.items[0].label).toBe("Support");
  });

  // ── Sender / AI flags ─────────────────────────────────────────────────────

  it("sets is_ai true when ai_model is present on outbound message", () => {
    const normalized = normalizeMessage(
      buildMessage({ direction: "outbound", ai_model: "gpt-4o", message_content: null })
    );
    expect(normalized.is_ai).toBe(true);
    expect(normalized.sender_type).toBe("ai");
  });

  it("sets is_ai false when ai_model is null on outbound message", () => {
    const normalized = normalizeMessage(
      buildMessage({ direction: "outbound", ai_model: null, message_content: null })
    );
    expect(normalized.is_ai).toBe(false);
    expect(normalized.sender_type).toBe("agent");
  });

  it("sets sender_type to user for inbound regardless of ai_model", () => {
    const normalized = normalizeMessage(
      buildMessage({ direction: "inbound", ai_model: "gpt-4o", message_content: null })
    );
    expect(normalized.sender_type).toBe("user");
    expect(normalized.is_ai).toBe(false);
    expect(normalized.direction).toBe("incoming");
  });
});

// ─── renderFormattedText ──────────────────────────────────────────────────────

function renderText(text: string) {
  const { container } = render(<>{renderFormattedText(text, "t")}</>);
  return container;
}

describe("renderFormattedText", () => {
  it("renders plain text as-is", () => {
    const c = renderText("Hello world");
    expect(c.textContent).toBe("Hello world");
  });

  it("renders *bold* as <strong>", () => {
    const c = renderText("Hello *world*");
    const el = c.querySelector("strong");
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("world");
  });

  it("renders _italic_ as <em>", () => {
    const c = renderText("_slanted_ text");
    const el = c.querySelector("em");
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("slanted");
  });

  it("renders ~strike~ as inline strike span", () => {
    const c = renderText("~crossed out~");
    const el = c.querySelector(".msg-inline-strike");
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("crossed out");
  });

  it("renders ```code``` as <code>", () => {
    const c = renderText("Run ```npm install``` now");
    const code = c.querySelector("code.msg-inline-code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("npm install");
  });

  it("linkifies http URLs as <a>", () => {
    const c = renderText("Visit https://example.com today");
    const link = c.querySelector("a.msg-link");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://example.com");
    expect(link!.getAttribute("target")).toBe("_blank");
  });

  it("renders image URLs as <img> instead of <a>", () => {
    const c = renderText("Here is https://cdn.example.com/photo.jpg");
    expect(c.querySelector("img.msg-inline-image")).not.toBeNull();
    expect(c.querySelector("a.msg-link")).toBeNull();
  });

  it("inserts <br> between lines", () => {
    const c = renderText("Line one\nLine two");
    expect(c.querySelectorAll("br").length).toBe(1);
    expect(c.textContent).toContain("Line one");
    expect(c.textContent).toContain("Line two");
  });

  it("handles mixed formatting and URL on the same line", () => {
    const c = renderText("*Bold* see https://example.com/doc.pdf for more");
    expect(c.querySelector("strong")!.textContent).toBe("Bold");
    const link = c.querySelector("a.msg-link");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toContain("example.com/doc.pdf");
  });
});
