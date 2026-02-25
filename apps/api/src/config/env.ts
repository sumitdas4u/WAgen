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
  AUTO_RECONNECT: parsed.data.AUTO_RECONNECT === "true"
};
