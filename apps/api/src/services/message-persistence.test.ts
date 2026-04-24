import { describe, expect, it } from "vitest";

function extractMessageType(content: Record<string, unknown>): string {
  if (content.conversation || content.extendedTextMessage) return "text";
  if (content.imageMessage) return "image";
  if (content.videoMessage) return "video";
  if (content.audioMessage) return "audio";
  if (content.documentMessage) return "document";
  if (content.stickerMessage) return "sticker";
  if (content.locationMessage) return "location";
  if (content.contactMessage || content.contactsArrayMessage) return "contact";
  if (content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3) return "poll";
  return "unknown";
}

function extractMessageText(content: Record<string, unknown>): string | null {
  if (typeof content.conversation === "string") return content.conversation;
  const ext = content.extendedTextMessage as Record<string, unknown> | undefined;
  if (typeof ext?.text === "string") return ext.text;
  const img = content.imageMessage as Record<string, unknown> | undefined;
  if (typeof img?.caption === "string") return img.caption;
  return null;
}

describe("extractMessageType", () => {
  it("detects text", () => {
    expect(extractMessageType({ conversation: "hello" })).toBe("text");
  });
  it("detects image", () => {
    expect(extractMessageType({ imageMessage: {} })).toBe("image");
  });
  it("detects audio", () => {
    expect(extractMessageType({ audioMessage: {} })).toBe("audio");
  });
  it("falls back to unknown", () => {
    expect(extractMessageType({})).toBe("unknown");
  });
});

describe("extractMessageText", () => {
  it("returns conversation text", () => {
    expect(extractMessageText({ conversation: "hi there" })).toBe("hi there");
  });
  it("returns extended text", () => {
    expect(extractMessageText({ extendedTextMessage: { text: "hello" } })).toBe("hello");
  });
  it("returns image caption", () => {
    expect(extractMessageText({ imageMessage: { caption: "photo" } })).toBe("photo");
  });
  it("returns null for non-text", () => {
    expect(extractMessageText({ audioMessage: {} })).toBeNull();
  });
});
