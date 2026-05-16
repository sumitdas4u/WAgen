import { firstRow, hasRows, requireRow } from "../db/sql-helpers.js";
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
  is_system: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const SYSTEM_FIELDS: Array<{ label: string; name: string }> = [
  { label: "Birthday", name: "birthday" },
  { label: "Anniversary", name: "anniversary" }
];

export async function ensureSystemContactFields(userId: string): Promise<void> {
  for (const field of SYSTEM_FIELDS) {
    await pool.query(
      `INSERT INTO contact_fields (user_id, label, name, field_type, is_active, is_mandatory, is_system, sort_order)
       VALUES ($1, $2, $3, 'DATE', true, false, true, -1)
       ON CONFLICT (user_id, name) DO UPDATE SET is_system = true`,
      [userId, field.label, field.name]
    );
  }
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
  await ensureSystemContactFields(userId);
  const result = await pool.query<ContactField>(
    `SELECT id, user_id, label, name, field_type, is_active, is_mandatory, is_system, sort_order, created_at, updated_at
     FROM contact_fields
     WHERE user_id = $1
     ORDER BY is_system DESC, sort_order ASC, created_at ASC`,
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
  const nextOrder = (firstRow(maxOrderResult)?.max ?? -1) + 1;

  const result = await pool.query<ContactField>(
    `INSERT INTO contact_fields (user_id, label, name, field_type, is_active, is_mandatory, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, user_id, label, name, field_type, is_active, is_mandatory, is_system, sort_order, created_at, updated_at`,
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
  return requireRow(result, "Expected contact field row");
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
     RETURNING id, user_id, label, name, field_type, is_active, is_mandatory, is_system, sort_order, created_at, updated_at`,
    params
  );
  return firstRow(result);
}

export async function deleteContactField(userId: string, fieldId: string): Promise<{ deleted: boolean; isSystem: boolean }> {
  const check = await pool.query<{ is_system: boolean }>(
    `SELECT is_system FROM contact_fields WHERE user_id = $1 AND id = $2`,
    [userId, fieldId]
  );
  if (!check.rows[0]) return { deleted: false, isSystem: false };
  if (check.rows[0].is_system) return { deleted: false, isSystem: true };

  const result = await pool.query(
    `DELETE FROM contact_fields WHERE user_id = $1 AND id = $2`,
    [userId, fieldId]
  );
  return { deleted: hasRows(result), isSystem: false };
}
