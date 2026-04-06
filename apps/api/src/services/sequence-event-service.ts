import { pool } from "../db/pool.js";
import { evaluateSequenceConditions, type SequenceContactSnapshot } from "./sequence-condition-service.js";
import { maybeCreateSequenceEnrollment } from "./sequence-enrollment-service.js";
import { getSequenceDetail, type Sequence } from "./sequence-service.js";

export type SequenceEventType = "contact_created" | "contact_updated";

function eventMatchesTrigger(event: SequenceEventType, triggerType: Sequence["trigger_type"]): boolean {
  if (triggerType === "both") {
    return true;
  }
  return (event === "contact_created" && triggerType === "create") || (event === "contact_updated" && triggerType === "update");
}

async function loadContactSnapshot(contactId: string): Promise<SequenceContactSnapshot | null> {
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

export async function processSequenceEvent(input: {
  userId: string;
  event: SequenceEventType;
  contactId: string;
}): Promise<{ matched: number; enrolled: number }> {
  const snapshot = await loadContactSnapshot(input.contactId);
  if (!snapshot) {
    return { matched: 0, enrolled: 0 };
  }

  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM sequences
     WHERE user_id = $1
       AND status = 'published'
       AND channel = 'whatsapp'`,
    [input.userId]
  );

  let matched = 0;
  let enrolled = 0;

  for (const row of result.rows) {
    const detail = await getSequenceDetail(input.userId, row.id);
    if (!detail) {
      continue;
    }
    if (!eventMatchesTrigger(input.event, detail.trigger_type)) {
      continue;
    }
    const startConditions = detail.conditions.filter((condition) => condition.condition_type === "start");
    if (!evaluateSequenceConditions(startConditions, snapshot)) {
      continue;
    }
    matched += 1;
    if (await maybeCreateSequenceEnrollment(detail, input.contactId)) {
      enrolled += 1;
    }
  }

  return { matched, enrolled };
}
