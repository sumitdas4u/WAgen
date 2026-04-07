import { env } from "../config/env.js";
import { pool } from "../db/pool.js";

type MetaRow = {
  id: string;
  user_id: string;
  waba_id: string;
  billing_allocation_config_id: string;
};

async function detachAllocationConfig(allocationConfigId: string): Promise<{ status: number; body: string }> {
  const token = env.META_SYSTEM_USER_TOKEN?.trim();
  if (!token) {
    throw new Error("META_SYSTEM_USER_TOKEN is not configured");
  }
  const url = `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${allocationConfigId}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  return {
    status: response.status,
    body: await response.text()
  };
}

async function run(): Promise<void> {
  const result = await pool.query<MetaRow>(
    `SELECT id, user_id, waba_id, billing_allocation_config_id
     FROM whatsapp_business_connections
     WHERE billing_allocation_config_id IS NOT NULL
       AND billing_status = 'attached'
     ORDER BY created_at ASC`
  );

  if ((result.rowCount ?? 0) === 0) {
    console.log("No connections with an attached credit line found.");
    return;
  }

  console.log(`Found ${result.rows.length} connection(s) with attached credit lines. Detaching...`);

  let success = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      const response = await detachAllocationConfig(row.billing_allocation_config_id);
      const ok = response.status >= 200 && response.status < 300;

      if (ok) {
        await pool.query(
          `UPDATE whatsapp_business_connections
           SET billing_status = 'detached',
               billing_allocation_config_id = NULL,
               billing_credit_line_id = NULL,
               billing_owner_business_id = NULL,
               billing_attached_at = NULL,
               billing_mode = 'none'
           WHERE id = $1`,
          [row.id]
        );
        success += 1;
      } else {
        failed += 1;
      }

      console.log(
        `user=${row.user_id} waba=${row.waba_id} allocationConfig=${row.billing_allocation_config_id} status=${response.status} ok=${ok} body=${response.body}`
      );
    } catch (error) {
      failed += 1;
      console.log(
        `user=${row.user_id} waba=${row.waba_id} allocationConfig=${row.billing_allocation_config_id} status=error ok=false message=${(error as Error).message}`
      );
    }
  }

  console.log(`Done. success=${success} failed=${failed} total=${result.rows.length}`);
}

run()
  .catch((error) => {
    console.error(`[detach-credit-lines-all] ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
