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

  async generateReply(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!this.client) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const response = await this.client.chat.completions.create({
      model: env.OPENAI_CHAT_MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("LLM response was empty");
    }

    return content;
  }
}

export const openAIService = new OpenAIService();