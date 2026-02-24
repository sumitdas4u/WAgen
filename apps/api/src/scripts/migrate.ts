import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const migrationId = "0001_initial";
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");

    const check = await client.query<{ id: string }>("SELECT id FROM migrations WHERE id = $1", [migrationId]);
    if (check.rowCount && check.rowCount > 0) {
      console.log("Migration already applied:", migrationId);
      await client.query("COMMIT");
      return;
    }

    const schemaPath = resolve(__dirname, "../../../../infra/schema.sql");
    const sql = readFileSync(schemaPath, "utf8");

    await client.query(sql);
    await client.query("INSERT INTO migrations (id) VALUES ($1)", [migrationId]);
    await client.query("COMMIT");

    console.log("Migration applied:", migrationId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error("Migration failed", error);
  process.exit(1);
});
