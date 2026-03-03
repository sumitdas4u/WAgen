import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "./migrate.js";

async function resetDatabaseForDev(): Promise<void> {
  const force = process.argv.includes("--force");

  if (env.NODE_ENV === "production") {
    throw new Error("Refusing reset in NODE_ENV=production.");
  }

  if (!force) {
    throw new Error("This is destructive. Re-run with --force.");
  }

  if (process.env.ALLOW_DB_RESET !== "true") {
    throw new Error("Set ALLOW_DB_RESET=true to confirm local DB reset.");
  }

  const client = await pool.connect();
  try {
    console.log("Resetting public schema...");
    await client.query("BEGIN");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO CURRENT_USER");
    await client.query("GRANT ALL ON SCHEMA public TO public");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  console.log("Re-applying migrations...");
  await runMigrations({ silent: false });
  await pool.end();
  console.log("DB reset complete.");
}

resetDatabaseForDev().catch((error) => {
  console.error("DB reset failed", error);
  process.exit(1);
});
