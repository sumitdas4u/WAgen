import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  APP_BASE_URL: z.string().default("http://localhost:5173"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be set"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL must be set"),
  REDIS_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_CHAT_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(220),
  OPENAI_LOG_USAGE: z.enum(["true", "false"]).default("true"),
  PROMPT_HISTORY_LIMIT: z.coerce.number().int().positive().default(6),
  RAG_RETRIEVAL_LIMIT: z.coerce.number().int().positive().default(8),
  RAG_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.08),
  RAG_KNOWLEDGE_ROUTER: z.enum(["true", "false"]).default("true"),
  RAG_MIN_QUERY_LENGTH: z.coerce.number().int().positive().default(12),
  RAG_MAX_PROMPT_CHARS: z.coerce.number().int().positive().default(3200),
  INGEST_MAX_SOURCE_CHARS: z.coerce.number().int().nonnegative().default(0),
  INGEST_MAX_CHUNKS_PER_FILE: z.coerce.number().int().nonnegative().default(0),
  INGEST_CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(650),
  INGEST_CHUNK_OVERLAP_TOKENS: z.coerce.number().int().positive().default(110),
  INGEST_EMBED_BATCH_SIZE: z.coerce.number().int().positive().default(24),
  OPENAI_EMBED_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  PDF_PARSE_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  PDF_UPLOAD_BUFFER_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  PDF_MIN_TEXT_CHARS: z.coerce.number().int().nonnegative().default(1),
  INBOUND_MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
  INBOUND_MEDIA_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  INBOUND_MEDIA_MAX_TEXT_CHARS: z.coerce.number().int().positive().default(2200),
  REPLY_DELAY_MIN_MS: z.coerce.number().default(2000),
  REPLY_DELAY_MAX_MS: z.coerce.number().default(5000),
  CONTACT_COOLDOWN_SECONDS: z.coerce.number().default(0),
  AUTO_RECONNECT: z.enum(["true", "false"]).default("true")
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => issue.message).join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = {
  ...parsed.data,
  OPENAI_LOG_USAGE: parsed.data.OPENAI_LOG_USAGE === "true",
  RAG_KNOWLEDGE_ROUTER: parsed.data.RAG_KNOWLEDGE_ROUTER === "true",
  AUTO_RECONNECT: parsed.data.AUTO_RECONNECT === "true"
};
