import { createDecipheriv, createHash } from "node:crypto";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";

type MetaRow = {
  user_id: string;
  waba_id: string;
  access_token_encrypted: string;
};

function decryptMetaToken(payload: string): string {
  const [version, ivB64, tagB64, encryptedB64] = String(payload || "").split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !encryptedB64) {
    throw new Error("Invalid encrypted token payload");
  }
  const seed = env.META_TOKEN_ENCRYPTION_KEY;
  if (!seed) {
    throw new Error("META_TOKEN_ENCRYPTION_KEY is required");
  }
  const key = createHash("sha256").update(seed).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final()
  ]).toString("utf8");
}

async function unsubscribeWaba(wabaId: string, accessToken: string): Promise<{ status: number; body: string }> {
  const url = `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${wabaId}/subscribed_apps`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  return {
    status: response.status,
    body: await response.text()
  };
}

async function run(): Promise<void> {
  const result = await pool.query<MetaRow>(
    `SELECT DISTINCT ON (waba_id)
            user_id,
            waba_id,
            access_token_encrypted
     FROM whatsapp_business_connections
     WHERE status <> 'disconnected'
     ORDER BY waba_id, updated_at DESC`
  );

  if ((result.rowCount ?? 0) === 0) {
    console.log("No active Meta connections found.");
    return;
  }

  let success = 0;
  let failed = 0;
  for (const row of result.rows) {
    try {
      const token = decryptMetaToken(row.access_token_encrypted);
      const response = await unsubscribeWaba(row.waba_id, token);
      const ok = response.status >= 200 && response.status < 300;
      if (ok) {
        success += 1;
      } else {
        failed += 1;
      }
      console.log(
        `user=${row.user_id} waba=${row.waba_id} status=${response.status} ok=${ok} body=${response.body}`
      );
    } catch (error) {
      failed += 1;
      console.log(
        `user=${row.user_id} waba=${row.waba_id} status=error ok=false message=${(error as Error).message}`
      );
    }
  }

  console.log(`Done. success=${success} failed=${failed} total=${result.rows.length}`);
}

run()
  .catch((error) => {
    console.error(`[meta-unsubscribe-all] ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
