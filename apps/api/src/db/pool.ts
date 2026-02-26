import { Pool } from "pg";
import { env } from "../config/env.js";

export const pool = new Pool({
  connectionString: env.DATABASE_URL
});

pool.on("error", (error: Error) => {
  console.error("PostgreSQL pool error", error);
});

export async function withTransaction<T>(fn: (client: import("pg").PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureDbCompatibility(): Promise<void> {
  await pool.query(
    `ALTER TABLE conversation_messages
       ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER,
       ADD COLUMN IF NOT EXISTS completion_tokens INTEGER,
       ADD COLUMN IF NOT EXISTS total_tokens INTEGER,
       ADD COLUMN IF NOT EXISTS ai_model TEXT,
       ADD COLUMN IF NOT EXISTS retrieval_chunks INTEGER`
  );

  await pool.query(
    `ALTER TABLE knowledge_base
       ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_ingest_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_name TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT NOT NULL DEFAULT 'Queued',
      progress INTEGER NOT NULL DEFAULT 0,
      chunks_created INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS knowledge_ingest_jobs_user_idx
      ON knowledge_ingest_jobs(user_id, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
