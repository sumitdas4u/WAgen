import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIProvider, AIProviderCapabilities, AIReplyResult, AIGenerateOptions } from "./interface.js";

const DEFAULT_CHAT_MODEL  = "gemini-2.0-flash";
const DEFAULT_EMBED_MODEL = "text-embedding-004";

export class GeminiAdapter implements AIProvider {
  readonly providerName = "gemini";
  readonly capabilities: AIProviderCapabilities = {
    chat: true,
    embeddings: true,
    vision: true
  };

  private client: GoogleGenerativeAI | null;

  constructor(apiKey?: string) {
    this.client = apiKey ? new GoogleGenerativeAI(apiKey) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.client) throw new Error("Gemini API key not configured");
    const model = this.client.getGenerativeModel({ model: DEFAULT_EMBED_MODEL });
    const result = await model.embedContent(text);
    const values = result.embedding?.values;
    if (!values || values.length === 0) throw new Error("Gemini embedding response was empty");
    // Gemini text-embedding-004 returns 768 dims; pad to 1536 to match pgvector column
    if (values.length === 768) {
      return [...values, ...new Array(768).fill(0)];
    }
    return values;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  async generateReply(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string,
    options?: AIGenerateOptions
  ): Promise<AIReplyResult> {
    if (!this.client) throw new Error("Gemini API key not configured");
    const modelName = modelOverride?.trim() || DEFAULT_CHAT_MODEL;
    const model = this.client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt
    });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: options?.temperature ?? 0.4,
        maxOutputTokens: options?.maxTokens ?? 1024
      }
    });
    const content = result.response.text().trim();
    if (!content) throw new Error("Gemini response was empty");
    const usage = result.response.usageMetadata;
    return {
      content,
      model: modelName,
      usage: usage
        ? {
            promptTokens: usage.promptTokenCount ?? 0,
            completionTokens: usage.candidatesTokenCount ?? 0,
            totalTokens: usage.totalTokenCount ?? 0
          }
        : undefined
    };
  }

  async generateJson(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string
  ): Promise<Record<string, unknown>> {
    if (!this.client) throw new Error("Gemini API key not configured");
    const modelName = modelOverride?.trim() || DEFAULT_CHAT_MODEL;
    const model = this.client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt + "\n\nReturn ONLY valid JSON. No markdown fences, no explanation."
    });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: "application/json" }
    });
    const content = result.response.text().trim();
    return parseJsonContent(content);
  }

  async extractTextFromImage(imageBuffer: Buffer, mimeType: string, modelOverride?: string): Promise<string> {
    if (!this.client) throw new Error("Gemini API key not configured");
    const modelName = modelOverride?.trim() || DEFAULT_CHAT_MODEL;
    const model = this.client.getGenerativeModel({ model: modelName });
    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [
          { text: "Extract the meaningful text from the image exactly and concisely. Return plain text only. If unreadable, return 'NO_TEXT'." },
          { inlineData: { mimeType, data: imageBuffer.toString("base64") } }
        ]
      }]
    });
    const content = result.response.text().trim();
    return content === "NO_TEXT" ? "" : content;
  }

  async analyzeImage(imageBuffer: Buffer, mimeType: string, modelOverride?: string): Promise<string> {
    if (!this.client) throw new Error("Gemini API key not configured");
    const modelName = modelOverride?.trim() || DEFAULT_CHAT_MODEL;
    const model = this.client.getGenerativeModel({ model: modelName });
    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [
          { text: "Describe this image concisely and factually. Include what you see visually and any visible text. Be brief." },
          { inlineData: { mimeType, data: imageBuffer.toString("base64") } }
        ]
      }]
    });
    return result.response.text().trim();
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
    throw new Error("Gemini response was not valid JSON");
  }
}
