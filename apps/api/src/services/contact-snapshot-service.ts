import { pool } from "../db/pool.js";
import type { SequenceContactSnapshot } from "./sequence-condition-service.js";

export async function loadContactSnapshot(contactId: string): Promise<SequenceContactSnapshot | null> {
  const [contactResult, customFieldsResult] = await Promise.all([
    pool.query<{
      id: string;
      display_name: string | null;
      phone_number: string;
      email: string | null;
      contact_type: string;
      tags: string[];
      source_type: string;
      source_id: string | null;
      source_url: string | null;
      created_at: string;
      updated_at: string;
    }>(`SELECT * FROM contacts WHERE id = $1 LIMIT 1`, [contactId]),
    pool.query<{ field_name: string; value: string | null }>(
      `SELECT cf.name AS field_name, cfv.value
       FROM contact_field_values cfv
       JOIN contact_fields cf ON cf.id = cfv.field_id
       WHERE cfv.contact_id = $1`,
      [contactId]
    )
  ]);

  const contact = contactResult.rows[0];
  if (!contact) {
    return null;
  }

  return {
    ...contact,
    custom_fields: Object.fromEntries(customFieldsResult.rows.map((row) => [row.field_name, row.value]))
  };
}
