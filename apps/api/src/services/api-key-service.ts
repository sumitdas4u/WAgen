import { createHash, randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { firstRow } from "../db/sql-helpers.js";

interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function mapRow(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at
  };
}

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export async function createApiKey(
  userId: string,
  name: string
): Promise<{ key: ApiKey; rawKey: string }> {
  const raw = `wag_${randomBytes(24).toString("hex")}`;
  const hash = hashKey(raw);
  const prefix = raw.slice(0, 12);

  const result = await pool.query<ApiKeyRow>(
    `INSERT INTO user_api_keys (user_id, name, key_hash, key_prefix)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, name.trim(), hash, prefix]
  );

  return { key: mapRow(result.rows[0]!), rawKey: raw };
}

export async function listApiKeys(userId: string): Promise<ApiKey[]> {
  const result = await pool.query<ApiKeyRow>(
    `SELECT * FROM user_api_keys
     WHERE user_id = $1
       AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows.map(mapRow);
}

export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE user_api_keys
     SET revoked_at = NOW()
     WHERE id = $1
       AND user_id = $2
       AND revoked_at IS NULL`,
    [keyId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function validateApiKey(rawKey: string): Promise<string | null> {
  if (!rawKey.startsWith("wag_")) {
    return null;
  }

  const hash = hashKey(rawKey);
  const result = await pool.query<{ user_id: string; id: string }>(
    `UPDATE user_api_keys
     SET last_used_at = NOW()
     WHERE key_hash = $1
       AND revoked_at IS NULL
     RETURNING user_id, id`,
    [hash]
  );

  return firstRow(result)?.user_id ?? null;
}
