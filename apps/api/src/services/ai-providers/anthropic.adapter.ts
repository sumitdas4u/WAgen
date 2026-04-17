import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, AIProviderCapabilities, AIReplyResult, AIGenerateOptions } from "./interface.js";

// Anthropic does not provide embeddings — callers must use an embedding-capable
// provider (OpenAI / Gemini) alongside Anthropic for the RAG pipeline.
const UNSUPPORTED_EMBED = (): never => {
  throw new Error("Anthropic does not support embeddings. Configure an embedding provider.");
};

const DEFAULT_MODEL = "claude-3-5-haiku-20241022";
const VISION_MODEL  = "claude-3-5-sonnet-20241022"; // sonnet for vision tasks

export class AnthropicAdapter implements AIProvider {
  readonly providerName = "anthropic";
  readonly capabilities: AIProviderCapabilities = {
    chat: true,
    embeddings: false,
    vision: true
  };

  private client: Anthropic | null;

  constructor(apiKey?: string) {
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  embed = UNSUPPORTED_EMBED;
  embedMany = UNSUPPORTED_EMBED;

  async generateReply(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string,
    options?: AIGenerateOptions
  ): Promise<AIReplyResult> {
    if (!this.client) throw new Error("Anthropic API key not configured");
    const model = modelOverride?.trim() || DEFAULT_MODEL;
    const response = await this.client.messages.create({
      model,
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.4,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    });
    const content = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("")
      .trim();
    if (!content) throw new Error("Anthropic response was empty");
    return {
      content,
      model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens
      }
    };
  }

  async generateJson(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string
  ): Promise<Record<string, unknown>> {
    const result = await this.generateReply(
      systemPrompt + "\n\nReturn ONLY valid JSON. No markdown fences, no explanation.",
      userPrompt,
      modelOverride,
      { temperature: 0.2, maxTokens: 1024 }
    );
    return parseJsonContent(result.content);
  }

  async extractTextFromImage(imageBuffer: Buffer, mimeType: string, modelOverride?: string): Promise<string> {
    if (!this.client) throw new Error("Anthropic API key not configured");
    const model = modelOverride?.trim() || VISION_MODEL;
    const base64 = imageBuffer.toString("base64");
    const validMime = (mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/gif" || mimeType === "image/webp")
      ? mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp"
      : "image/jpeg";
    const response = await this.client.messages.create({
      model,
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: validMime, data: base64 } },
          { type: "text", text: "Extract the meaningful text from this image exactly and concisely. Return plain text only. If unreadable, return 'NO_TEXT'." }
        ]
      }]
    });
    const content = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();
    return content === "NO_TEXT" ? "" : content;
  }

  async analyzeImage(imageBuffer: Buffer, mimeType: string, modelOverride?: string): Promise<string> {
    if (!this.client) throw new Error("Anthropic API key not configured");
    const model = modelOverride?.trim() || VISION_MODEL;
    const base64 = imageBuffer.toString("base64");
    const validMime = (mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/gif" || mimeType === "image/webp")
      ? mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp"
      : "image/jpeg";
    const response = await this.client.messages.create({
      model,
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: validMime, data: base64 } },
          { type: "text", text: "Describe this image concisely and factually. Include what you see visually and any visible text. Be brief." }
        ]
      }]
    });
    return response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();
  }
}

function parseJsonContent(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(content.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    }
    throw new Error("Anthropic response was not valid JSON");
  }
}
