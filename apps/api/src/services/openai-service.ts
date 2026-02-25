import OpenAI from "openai";
import { env } from "../config/env.js";

export class OpenAIService {
  private readonly client: OpenAI | null;

  constructor() {
    this.client = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.client) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const response = await this.client.embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: text
    });

    const vector = response.data[0]?.embedding;
    if (!vector) {
      throw new Error("Embedding response was empty");
    }

    return vector;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (!this.client) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    if (texts.length === 0) {
      return [];
    }

    const response = await this.client.embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: texts
    });

    if (!response.data || response.data.length !== texts.length) {
      throw new Error("Embedding batch response size mismatch");
    }

    return response.data.map((item) => item.embedding);
  }

  async generateReply(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{
    content: string;
    model: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  }> {
    if (!this.client) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const response = await this.client.chat.completions.create({
      model: env.OPENAI_CHAT_MODEL,
      temperature: 0.4,
      max_tokens: env.OPENAI_MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    if (env.OPENAI_LOG_USAGE && response.usage) {
      console.info(
        `[OpenAI] model=${env.OPENAI_CHAT_MODEL} prompt_tokens=${response.usage.prompt_tokens} completion_tokens=${response.usage.completion_tokens} total_tokens=${response.usage.total_tokens}`
      );
    }

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("LLM response was empty");
    }

    return {
      content,
      model: env.OPENAI_CHAT_MODEL,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens
          }
        : undefined
    };
  }

  async generateJson(systemPrompt: string, userPrompt: string): Promise<Record<string, unknown>> {
    if (!this.client) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const response = await this.client.chat.completions.create({
      model: env.OPENAI_CHAT_MODEL,
      temperature: 0.2,
      max_tokens: Math.max(300, env.OPENAI_MAX_OUTPUT_TOKENS),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    if (env.OPENAI_LOG_USAGE && response.usage) {
      console.info(
        `[OpenAI] model=${env.OPENAI_CHAT_MODEL} prompt_tokens=${response.usage.prompt_tokens} completion_tokens=${response.usage.completion_tokens} total_tokens=${response.usage.total_tokens}`
      );
    }

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("LLM JSON response was empty");
    }

    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      const firstBrace = content.indexOf("{");
      const lastBrace = content.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        return JSON.parse(content.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
      }
      throw new Error("LLM JSON response was not valid JSON");
    }
  }

  async extractTextFromImage(imageBuffer: Buffer, mimeType: string): Promise<string> {
    if (!this.client) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
    const response = await this.client.chat.completions.create({
      model: env.OPENAI_CHAT_MODEL,
      temperature: 0,
      max_tokens: Math.max(300, env.OPENAI_MAX_OUTPUT_TOKENS),
      messages: [
        {
          role: "system",
          content:
            "Extract the meaningful text from the image exactly and concisely. Return plain text only. If unreadable, return 'NO_TEXT'."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract text from this image." },
            { type: "image_url", image_url: { url: dataUrl } }
          ] as any
        }
      ] as any
    });

    const content = response.choices[0]?.message?.content?.trim() ?? "";
    return content === "NO_TEXT" ? "" : content;
  }
}

export const openAIService = new OpenAIService();
