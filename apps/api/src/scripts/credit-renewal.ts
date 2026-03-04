import { pool } from "../db/pool.js";
import { renewDueWorkspaceCredits } from "../services/workspace-billing-service.js";

async function run(): Promise<void> {
  try {
    const result = await renewDueWorkspaceCredits({ limit: 5000 });
    console.log(`Credit renewal complete. processed=${result.processed} renewed=${result.renewed}`);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error("Credit renewal failed", error);
  process.exit(1);
});

