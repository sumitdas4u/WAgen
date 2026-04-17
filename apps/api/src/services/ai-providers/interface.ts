// ── Shared types ──────────────────────────────────────────────────────────────

export interface AIGenerateOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIReplyResult {
  content: string;
  model: string;
  usage?: AIUsage;
}

// ── Provider capability flags ─────────────────────────────────────────────────

export interface AIProviderCapabilities {
  chat: boolean;       // generateReply / generateJson
  embeddings: boolean; // embed / embedMany
  vision: boolean;     // analyzeImage / extractTextFromImage
}

// ── The interface every adapter must implement ────────────────────────────────

export interface AIProvider {
  readonly providerName: string;
  readonly capabilities: AIProviderCapabilities;

  isConfigured(): boolean;

  /** Vector embed a single text string. */
  embed(text: string): Promise<number[]>;
  /** Batch embed multiple texts. */
  embedMany(texts: string[]): Promise<number[][]>;

  /** Chat completion returning plain text. */
  generateReply(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string,
    options?: AIGenerateOptions
  ): Promise<AIReplyResult>;

  /** Chat completion expecting a JSON object back. */
  generateJson(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string
  ): Promise<Record<string, unknown>>;

  /** Extract text content from an image buffer. */
  extractTextFromImage(
    imageBuffer: Buffer,
    mimeType: string,
    modelOverride?: string
  ): Promise<string>;

  /** Describe the content of an image buffer. */
  analyzeImage(
    imageBuffer: Buffer,
    mimeType: string,
    modelOverride?: string
  ): Promise<string>;
}
