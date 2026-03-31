import { pool } from "../db/pool.js";

export type ContactFieldType = "TEXT" | "MULTI_TEXT" | "NUMBER" | "SWITCH" | "DATE";

export interface ContactField {
  id: string;
  user_id: string;
  label: string;
  name: string;
  field_type: ContactFieldType;
  is_active: boolean;
  is_mandatory: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ContactFieldWriteInput {
  label: string;
  name: string;
  field_type: ContactFieldType;
  is_active?: boolean;
  is_mandatory?: boolean;
}

const VALID_FIELD_TYPES = new Set<ContactFieldType>(["TEXT", "MULTI_TEXT", "NUMBER", "SWITCH", "DATE"]);

export async function listContactFields(userId: string): Promise<ContactField[]> {
  const result = await pool.query<ContactField>(
    `SELECT id, user_id, label, name, field_type, is_active, is_mandatory, sort_order, created_at, updated_at
     FROM contact_fields
     WHERE user_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [userId]
  );
  return result.rows;
}

export async function createContactField(userId: string, input: ContactFieldWriteInput): Promise<ContactField> {
  if (!VALID_FIELD_TYPES.has(input.field_type)) {
    throw new Error(`Invalid field type: ${input.field_type}`);
  }

  const maxOrderResult = await pool.query<{ max: number | null }>(
    `SELECT MAX(sort_order) AS max FROM contact_fields WHERE user_id = $1`,
    [userId]
  );
  const nextOrder = (maxOrderResult.rows[0]?.max ?? -1) + 1;

  const result = await pool.query<ContactField>(
    `INSERT INTO contact_fields (user_id, label, name, field_type, is_active, is_mandatory, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, user_id, label, name, field_type, is_active, is_mandatory, sort_order, created_at, updated_at`,
    [
      userId,
      input.label.trim(),
      input.name.trim(),
      input.field_type,
      input.is_active ?? true,
      input.is_mandatory ?? false,
      nextOrder
    ]
  );
  return result.rows[0];
}

export async function updateContactField(
  userId: string,
  fieldId: string,
  patch: Partial<Pick<ContactFieldWriteInput, "label" | "is_active" | "is_mandatory">>
): Promise<ContactField | null> {
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [userId, fieldId];
  let idx = 3;

  if (patch.label !== undefined) { sets.push(`label = $${idx++}`); params.push(patch.label.trim()); }
  if (patch.is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(patch.is_active); }
  if (patch.is_mandatory !== undefined) { sets.push(`is_mandatory = $${idx++}`); params.push(patch.is_mandatory); }

  if (sets.length === 1) return null;

  const result = await pool.query<ContactField>(
    `UPDATE contact_fields SET ${sets.join(", ")}
     WHERE user_id = $1 AND id = $2
     RETURNING id, user_id, label, name, field_type, is_active, is_mandatory, sort_order, created_at, updated_at`,
    params
  );
  return result.rows[0] ?? null;
}

export async function deleteContactField(userId: string, fieldId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM contact_fields WHERE user_id = $1 AND id = $2`,
    [userId, fieldId]
  );
  return (result.rowCount ?? 0) > 0;
}
