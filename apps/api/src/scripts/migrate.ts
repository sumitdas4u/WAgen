import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool as PgPool, PoolClient } from "pg";

export interface MigrationPlanItem {
  id: string;
  sourcePath: string;
  sql: string;
  checksum: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "../../../../");
const BASELINE_SCHEMA_PATH = resolve(ROOT_DIR, "infra/schema.sql");
const MIGRATIONS_DIR = resolve(ROOT_DIR, "infra/migrations");
const ADVISORY_LOCK_KEY = 68423190;

function computeChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function readSqlFile(path: string): string {
  return readFileSync(path, "utf8");
}

export function buildMigrationPlan(): MigrationPlanItem[] {
  const plan: MigrationPlanItem[] = [];

  const baselineSql = readSqlFile(BASELINE_SCHEMA_PATH);
  plan.push({
    id: "0001_initial",
    sourcePath: BASELINE_SCHEMA_PATH,
    sql: baselineSql,
    checksum: computeChecksum(baselineSql)
  });

  if (!existsSync(MIGRATIONS_DIR)) {
    return plan;
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+[_-].+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const sourcePath = resolve(MIGRATIONS_DIR, file);
    const sql = readSqlFile(sourcePath);
    plan.push({
      id: file.replace(/\.sql$/i, ""),
      sourcePath,
      sql,
      checksum: computeChecksum(sql)
    });
  }

  return plan;
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    ALTER TABLE migrations
      ADD COLUMN IF NOT EXISTS checksum TEXT
  `);
}

async function ensureCriticalRuntimeTables(client: PoolClient): Promise<void> {
  // Safety net: keep AI Review available even if migration history was partially applied.
  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_review_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
      customer_phone TEXT NOT NULL,
      question TEXT NOT NULL,
      ai_response TEXT NOT NULL,
      confidence_score INTEGER NOT NULL DEFAULT 0,
      trigger_signals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      status TEXT NOT NULL DEFAULT 'pending',
      resolution_answer TEXT,
      resolved_at TIMESTAMPTZ,
      resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    ALTER TABLE ai_review_queue
      DROP CONSTRAINT IF EXISTS ai_review_queue_confidence_score_check,
      DROP CONSTRAINT IF EXISTS ai_review_queue_status_check
  `);

  await client.query(`
    ALTER TABLE ai_review_queue
      ADD CONSTRAINT ai_review_queue_confidence_score_check CHECK (confidence_score >= 0 AND confidence_score <= 100),
      ADD CONSTRAINT ai_review_queue_status_check CHECK (status IN ('pending', 'resolved'))
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS ai_review_queue_user_status_idx
      ON ai_review_queue(user_id, status, created_at DESC)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS ai_review_queue_conversation_idx
      ON ai_review_queue(conversation_id, created_at DESC)
  `);
}

async function applyMigration(client: PoolClient, item: MigrationPlanItem, silent = false): Promise<void> {
  if (!silent) {
    console.log(`Applying migration ${item.id} from ${item.sourcePath}`);
  }

  await client.query("BEGIN");
  try {
    await client.query(item.sql);
    await client.query("INSERT INTO migrations (id, checksum) VALUES ($1, $2)", [item.id, item.checksum]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

export async function runMigrations(options?: { closePool?: boolean; silent?: boolean; pool?: PgPool }): Promise<void> {
  const closePool = options?.closePool ?? false;
  const silent = options?.silent ?? false;
  // Dynamically import the shared pool so env.ts validation only runs when
  // the app pool is actually needed (not when migrations run standalone).
  const poolToUse = options?.pool ?? (await import("../db/pool.js")).pool;
  const client = await poolToUse.connect();

  let advisoryLockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    advisoryLockAcquired = true;

    await ensureMigrationsTable(client);

    const existingRows = await client.query<{ id: string; checksum: string | null }>(
      "SELECT id, checksum FROM migrations ORDER BY executed_at ASC"
    );
    const existing = new Map(existingRows.rows.map((row) => [row.id, row.checksum]));

    const plan = buildMigrationPlan();

    let appliedCount = 0;
    let skippedCount = 0;

    for (const item of plan) {
      const appliedChecksum = existing.get(item.id);
      if (appliedChecksum !== undefined) {
        skippedCount += 1;
        if (appliedChecksum && appliedChecksum !== item.checksum && !silent) {
          console.warn(
            `Migration ${item.id} checksum mismatch. Applied=${appliedChecksum.slice(0, 12)} Current=${item.checksum.slice(0, 12)}`
          );
        }
        continue;
      }

      await applyMigration(client, item, silent);
      existing.set(item.id, item.checksum);
      appliedCount += 1;
    }

    await ensureCriticalRuntimeTables(client);

    if (!silent) {
      console.log(`Migration run complete. applied=${appliedCount} skipped=${skippedCount} total=${plan.length}`);
    }
  } finally {
    try {
      if (advisoryLockAcquired) {
        await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
      }
    } finally {
      client.release();
      if (closePool) {
        await poolToUse.end();
      }
    }
  }
}

if (isMainModule()) {
  // When run as a standalone script (npm run db:migrate), create a minimal
  // pool using only DATABASE_URL — bypasses full env validation so migrations
  // don't require JWT_SECRET or other app-level secrets.
  const { config } = await import("dotenv");
  config();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required to run migrations");
    process.exit(1);
  }

  const { Pool } = await import("pg");
  const standalonePool = new Pool({ connectionString: databaseUrl });

  try {
    await runMigrations({ pool: standalonePool });
  } catch (error) {
    console.error("Migration failed", error);
    process.exit(1);
  } finally {
    await standalonePool.end();
  }
}
