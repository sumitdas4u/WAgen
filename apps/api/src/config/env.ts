import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  APP_BASE_URL: z.string().default("http://localhost:5173"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL must be set"),
  METRICS_ENABLED: z.enum(["true", "false"]).default("false"),
  METRICS_ENDPOINT: z.string().default("/metrics"),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  PG_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30_000),
  PG_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(5_000),
  PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).max(300000).default(0),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  REDIS_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_CHAT_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  SUPER_ADMIN_EMAIL: z.string().optional(),
  SUPER_ADMIN_PASSWORD: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_PLAN_STARTER_ID: z.string().optional(),
  RAZORPAY_PLAN_PRO_ID: z.string().optional(),
  RAZORPAY_PLAN_BUSINESS_ID: z.string().optional(),
  TRIAL_DAYS: z.coerce.number().int().positive().default(14),
  TRIAL_CREDITS: z.coerce.number().int().nonnegative().default(200),
  CONVERSATION_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
  LOW_CREDIT_THRESHOLD: z.coerce.number().int().min(1).max(99).default(10),
  CREDIT_RENEWAL_CRON_ENABLED: z.enum(["true", "false"]).default("true"),
  CREDIT_RENEWAL_CRON_INTERVAL_SECONDS: z.coerce.number().int().positive().default(86400),
  DASHBOARD_BILLING_CENTER: z.enum(["true", "false"]).default("true"),
  BILLING_GST_RATE_PERCENT: z.coerce.number().min(0).max(100).default(18),
  RECHARGE_PRICE_PER_1000_CREDITS_INR: z.coerce.number().positive().default(5000),
  AUTO_RECHARGE_CRON_ENABLED: z.enum(["true", "false"]).default("true"),
  AUTO_RECHARGE_CRON_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  AUTO_RECHARGE_MAX_FAILURES: z.coerce.number().int().positive().default(3),
  AUTO_RECHARGE_SWEEP_LIMIT: z.coerce.number().int().positive().default(200),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_EMBEDDED_SIGNUP_CONFIG_ID: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  META_REDIRECT_URI: z.string().optional(),
  META_PHONE_REGISTRATION_PIN: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v19.0"),
  META_STATUS_SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  META_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  WA_SESSION_ENCRYPTION_KEY: z.string().optional(),
  USD_TO_INR: z.coerce.number().positive().default(83),
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
  BOT_LOOP_DETECTION_ENABLED: z.enum(["true", "false"]).default("true"),
  BOT_LOOP_QUICK_REPLY_SECONDS: z.coerce.number().int().positive().default(8),
  BOT_LOOP_REPEAT_WINDOW_SECONDS: z.coerce.number().int().positive().default(180),
  BOT_LOOP_DETECTION_KEYWORDS: z
    .string()
    .default(
      "automated,auto-reply,auto reply,do not reply,this is an automated message,virtual assistant,chatbot,bot"
    ),
  REPLY_DELAY_MIN_MS: z.coerce.number().default(2000),
  REPLY_DELAY_MAX_MS: z.coerce.number().default(5000),
  CONTACT_COOLDOWN_SECONDS: z.coerce.number().default(0),
  AUTO_RECONNECT: z.enum(["true", "false"]).default("true")
});

const EnvSchema = BaseEnvSchema.superRefine((data, ctx) => {
  if (data.META_TOKEN_ENCRYPTION_KEY && data.META_TOKEN_ENCRYPTION_KEY.length < 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "META_TOKEN_ENCRYPTION_KEY must be at least 32 characters"
    });
  }

  if (data.WA_SESSION_ENCRYPTION_KEY && data.WA_SESSION_ENCRYPTION_KEY.length < 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "WA_SESSION_ENCRYPTION_KEY must be at least 32 characters"
    });
  }

  const metaConfigured = Boolean(data.META_APP_ID || data.META_APP_SECRET || data.META_EMBEDDED_SIGNUP_CONFIG_ID);
  if (metaConfigured && !data.META_TOKEN_ENCRYPTION_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "META_TOKEN_ENCRYPTION_KEY is required when Meta integration is configured"
    });
  }

  if (data.META_PHONE_REGISTRATION_PIN && !/^\d{6}$/.test(data.META_PHONE_REGISTRATION_PIN)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "META_PHONE_REGISTRATION_PIN must be a 6-digit numeric PIN"
    });
  }
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
  BOT_LOOP_DETECTION_ENABLED: parsed.data.BOT_LOOP_DETECTION_ENABLED === "true",
  AUTO_RECONNECT: parsed.data.AUTO_RECONNECT === "true",
  CREDIT_RENEWAL_CRON_ENABLED: parsed.data.CREDIT_RENEWAL_CRON_ENABLED === "true",
  DASHBOARD_BILLING_CENTER: parsed.data.DASHBOARD_BILLING_CENTER === "true",
  AUTO_RECHARGE_CRON_ENABLED: parsed.data.AUTO_RECHARGE_CRON_ENABLED === "true",
  METRICS_ENABLED: parsed.data.METRICS_ENABLED === "true"
};
