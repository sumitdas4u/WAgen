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
    `ALTER TABLE users
       ADD COLUMN IF NOT EXISTS firebase_uid TEXT`
  );

  await pool.query(
    `ALTER TABLE users
       ALTER COLUMN password_hash DROP NOT NULL`
  );

  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_unique_idx
       ON users(firebase_uid)
       WHERE firebase_uid IS NOT NULL`
  );

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_summaries (
      conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      summary_text TEXT NOT NULL,
      source_last_message_at TIMESTAMPTZ,
      model TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      channel_type TEXT NOT NULL CHECK (channel_type IN ('qr', 'api')),
      linked_number TEXT NOT NULL,
      business_basics JSONB NOT NULL DEFAULT '{}'::jsonb,
      personality TEXT NOT NULL DEFAULT 'friendly_warm',
      custom_personality_prompt TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS agent_profiles_user_idx
      ON agent_profiles(user_id, updated_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS agent_profiles_channel_lookup_idx
      ON agent_profiles(user_id, channel_type, linked_number, is_active)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS agent_profiles_unique_active_channel_idx
      ON agent_profiles(user_id, channel_type, linked_number)
      WHERE is_active = TRUE
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      razorpay_customer_id TEXT,
      razorpay_subscription_id TEXT UNIQUE,
      razorpay_plan_id TEXT,
      plan_code TEXT NOT NULL DEFAULT 'starter',
      status TEXT NOT NULL DEFAULT 'pending',
      current_start_at TIMESTAMPTZ,
      current_end_at TIMESTAMPTZ,
      next_charge_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      expiry_date TIMESTAMPTZ,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_subscriptions_status_idx
      ON user_subscriptions(status, updated_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_subscriptions_plan_idx
      ON user_subscriptions(plan_code, updated_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_row_id UUID REFERENCES user_subscriptions(id) ON DELETE SET NULL,
      razorpay_payment_id TEXT NOT NULL UNIQUE,
      razorpay_subscription_id TEXT,
      status TEXT NOT NULL,
      amount_paise INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'INR',
      method TEXT,
      description TEXT,
      paid_at TIMESTAMPTZ,
      failure_reason TEXT,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS subscription_payments_user_idx
      ON subscription_payments(user_id, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS subscription_payments_subscription_idx
      ON subscription_payments(razorpay_subscription_id, created_at DESC)
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION touch_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS user_subscriptions_touch_updated_at ON user_subscriptions
  `);

  await pool.query(`
    CREATE TRIGGER user_subscriptions_touch_updated_at
    BEFORE UPDATE ON user_subscriptions
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS agent_profiles_touch_updated_at ON agent_profiles
  `);

  await pool.query(`
    CREATE TRIGGER agent_profiles_touch_updated_at
    BEFORE UPDATE ON agent_profiles
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `);
}
