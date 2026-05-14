import { pool } from "../db/pool.js";
import { evaluateSequenceConditions, type SequenceContactSnapshot } from "./sequence-condition-service.js";
import { loadContactSnapshot } from "./contact-snapshot-service.js";
import { maybeCreateSequenceEnrollment } from "./sequence-enrollment-service.js";
import { getSequenceDetail, type Sequence } from "./sequence-service.js";

export type SequenceEventType = "contact_created" | "contact_updated";

function eventMatchesTrigger(event: SequenceEventType, triggerType: Sequence["trigger_type"]): boolean {
  if (triggerType === "both") {
    return true;
  }
  return (event === "contact_created" && triggerType === "create") || (event === "contact_updated" && triggerType === "update");
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
