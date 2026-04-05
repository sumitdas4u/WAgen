import { config } from "dotenv";
import { Pool } from "pg";
import { buildMigrationPlan, migrationChecksumMatches } from "./migrate.js";

config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

async function showMigrationStatus(): Promise<void> {
  const client = await pool.connect();

  try {
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

    const appliedResult = await client.query<{ id: string; checksum: string | null; executed_at: string }>(
      "SELECT id, checksum, executed_at::text FROM migrations ORDER BY executed_at ASC"
    );
    const appliedMap = new Map(appliedResult.rows.map((row) => [row.id, row]));

    const plan = buildMigrationPlan();
    const pending = plan.filter((item) => !appliedMap.has(item.id));

    console.log("\nMigration status\n----------------");
    console.log(`Applied: ${appliedResult.rowCount ?? 0}`);
    console.log(`Pending: ${pending.length}`);
    console.log(`Planned: ${plan.length}\n`);

    for (const item of plan) {
      const applied = appliedMap.get(item.id);
      if (applied) {
        const mismatch = applied.checksum ? !migrationChecksumMatches(item, applied.checksum) : false;
        console.log(`[APPLIED] ${item.id} at ${applied.executed_at}${mismatch ? " (checksum mismatch)" : ""}`);
      } else {
        console.log(`[PENDING] ${item.id}`);
      }
    }

    console.log("");
  } finally {
    client.release();
    await pool.end();
  }
}

showMigrationStatus().catch((error) => {
  console.error("Failed to load migration status", error);
  process.exit(1);
});
