export type SequenceConditionType = "start" | "stop_success" | "stop_failure";
export type SequenceConditionOperator = "eq" | "neq" | "gt" | "lt" | "contains";

export interface SequenceCondition {
  id: string;
  sequence_id: string;
  condition_type: SequenceConditionType;
  field: string;
  operator: SequenceConditionOperator;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface SequenceContactSnapshot {
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
  custom_fields: Record<string, string | null>;
}

function readFieldValue(snapshot: SequenceContactSnapshot, field: string): string {
  switch (field) {
    case "display_name":
    case "name":
      return snapshot.display_name ?? "";
    case "phone_number":
    case "phone":
      return snapshot.phone_number ?? "";
    case "email":
      return snapshot.email ?? "";
    case "contact_type":
    case "type":
      return snapshot.contact_type ?? "";
    case "source_type":
      return snapshot.source_type ?? "";
    case "source_id":
      return snapshot.source_id ?? "";
    case "source_url":
      return snapshot.source_url ?? "";
    case "tags":
      return snapshot.tags.join(",");
    case "created_at":
      return snapshot.created_at;
    case "updated_at":
      return snapshot.updated_at;
    default:
      break;
  }

  if (field.startsWith("custom:")) {
    return snapshot.custom_fields[field.slice("custom:".length)] ?? "";
  }

  return "";
}

function compareValues(left: string, operator: SequenceConditionOperator, right: string): boolean {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftDate = Date.parse(left);
  const rightDate = Date.parse(right);

  switch (operator) {
    case "eq":
      return left.trim().toLowerCase() === right.trim().toLowerCase();
    case "neq":
      return left.trim().toLowerCase() !== right.trim().toLowerCase();
    case "contains":
      return left.toLowerCase().includes(right.trim().toLowerCase());
    case "gt":
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber > rightNumber;
      }
      if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
        return leftDate > rightDate;
      }
      return left > right;
    case "lt":
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber < rightNumber;
      }
      if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
        return leftDate < rightDate;
      }
      return left < right;
    default:
      return false;
  }
}

export function evaluateSequenceConditions(
  conditions: SequenceCondition[],
  snapshot: SequenceContactSnapshot
): boolean {
  if (conditions.length === 0) {
    return true;
  }

  return conditions.every((condition) =>
    compareValues(readFieldValue(snapshot, condition.field), condition.operator, condition.value)
  );
}
