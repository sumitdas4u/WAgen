import OpenAI from "openai";
import { env } from "../../config/env.js";
import { getEffectiveChatModel } from "../model-settings-service.js";
import type { AIProvider, AIProviderCapabilities, AIReplyResult, AIGenerateOptions } from "./interface.js";

export class OpenAIAdapter implements AIProvider {
  readonly providerName = "openai";
  readonly capabilities: AIProviderCapabilities = {
    chat: true,
    embeddings: true,
    vision: true
  };

  private client: OpenAI | null;
  private readonly apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? env.OPENAI_API_KEY;
    this.client = this.apiKey ? new OpenAI({ apiKey: this.apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.client) throw new Error("OpenAI API key not configured");
    const response = await this.client.embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: text
    });
    const vector = response.data[0]?.embedding;
    if (!vector) throw new Error("OpenAI embedding response was empty");
    return vector;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (!this.client) throw new Error("OpenAI API key not configured");
    if (texts.length === 0) return [];
    const response = await this.client.embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: texts
    });
    if (response.data.length !== texts.length) {
      throw new Error("OpenAI embedding batch response size mismatch");
    }
    return response.data.map((item) => item.embedding);
  }

  async generateReply(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string,
    options?: AIGenerateOptions
  ): Promise<AIReplyResult> {
    if (!this.client) throw new Error("OpenAI API key not configured");
    const model = modelOverride?.trim() || (await getEffectiveChatModel());
    const response = await this.client.chat.completions.create({
      model,
      temperature: options?.temperature ?? 0.4,
      max_tokens: options?.maxTokens ?? env.OPENAI_MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });
    if (env.OPENAI_LOG_USAGE && response.usage) {
      console.info(`[OpenAI] model=${model} prompt=${response.usage.prompt_tokens} completion=${response.usage.completion_tokens}`);
    }
    const content = response.choices[0]?.message?.content?.trim();
    if (!content) throw new Error("OpenAI response was empty");
    return {
      content,
      model,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens
          }
        : undefined
    };
  }

  async generateJson(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string
  ): Promise<Record<string, unknown>> {
    if (!this.client) throw new Error("OpenAI API key not configured");
    const model = modelOverride?.trim() || (await getEffectiveChatModel());
    const response = await this.client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: Math.max(300, env.OPENAI_MAX_OUTPUT_TOKENS),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });
    const content = response.choices[0]?.message?.content?.trim();
    if (!content) throw new Error("OpenAI JSON response was empty");
    return parseJsonContent(content);
  }

  async extractTextFromImage(imageBuffer: Buffer, mimeType: string, modelOverride?: string): Promise<string> {
    if (!this.client) throw new Error("OpenAI API key not configured");
    const model = modelOverride?.trim() || (await getEffectiveChatModel());
    const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
    const response = await this.client.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: Math.max(300, env.OPENAI_MAX_OUTPUT_TOKENS),
      messages: [
        { role: "system", content: "Extract the meaningful text from the image exactly and concisely. Return plain text only. If unreadable, return 'NO_TEXT'." },
        { role: "user", content: [{ type: "text", text: "Extract text from this image." }, { type: "image_url", image_url: { url: dataUrl } }] as any }
      ] as any
    });
    const content = response.choices[0]?.message?.content?.trim() ?? "";
    return content === "NO_TEXT" ? "" : content;
  }

  async analyzeImage(imageBuffer: Buffer, mimeType: string, modelOverride?: string): Promise<string> {
    if (!this.client) throw new Error("OpenAI API key not configured");
    const model = modelOverride?.trim() || (await getEffectiveChatModel());
    const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
    const response = await this.client.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: Math.max(500, env.OPENAI_MAX_OUTPUT_TOKENS),
      messages: [
        { role: "system", content: "Describe this image concisely and factually. Include what you see visually and any text visible in the image. Be brief." },
        { role: "user", content: [{ type: "text", text: "What is in this image?" }, { type: "image_url", image_url: { url: dataUrl } }] as any }
      ] as any
    });
    return response.choices[0]?.message?.content?.trim() ?? "";
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
    throw new Error("Response was not valid JSON");
  }
}
