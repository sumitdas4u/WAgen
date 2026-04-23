import { Pool } from "pg";
import { env } from "../config/env.js";

// NOTE: WAgen uses the shared pg pool + SQL migrations as the primary DB layer.
// Prefer typed SQL helpers and withTransaction over introducing a second ORM stack.
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: env.PG_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.PG_POOL_CONNECTION_TIMEOUT_MS,
  ...(env.PG_STATEMENT_TIMEOUT_MS > 0
    ? { options: `-c statement_timeout=${env.PG_STATEMENT_TIMEOUT_MS}` }
    : {})
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
