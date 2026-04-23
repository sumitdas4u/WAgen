import { firstRow, hasRows, requireRow } from "../db/sql-helpers.js";
import { pool } from "../db/pool.js";
import type { Contact } from "../types/models.js";
import { listContacts } from "./contacts-service.js";

export type SegmentFilterOp =
  | "is"
  | "is_not"
  | "contains"
  | "not_contains"
  | "before"
  | "after"
  | "is_empty"
  | "is_not_empty";

export interface SegmentFilter {
  field: string;   // "display_name" | "phone_number" | "email" | "contact_type" | "tags" | "created_at" | "custom:{name}"
  op: SegmentFilterOp;
  value: string;
}

export interface ContactSegment {
  id: string;
  user_id: string;
  name: string;
  filters: SegmentFilter[];
  created_at: string;
  updated_at: string;
}

const STANDARD_FIELDS: Record<string, string> = {
  display_name: "c.display_name",
  phone_number: "c.phone_number",
  email: "c.email",
  contact_type: "c.contact_type",
  source_type: "c.source_type",
  tags: "array_to_string(c.tags, ',')",
  created_at: "c.created_at"
};

const DATE_FIELDS = new Set(["created_at"]);

function buildFilterSql(
  filters: SegmentFilter[],
  params: unknown[]
): { clauses: string[]; customJoins: string[] } {
  const clauses: string[] = [];
  const customJoins: string[] = [];
  const joinedCustomFields = new Set<string>();

  for (const filter of filters) {
    const { field, op, value } = filter;

    if (field.startsWith("custom:")) {
      const fieldName = field.slice(7);
      const alias = `cfv_${fieldName.replace(/[^a-z0-9]/gi, "_")}`;
      const cfAlias = `cf_${alias}`;

      if (!joinedCustomFields.has(fieldName)) {
        joinedCustomFields.add(fieldName);
        params.push(fieldName);
        customJoins.push(
          `LEFT JOIN contact_fields ${cfAlias} ON ${cfAlias}.name = $${params.length} AND ${cfAlias}.user_id = c.user_id` +
          ` LEFT JOIN contact_field_values ${alias} ON ${alias}.contact_id = c.id AND ${alias}.field_id = ${cfAlias}.id`
        );
      }

      const col = `${alias}.value`;
      const clause = buildOpClause(col, op, value, params, false);
      if (clause) clauses.push(clause);
    } else if (STANDARD_FIELDS[field]) {
      const col = STANDARD_FIELDS[field];
      const isDate = DATE_FIELDS.has(field);
      const clause = buildOpClause(col, op, value, params, isDate);
      if (clause) clauses.push(clause);
    }
  }

  return { clauses, customJoins };
}

function buildOpClause(
  col: string,
  op: SegmentFilterOp,
  value: string,
  params: unknown[],
  isDate: boolean
): string | null {
  const cast = isDate ? "::timestamptz" : "";

  switch (op) {
    case "is":
      params.push(value);
      return `LOWER(${col}) = LOWER($${params.length})`;
    case "is_not":
      params.push(value);
      return `LOWER(COALESCE(${col}, '')) != LOWER($${params.length})`;
    case "contains":
      params.push(`%${value}%`);
      return `COALESCE(${col}, '') ILIKE $${params.length}`;
    case "not_contains":
      params.push(`%${value}%`);
      return `COALESCE(${col}, '') NOT ILIKE $${params.length}`;
    case "before":
      params.push(value);
      return `${col}${cast} < $${params.length}${cast}`;
    case "after":
      params.push(value);
      return `${col}${cast} > $${params.length}${cast}`;
    case "is_empty":
      return `(${col} IS NULL OR TRIM(COALESCE(${col}, '')) = '')`;
    case "is_not_empty":
      return `(${col} IS NOT NULL AND TRIM(COALESCE(${col}, '')) != '')`;
    default:
      return null;
  }
}

export async function listSegments(userId: string): Promise<ContactSegment[]> {
  const result = await pool.query<ContactSegment>(
    `SELECT id, user_id, name, filters, created_at, updated_at
     FROM contact_segments
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function createSegment(userId: string, name: string, filters: SegmentFilter[]): Promise<ContactSegment> {
  const result = await pool.query<ContactSegment>(
    `INSERT INTO contact_segments (user_id, name, filters)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id, user_id, name, filters, created_at, updated_at`,
    [userId, name.trim(), JSON.stringify(filters)]
  );
  return requireRow(result, "Expected contact segment row");
}

export async function updateSegment(
  userId: string,
  segmentId: string,
  patch: { name?: string; filters?: SegmentFilter[] }
): Promise<ContactSegment | null> {
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [userId, segmentId];
  let idx = 3;

  if (patch.name !== undefined) { sets.push(`name = $${idx++}`); params.push(patch.name.trim()); }
  if (patch.filters !== undefined) { sets.push(`filters = $${idx++}::jsonb`); params.push(JSON.stringify(patch.filters)); }

  if (sets.length === 1) return null;

  const result = await pool.query<ContactSegment>(
    `UPDATE contact_segments SET ${sets.join(", ")}
     WHERE user_id = $1 AND id = $2
     RETURNING id, user_id, name, filters, created_at, updated_at`,
    params
  );
  return firstRow(result);
}

export async function deleteSegment(userId: string, segmentId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM contact_segments WHERE user_id = $1 AND id = $2`,
    [userId, segmentId]
  );
  return hasRows(result);
}

export async function getSegmentContacts(userId: string, segmentId: string): Promise<Contact[]> {
  const segResult = await pool.query<ContactSegment>(
    `SELECT filters FROM contact_segments WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, segmentId]
  );
  const segment = firstRow(segResult);
  if (!segment) return [];

  const filters: SegmentFilter[] = Array.isArray(segment.filters) ? segment.filters : [];
  return applyFilters(userId, filters);
}

export async function applyFilters(userId: string, filters: SegmentFilter[]): Promise<Contact[]> {
  const params: unknown[] = [userId];
  const { clauses, customJoins } = buildFilterSql(filters, params);

  const whereClause = ["c.user_id = $1", ...clauses].join(" AND ");
  const joinSql = customJoins.length > 0 ? customJoins.join(" ") : "";

  const sql = `SELECT DISTINCT c.* FROM contacts c ${joinSql} WHERE ${whereClause} ORDER BY c.updated_at DESC, c.created_at DESC LIMIT 1000`;
  const result = await pool.query<Contact>(sql, params);

  if (result.rows.length === 0) return [];

  // Load custom field values
  const contactIds = result.rows.map((c) => c.id);
  const fvResult = await pool.query<{ contact_id: string; field_id: string; field_name: string; field_label: string; field_type: string; value: string | null }>(
    `SELECT cfv.contact_id, cfv.field_id, cf.name AS field_name, cf.label AS field_label, cf.field_type, cfv.value
     FROM contact_field_values cfv
     JOIN contact_fields cf ON cf.id = cfv.field_id
     WHERE cfv.contact_id = ANY($1::uuid[])
     ORDER BY cf.sort_order ASC`,
    [contactIds]
  );
  const fvMap = new Map<string, typeof fvResult.rows>();
  for (const row of fvResult.rows) {
    if (!fvMap.has(row.contact_id)) fvMap.set(row.contact_id, []);
    fvMap.get(row.contact_id)!.push(row);
  }

  return result.rows.map((c) => ({ ...c, custom_field_values: fvMap.get(c.id) ?? [] }));
}
