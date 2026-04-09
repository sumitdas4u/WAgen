import type { Pool, PoolClient } from "pg";
import * as XLSX from "xlsx";
import { pool, withTransaction } from "../db/pool.js";
import type { Contact, ContactFieldValue, ContactSourceType, Conversation, ConversationKind } from "../types/models.js";

const CONTACT_TYPE_VALUES = new Set<ConversationKind>(["lead", "feedback", "complaint", "other"]);
const CONTACT_SOURCE_VALUES = new Set<ContactSourceType>(["manual", "import", "web", "qr", "api"]);
const USER_MANAGED_SOURCES = new Set<ContactSourceType>(["manual", "import"]);
const CONTACT_TEMPLATE_HEADERS = [
  "Name",
  "Phone",
  "Email",
  "Type",
  "Tags",
  "Contact Created Source",
  "Source ID",
  "Source URL"
] as const;

type DbExecutor = Pick<Pool, "query"> | PoolClient;

export interface ContactsListFilters {
  q?: string;
  type?: ConversationKind;
  source?: ContactSourceType;
  limit?: number;
}

export interface ContactWriteInput {
  userId: string;
  displayName?: string | null;
  phoneNumber: string;
  email?: string | null;
  contactType?: ConversationKind;
  tags?: string[];
  sourceType?: ContactSourceType;
  sourceId?: string | null;
  sourceUrl?: string | null;
  linkedConversationId?: string | null;
}

export interface CreateManualContactInput {
  displayName: string;
  phoneNumber: string;
  email?: string | null;
  contactType?: ConversationKind;
  tags?: string[];
  sourceId?: string | null;
  sourceUrl?: string | null;
  customFields?: Record<string, string>;
}

export interface ContactImportError {
  row: number;
  message: string;
}

export interface ContactImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: ContactImportError[];
}

export interface ContactImportPreview {
  columns: string[];
  sampleRows: Array<Record<string, string>>;
  suggestedMapping: Record<string, string>;
}

export interface ContactUpsertResult {
  contact: Contact;
  action: "created" | "updated" | "skipped";
}

export type FlowContactUpdateOperation = "replace" | "append" | "add_if_empty";

async function emitSequenceContactEvent(result: ContactUpsertResult): Promise<void> {
  if (result.action === "skipped") {
    return;
  }
  try {
    const { processSequenceEvent } = await import("./sequence-event-service.js");
    await processSequenceEvent({
      userId: result.contact.user_id,
      event: result.action === "created" ? "contact_created" : "contact_updated",
      contactId: result.contact.id
    });
  } catch (error) {
    console.warn("[Sequence] contact event processing failed", error);
  }
}

interface ContactImportWorkbookOptions {
  extraTags?: string[];
  phoneNumberFormat?: "with_country_code" | "without_country_code";
  defaultCountryCode?: string | null;
  marketingOptIn?: boolean;
  columnMapping?: Record<string, string>;
}

function normalizePhoneNumber(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  return digits;
}

function normalizeHeader(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getContactImportAliases(): Record<string, string[]> {
  return {
    display_name: ["name", "contact name", "full name", "customer name"],
    phone_number: ["phone", "phone number", "mobile", "mobile number", "whatsapp", "whatsapp number"],
    email: ["email", "email address"],
    contact_type: ["type", "contact type", "lead type"],
    tags: ["tags", "tag"],
    source_type: ["contact created source", "source", "source type"],
    source_id: ["source id", "external id"],
    source_url: ["source url", "url", "source link"]
  };
}

function readContactsWorkbookSheet(fileBuffer: Buffer): {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  sampleRows: Array<Record<string, string>>;
} {
  const workbook = XLSX.read(fileBuffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.Sheets.Contacts ? "Contacts" : workbook.SheetNames[0];
  const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!worksheet) {
    throw new Error("Workbook does not contain a Contacts sheet.");
  }

  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(worksheet, {
    header: 1,
    defval: ""
  });

  const headerRow = (matrix[0] ?? []).map((cell) => String(cell ?? "").trim());
  const columns = headerRow.filter(Boolean);
  if (columns.length === 0) {
    throw new Error("Workbook must include a header row with column names.");
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: ""
  });
  const sampleRows = rows.slice(0, 5).map((row) =>
    Object.fromEntries(
      columns.map((column) => {
        const raw = row[column];
        if (raw instanceof Date) {
          return [column, raw.toISOString()];
        }
        return [column, String(raw ?? "")];
      })
    )
  );

  return { columns, rows, sampleRows };
}

function buildSuggestedContactImportMapping(columns: string[]): Record<string, string> {
  const aliases = getContactImportAliases();
  const suggestions: Record<string, string> = {};

  for (const [fieldKey, knownAliases] of Object.entries(aliases)) {
    const match = columns.find((column) => {
      const normalized = normalizeHeader(column);
      return knownAliases.includes(normalized);
    });
    if (match) {
      suggestions[fieldKey] = match;
    }
  }

  return suggestions;
}

function getMappedWorkbookValue(
  row: Record<string, unknown>,
  mapping: Record<string, string>,
  fieldKey: string
): unknown {
  const column = mapping[fieldKey];
  if (!column) {
    return "";
  }
  return row[column];
}

export function previewContactsWorkbookImport(fileBuffer: Buffer): ContactImportPreview {
  const { columns, sampleRows } = readContactsWorkbookSheet(fileBuffer);
  return {
    columns,
    sampleRows,
    suggestedMapping: buildSuggestedContactImportMapping(columns)
  };
}

function normalizeImportedPhoneNumber(
  value: string | null | undefined,
  options?: Pick<ContactImportWorkbookOptions, "phoneNumberFormat" | "defaultCountryCode">
): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  if (options?.phoneNumberFormat === "without_country_code") {
    const countryCode = (options.defaultCountryCode ?? "").replace(/\D/g, "");
    const combined = `${countryCode}${digits}`;
    if (combined.length < 8 || combined.length > 15) {
      return null;
    }
    return combined;
  }

  return normalizePhoneNumber(value);
}

function normalizeDisplayName(value: string | null | undefined): string | null {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 160) : null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized.slice(0, 160) : null;
}

function normalizeContactType(value: string | null | undefined): ConversationKind | null {
  const normalized = (value ?? "").trim().toLowerCase();
  return CONTACT_TYPE_VALUES.has(normalized as ConversationKind) ? (normalized as ConversationKind) : null;
}

function normalizeSourceType(value: string | null | undefined): ContactSourceType | null {
  const normalized = (value ?? "").trim().toLowerCase();
  return CONTACT_SOURCE_VALUES.has(normalized as ContactSourceType) ? (normalized as ContactSourceType) : null;
}

function normalizeTags(values: string[] | null | undefined): string[] {
  if (!values) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 24)
    )
  );
}

function parseTagCell(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeTags(value.map((item) => String(item ?? "")));
  }
  return normalizeTags(String(value ?? "").split(","));
}

function isSourcePreserved(existingSource: ContactSourceType | null | undefined): boolean {
  return existingSource ? USER_MANAGED_SOURCES.has(existingSource) : false;
}

function mergeTags(left: string[], right: string[]): string[] {
  return normalizeTags([...left, ...right]);
}

function applyTextOperation(
  currentValue: string | null | undefined,
  incomingValue: string | null | undefined,
  operation: FlowContactUpdateOperation,
  options?: { separator?: string }
): string | null {
  const current = String(currentValue ?? "").trim();
  const incoming = String(incomingValue ?? "").trim();

  if (operation === "add_if_empty") {
    return current ? current : incoming || null;
  }

  if (operation === "append") {
    if (!incoming) {
      return current || null;
    }
    if (!current) {
      return incoming;
    }
    return `${current}${options?.separator ?? ", "}${incoming}`;
  }

  return incoming || null;
}

function formatWorkbookDate(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19);
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getContactTypeWeight(value: ConversationKind): number {
  switch (value) {
    case "complaint":
      return 4;
    case "feedback":
      return 3;
    case "lead":
      return 2;
    default:
      return 1;
  }
}

async function loadFieldValues(db: DbExecutor, contactIds: string[]): Promise<Map<string, ContactFieldValue[]>> {
  if (contactIds.length === 0) return new Map();
  const result = await db.query<{ contact_id: string; field_id: string; field_name: string; field_label: string; field_type: string; value: string | null }>(
    `SELECT cfv.contact_id, cfv.field_id, cf.name AS field_name, cf.label AS field_label, cf.field_type, cfv.value
     FROM contact_field_values cfv
     JOIN contact_fields cf ON cf.id = cfv.field_id
     WHERE cfv.contact_id = ANY($1::uuid[])
     ORDER BY cf.sort_order ASC, cf.created_at ASC`,
    [contactIds]
  );
  const map = new Map<string, ContactFieldValue[]>();
  for (const row of result.rows) {
    if (!map.has(row.contact_id)) map.set(row.contact_id, []);
    map.get(row.contact_id)!.push({ field_id: row.field_id, field_name: row.field_name, field_label: row.field_label, field_type: row.field_type, value: row.value });
  }
  return map;
}

async function saveFieldValues(db: DbExecutor, contactId: string, customFields: Record<string, string>): Promise<void> {
  const entries = Object.entries(customFields).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return;

  // Resolve field names to IDs in a single query
  const names = entries.map(([k]) => k);
  const fieldRows = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM contact_fields WHERE name = ANY($1::text[])`,
    [names]
  );
  const nameToId = new Map(fieldRows.rows.map((r) => [r.name, r.id]));

  for (const [name, value] of entries) {
    const fieldId = nameToId.get(name);
    if (!fieldId) continue;
    await db.query(
      `INSERT INTO contact_field_values (contact_id, field_id, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (contact_id, field_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [contactId, fieldId, value ?? null]
    );
  }
}

async function getConversationLinkByPhone(
  db: DbExecutor,
  userId: string,
  phoneNumber: string,
  preferredConversationId?: string | null
): Promise<string | null> {
  if (preferredConversationId) {
    return preferredConversationId;
  }

  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM conversations
     WHERE user_id = $1
       AND phone_number = $2
     ORDER BY last_message_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [userId, phoneNumber]
  );

  return result.rows[0]?.id ?? null;
}

async function getContactByPhone(db: DbExecutor, userId: string, phoneNumber: string): Promise<Contact | null> {
  const result = await db.query<Contact>(
    `SELECT *
     FROM contacts
     WHERE user_id = $1
       AND phone_number = $2
     LIMIT 1`,
    [userId, phoneNumber]
  );
  return result.rows[0] ?? null;
}

async function getContactsByIds(db: DbExecutor, userId: string, ids: string[]): Promise<Contact[]> {
  if (ids.length === 0) {
    return [];
  }
  const result = await db.query<Contact>(
    `SELECT *
     FROM contacts
     WHERE user_id = $1
       AND id = ANY($2::uuid[])
     ORDER BY updated_at DESC, created_at DESC`,
    [userId, ids]
  );
  return result.rows;
}

async function insertContact(db: DbExecutor, input: {
  userId: string;
  displayName: string | null;
  phoneNumber: string;
  email: string | null;
  contactType: ConversationKind;
  tags: string[];
  sourceType: ContactSourceType;
  sourceId: string | null;
  sourceUrl: string | null;
  linkedConversationId: string | null;
}): Promise<Contact> {
  const result = await db.query<Contact>(
    `INSERT INTO contacts (
       user_id,
       display_name,
        phone_number,
        email,
        contact_type,
        tags,
        source_type,
        source_id,
        source_url,
        linked_conversation_id
      )
      VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10)
      RETURNING *`,
    [
      input.userId,
      input.displayName,
      input.phoneNumber,
      input.email,
      input.contactType,
      input.tags,
      input.sourceType,
      input.sourceId,
      input.sourceUrl,
      input.linkedConversationId
    ]
  );

  return result.rows[0];
}

async function updateContact(
  db: DbExecutor,
  contactId: string,
  input: {
    displayName: string | null;
    email: string | null;
    contactType: ConversationKind;
    tags: string[];
    sourceType: ContactSourceType;
    sourceId: string | null;
    sourceUrl: string | null;
    linkedConversationId: string | null;
  }
): Promise<Contact> {
  const result = await db.query<Contact>(
    `UPDATE contacts
     SET display_name = $1,
         email = $2,
         contact_type = $3,
         tags = $4::text[],
         source_type = $5,
         source_id = $6,
         source_url = $7,
         linked_conversation_id = $8,
         updated_at = NOW()
     WHERE id = $9
     RETURNING *`,
    [
      input.displayName,
      input.email,
      input.contactType,
      input.tags,
      input.sourceType,
      input.sourceId,
      input.sourceUrl,
      input.linkedConversationId,
      contactId
    ]
  );

  return result.rows[0];
}

async function syncConversationKindFromContact(
  db: DbExecutor,
  input: {
    userId: string;
    phoneNumber: string;
    contactType: ConversationKind;
    linkedConversationId?: string | null;
  }
): Promise<void> {
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  if (!phoneNumber) {
    return;
  }

  await db.query(
    `UPDATE conversations
     SET lead_kind = $1
     WHERE user_id = $2
       AND (phone_number = $3 OR ($4::uuid IS NOT NULL AND id = $4::uuid))
       AND lead_kind IS DISTINCT FROM $1`,
    [input.contactType, input.userId, phoneNumber, input.linkedConversationId ?? null]
  );
}

async function upsertContact(
  db: DbExecutor,
  input: ContactWriteInput,
  options?: { rejectOnDuplicate?: boolean; mergeTags?: boolean }
): Promise<{ contact: Contact; action: "created" | "updated" | "skipped" }> {
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  if (!phoneNumber) {
    throw new Error("A valid phone number is required.");
  }

  const existing = await getContactByPhone(db, input.userId, phoneNumber);
  if (existing && options?.rejectOnDuplicate) {
    const duplicate = new Error("A contact with this phone number already exists.");
    (duplicate as Error & { code?: string }).code = "CONTACT_DUPLICATE";
    throw duplicate;
  }

  const linkedConversationId = await getConversationLinkByPhone(
    db,
    input.userId,
    phoneNumber,
    input.linkedConversationId ?? null
  );
  const displayName = normalizeDisplayName(input.displayName);
  const email = input.email === undefined ? undefined : normalizeEmail(input.email);
  const requestedContactType = input.contactType;
  const contactType = requestedContactType ?? existing?.contact_type ?? "lead";
  const tags = input.tags === undefined ? undefined : normalizeTags(input.tags);
  const sourceType = input.sourceType ?? existing?.source_type ?? "manual";
  const sourceId = input.sourceId === undefined ? undefined : (input.sourceId?.trim() || null);
  const sourceUrl = input.sourceUrl === undefined ? undefined : (input.sourceUrl?.trim() || null);
  const shouldHonorExplicitContactType =
    Boolean(requestedContactType) && USER_MANAGED_SOURCES.has(sourceType);

  if (!existing) {
    const created = await insertContact(db, {
      userId: input.userId,
      displayName,
      phoneNumber,
      email: email ?? null,
      contactType,
      tags: tags ?? [],
      sourceType,
      sourceId: sourceId ?? null,
      sourceUrl: sourceUrl ?? null,
      linkedConversationId
    });
    await syncConversationKindFromContact(db, {
      userId: input.userId,
      phoneNumber,
      contactType: created.contact_type,
      linkedConversationId
    });
    return { contact: created, action: "created" };
  }

  const preserveSource = isSourcePreserved(existing.source_type);
  const nextDisplayName = displayName ?? existing.display_name;
  const nextEmail = email === undefined ? existing.email : email;
  const nextContactType =
    shouldHonorExplicitContactType
      ? (requestedContactType as ConversationKind)
      : getContactTypeWeight(contactType) >= getContactTypeWeight(existing.contact_type)
        ? contactType
        : existing.contact_type;
  const nextTags =
    tags === undefined
      ? existing.tags
      : options?.mergeTags
        ? mergeTags(existing.tags, tags)
        : tags;
  const nextSourceType = preserveSource ? existing.source_type : sourceType;
  const nextSourceId = preserveSource ? existing.source_id : sourceId === undefined ? existing.source_id : sourceId;
  const nextSourceUrl = preserveSource ? existing.source_url : sourceUrl === undefined ? existing.source_url : sourceUrl;
  const nextLinkedConversationId = linkedConversationId ?? existing.linked_conversation_id;

  const changed =
    nextDisplayName !== existing.display_name ||
    nextEmail !== existing.email ||
    nextContactType !== existing.contact_type ||
    !arraysEqual(nextTags, existing.tags) ||
    nextSourceType !== existing.source_type ||
    nextSourceId !== existing.source_id ||
    nextSourceUrl !== existing.source_url ||
    nextLinkedConversationId !== existing.linked_conversation_id;

  if (!changed) {
    await syncConversationKindFromContact(db, {
      userId: input.userId,
      phoneNumber,
      contactType: existing.contact_type,
      linkedConversationId: nextLinkedConversationId
    });
    return { contact: existing, action: "skipped" };
  }

  const updated = await updateContact(db, existing.id, {
    displayName: nextDisplayName,
    email: nextEmail,
    contactType: nextContactType,
    tags: nextTags,
    sourceType: nextSourceType,
    sourceId: nextSourceId,
    sourceUrl: nextSourceUrl,
    linkedConversationId: nextLinkedConversationId
  });

  await syncConversationKindFromContact(db, {
    userId: input.userId,
    phoneNumber,
    contactType: updated.contact_type,
    linkedConversationId: nextLinkedConversationId
  });

  return { contact: updated, action: "updated" };
}

export async function listContacts(userId: string, filters: ContactsListFilters = {}): Promise<Contact[]> {
  const where: string[] = ["c.user_id = $1"];
  const values: Array<string | number> = [userId];
  const query = filters.q?.trim() ?? "";
  const normalizedDigits = query.replace(/\D/g, "");

  if (query) {
    values.push(`%${query}%`);
    const textParam = `$${values.length}`;
    const conditions = [
      `COALESCE(c.display_name, '') ILIKE ${textParam}`,
      `COALESCE(c.email, '') ILIKE ${textParam}`,
      `COALESCE(c.source_id, '') ILIKE ${textParam}`,
      `COALESCE(c.source_url, '') ILIKE ${textParam}`,
      `COALESCE(array_to_string(c.tags, ', '), '') ILIKE ${textParam}`,
      `c.contact_type ILIKE ${textParam}`
    ];
    if (normalizedDigits) {
      values.push(`%${normalizedDigits}%`);
      conditions.push(`c.phone_number LIKE $${values.length}`);
    }
    where.push(`(${conditions.join(" OR ")})`);
  }

  if (filters.type) {
    values.push(filters.type);
    where.push(`c.contact_type = $${values.length}`);
  }
  if (filters.source) {
    values.push(filters.source);
    where.push(`c.source_type = $${values.length}`);
  }

  const limit = Math.max(1, Math.min(1000, filters.limit ?? 250));
  values.push(limit);

  const result = await pool.query<Contact>(
    `SELECT c.*
     FROM contacts c
     WHERE ${where.join(" AND ")}
     ORDER BY c.updated_at DESC, c.created_at DESC
     LIMIT $${values.length}`,
    values
  );

  const contacts = result.rows;
  const fieldValuesMap = await loadFieldValues(pool, contacts.map((c) => c.id));
  return contacts.map((c) => ({ ...c, custom_field_values: fieldValuesMap.get(c.id) ?? [] }));
}

export async function createManualContact(userId: string, input: CreateManualContactInput): Promise<ContactUpsertResult> {
  const displayName = normalizeDisplayName(input.displayName);
  if (!displayName) {
    throw new Error("Name is required.");
  }

  const result = await withTransaction(async (client) => {
    const upsertResult = await upsertContact(
      client,
      {
        userId,
        displayName,
        phoneNumber: input.phoneNumber,
        email: input.email ?? undefined,
        contactType: input.contactType ?? "lead",
        tags: input.tags ?? [],
        sourceType: "manual",
        sourceId: input.sourceId ?? undefined,
        sourceUrl: input.sourceUrl ?? undefined
      },
      { mergeTags: true }
    );
    if (input.customFields && Object.keys(input.customFields).length > 0) {
      await saveFieldValues(client, upsertResult.contact.id, input.customFields);
    }
    return upsertResult;
  });

  const fieldValuesMap = await loadFieldValues(pool, [result.contact.id]);
  const hydratedResult = {
    action: result.action,
    contact: { ...result.contact, custom_field_values: fieldValuesMap.get(result.contact.id) ?? [] }
  };
  await emitSequenceContactEvent(hydratedResult);
  return hydratedResult;
}

export async function upsertWebhookContact(input: {
  userId: string;
  displayName?: string | null;
  phoneNumber: string;
  email?: string | null;
  tags?: string[];
  customFields?: Record<string, string>;
  sourceId?: string | null;
  sourceUrl?: string | null;
}): Promise<Contact> {
  const result = await withTransaction(async (client) => {
    const upsertResult = await upsertContact(
      client,
      {
        userId: input.userId,
        displayName: input.displayName ?? undefined,
        phoneNumber: input.phoneNumber,
        email: input.email ?? undefined,
        tags: input.tags ?? [],
        sourceType: "api",
        sourceId: input.sourceId ?? undefined,
        sourceUrl: input.sourceUrl ?? undefined
      },
      { mergeTags: false }
    );

    if (input.customFields && Object.keys(input.customFields).length > 0) {
      await saveFieldValues(client, upsertResult.contact.id, input.customFields);
    }

    return upsertResult;
  });

  const fieldValuesMap = await loadFieldValues(pool, [result.contact.id]);
  const contact = { ...result.contact, custom_field_values: fieldValuesMap.get(result.contact.id) ?? [] };
  await emitSequenceContactEvent({ action: result.action, contact });
  return contact;
}

export async function syncConversationContact(input: {
  userId: string;
  phoneNumber: string;
  displayName?: string | null;
  email?: string | null;
  contactType?: ConversationKind;
  sourceType: Extract<ContactSourceType, "web" | "qr" | "api">;
  linkedConversationId: string;
}): Promise<Contact> {
  const result = await withTransaction(async (client) =>
    upsertContact(client, {
      userId: input.userId,
      displayName: input.displayName ?? undefined,
      phoneNumber: input.phoneNumber,
      email: input.email ?? undefined,
      contactType: input.contactType ?? "lead",
      sourceType: input.sourceType,
      linkedConversationId: input.linkedConversationId
    })
  );

  await emitSequenceContactEvent(result);
  return result.contact;
}

export async function updateContactFieldValueFromFlow(input: {
  userId: string;
  fieldKey: string;
  value: string;
  operation: FlowContactUpdateOperation;
  conversationId?: string | null;
  contactId?: string | null;
}): Promise<Contact | null> {
  const fieldKey = input.fieldKey.trim();
  if (!fieldKey) {
    return null;
  }

  const result = await withTransaction(async (client) => {
    let contact: Contact | null = null;

    if (input.contactId) {
      const byIdResult = await client.query<Contact>(
        `SELECT *
         FROM contacts
         WHERE user_id = $1 AND id = $2
         LIMIT 1`,
        [input.userId, input.contactId]
      );
      contact = byIdResult.rows[0] ?? null;
    }

    if (!contact && input.conversationId) {
      contact = await getContactByConversationId(input.userId, input.conversationId);
    }

    if (!contact && input.conversationId) {
      const conversationResult = await client.query<{
        id: string;
        phone_number: string;
        channel_type: ContactSourceType | null;
      }>(
        `SELECT id, phone_number, channel_type
         FROM conversations
         WHERE user_id = $1 AND id = $2
         LIMIT 1`,
        [input.userId, input.conversationId]
      );

      const conversation = conversationResult.rows[0] ?? null;
      if (conversation?.phone_number) {
        const upserted = await upsertContact(client, {
          userId: input.userId,
          phoneNumber: conversation.phone_number,
          sourceType: conversation.channel_type ?? "api",
          linkedConversationId: conversation.id
        });
        contact = upserted.contact;
      }
    }

    if (!contact) {
      return null;
    }

    const op = input.operation;
    const rawValue = String(input.value ?? "").trim();

    if (fieldKey === "tags") {
      const nextTags =
        op === "add_if_empty"
          ? contact.tags.length > 0
            ? contact.tags
            : parseTagCell(rawValue)
          : op === "append"
            ? mergeTags(contact.tags, parseTagCell(rawValue))
            : parseTagCell(rawValue);

      contact = await updateContact(client, contact.id, {
        displayName: contact.display_name,
        email: contact.email,
        contactType: contact.contact_type,
        tags: nextTags,
        sourceType: contact.source_type,
        sourceId: contact.source_id,
        sourceUrl: contact.source_url,
        linkedConversationId: contact.linked_conversation_id
      });
    } else if (fieldKey === "name") {
      contact = await updateContact(client, contact.id, {
        displayName: normalizeDisplayName(applyTextOperation(contact.display_name, rawValue, op)),
        email: contact.email,
        contactType: contact.contact_type,
        tags: contact.tags,
        sourceType: contact.source_type,
        sourceId: contact.source_id,
        sourceUrl: contact.source_url,
        linkedConversationId: contact.linked_conversation_id
      });
    } else if (fieldKey === "email") {
      const nextEmailValue = applyTextOperation(contact.email, rawValue, op);
      contact = await updateContact(client, contact.id, {
        displayName: contact.display_name,
        email: nextEmailValue ? normalizeEmail(nextEmailValue) ?? contact.email : null,
        contactType: contact.contact_type,
        tags: contact.tags,
        sourceType: contact.source_type,
        sourceId: contact.source_id,
        sourceUrl: contact.source_url,
        linkedConversationId: contact.linked_conversation_id
      });
    } else if (fieldKey === "phone") {
      const nextPhoneValue = applyTextOperation(contact.phone_number, rawValue, op);
      const normalizedPhone = normalizePhoneNumber(nextPhoneValue);
      if (normalizedPhone) {
        await client.query(
          `UPDATE contacts
           SET phone_number = $1,
               linked_conversation_id = COALESCE($2, linked_conversation_id),
               updated_at = NOW()
           WHERE id = $3`,
          [normalizedPhone, contact.linked_conversation_id, contact.id]
        );
        contact = await getContactByPhone(client, input.userId, normalizedPhone);
      }
    } else if (fieldKey === "type") {
      const nextTypeValue = applyTextOperation(contact.contact_type, rawValue, op);
      const normalizedType = normalizeContactType(nextTypeValue) ?? contact.contact_type;
      contact = await updateContact(client, contact.id, {
        displayName: contact.display_name,
        email: contact.email,
        contactType: normalizedType,
        tags: contact.tags,
        sourceType: contact.source_type,
        sourceId: contact.source_id,
        sourceUrl: contact.source_url,
        linkedConversationId: contact.linked_conversation_id
      });
    } else if (fieldKey === "source") {
      const nextSourceValue = applyTextOperation(contact.source_type, rawValue, op);
      const normalizedSource = normalizeSourceType(nextSourceValue) ?? contact.source_type;
      contact = await updateContact(client, contact.id, {
        displayName: contact.display_name,
        email: contact.email,
        contactType: contact.contact_type,
        tags: contact.tags,
        sourceType: normalizedSource,
        sourceId: contact.source_id,
        sourceUrl: contact.source_url,
        linkedConversationId: contact.linked_conversation_id
      });
    } else if (fieldKey === "source_id") {
      contact = await updateContact(client, contact.id, {
        displayName: contact.display_name,
        email: contact.email,
        contactType: contact.contact_type,
        tags: contact.tags,
        sourceType: contact.source_type,
        sourceId: applyTextOperation(contact.source_id, rawValue, op),
        sourceUrl: contact.source_url,
        linkedConversationId: contact.linked_conversation_id
      });
    } else if (fieldKey === "source_url") {
      contact = await updateContact(client, contact.id, {
        displayName: contact.display_name,
        email: contact.email,
        contactType: contact.contact_type,
        tags: contact.tags,
        sourceType: contact.source_type,
        sourceId: contact.source_id,
        sourceUrl: applyTextOperation(contact.source_url, rawValue, op),
        linkedConversationId: contact.linked_conversation_id
      });
    } else if (fieldKey.startsWith("custom.")) {
      const fieldName = fieldKey.slice("custom.".length).trim();
      if (fieldName) {
        const customFieldResult = await client.query<{
          id: string;
          field_type: string;
          value: string | null;
        }>(
          `SELECT cf.id, cf.field_type, cfv.value
           FROM contact_fields cf
           LEFT JOIN contact_field_values cfv
             ON cfv.field_id = cf.id
            AND cfv.contact_id = $2
           WHERE cf.user_id = $1
             AND cf.name = $3
           LIMIT 1`,
          [input.userId, contact.id, fieldName]
        );

        const customField = customFieldResult.rows[0] ?? null;
        if (customField) {
          const nextValue =
            op === "append" && customField.field_type === "MULTI_TEXT"
              ? mergeTags(parseTagCell(customField.value), parseTagCell(rawValue)).join(", ")
              : applyTextOperation(customField.value, rawValue, op);

          await client.query(
            `INSERT INTO contact_field_values (contact_id, field_id, value)
             VALUES ($1, $2, $3)
             ON CONFLICT (contact_id, field_id)
             DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [contact.id, customField.id, nextValue]
          );
        }
      }
    }

    if (!contact) {
      return null;
    }

    const fieldValuesMap = await loadFieldValues(client, [contact.id]);
    return {
      ...contact,
      custom_field_values: fieldValuesMap.get(contact.id) ?? []
    };
  });

  if (result) {
    await emitSequenceContactEvent({ action: "updated", contact: result });
  }

  return result;
}

export async function reconcileContactPhone(
  userId: string,
  previousPhoneNumber: string,
  canonicalPhoneNumber: string,
  linkedConversationId?: string | null
): Promise<void> {
  const previous = normalizePhoneNumber(previousPhoneNumber);
  const canonical = normalizePhoneNumber(canonicalPhoneNumber);
  if (!previous || !canonical || previous === canonical) {
    return;
  }

  await withTransaction(async (client) => {
    const source = await getContactByPhone(client, userId, previous);
    if (!source) {
      return;
    }

    const target = await getContactByPhone(client, userId, canonical);
    const resolvedConversationId = await getConversationLinkByPhone(client, userId, canonical, linkedConversationId ?? null);

    if (!target) {
      await client.query(
        `UPDATE contacts
         SET phone_number = $1,
             linked_conversation_id = COALESCE($2, linked_conversation_id),
             updated_at = NOW()
         WHERE id = $3`,
        [canonical, resolvedConversationId, source.id]
      );
      await syncConversationKindFromContact(client, {
        userId,
        phoneNumber: canonical,
        contactType: source.contact_type,
        linkedConversationId: resolvedConversationId
      });
      return;
    }

    const nextDisplayName = target.display_name ?? source.display_name;
    const nextEmail = target.email ?? source.email;
    const nextContactType =
      getContactTypeWeight(target.contact_type) >= getContactTypeWeight(source.contact_type)
        ? target.contact_type
        : source.contact_type;
    const nextTags = mergeTags(target.tags, source.tags);
    const nextSourceType = isSourcePreserved(target.source_type)
      ? target.source_type
      : isSourcePreserved(source.source_type)
        ? source.source_type
        : target.source_type;
    const nextSourceId =
      nextSourceType === target.source_type ? target.source_id ?? source.source_id : source.source_id ?? target.source_id;
    const nextSourceUrl =
      nextSourceType === target.source_type ? target.source_url ?? source.source_url : source.source_url ?? target.source_url;
    const nextLinkedConversationId = resolvedConversationId ?? target.linked_conversation_id ?? source.linked_conversation_id;

    await updateContact(client, target.id, {
      displayName: nextDisplayName,
      email: nextEmail,
      contactType: nextContactType,
      tags: nextTags,
      sourceType: nextSourceType,
      sourceId: nextSourceId,
      sourceUrl: nextSourceUrl,
      linkedConversationId: nextLinkedConversationId
    });
    await syncConversationKindFromContact(client, {
      userId,
      phoneNumber: canonical,
      contactType: nextContactType,
      linkedConversationId: nextLinkedConversationId
    });

    await client.query(`DELETE FROM contacts WHERE id = $1`, [source.id]);
  });
}

export async function importContactsWorkbook(
  userId: string,
  fileBuffer: Buffer,
  options?: ContactImportWorkbookOptions
): Promise<ContactImportResult> {
  const { columns, rows } = readContactsWorkbookSheet(fileBuffer);
  const defaultMapping = buildSuggestedContactImportMapping(columns);
  const mapping = {
    ...defaultMapping,
    ...(options?.columnMapping ?? {})
  };

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: ContactImportError[] = [];

  const extraTags = normalizeTags([
    ...(options?.extraTags ?? []),
    ...(options?.marketingOptIn ? ["marketing-opt-in"] : [])
  ]);

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const name = String(getMappedWorkbookValue(row, mapping, "display_name") ?? "");
    const phone = String(getMappedWorkbookValue(row, mapping, "phone_number") ?? "");
    const email = String(getMappedWorkbookValue(row, mapping, "email") ?? "");
    const typeCell = String(getMappedWorkbookValue(row, mapping, "contact_type") ?? "");
    const tagsCell = getMappedWorkbookValue(row, mapping, "tags");
    const sourceCell = String(getMappedWorkbookValue(row, mapping, "source_type") ?? "");
    const sourceId = String(getMappedWorkbookValue(row, mapping, "source_id") ?? "");
    const sourceUrl = String(getMappedWorkbookValue(row, mapping, "source_url") ?? "");
    const customFieldValues = Object.fromEntries(
      Object.entries(mapping)
        .filter(([fieldKey, columnName]) => fieldKey.startsWith("custom:") && columnName)
        .map(([fieldKey, columnName]) => [fieldKey.slice("custom:".length), String(row[columnName] ?? "").trim()])
        .filter(([, value]) => value)
    );

    if (![name, phone, email, typeCell, String(tagsCell ?? ""), sourceCell, sourceId, sourceUrl].some((value) => value.trim())) {
      skipped += 1;
      continue;
    }

    const phoneNumber = normalizeImportedPhoneNumber(phone, {
      phoneNumberFormat: options?.phoneNumberFormat,
      defaultCountryCode: options?.defaultCountryCode
    });
    if (!phoneNumber) {
      errors.push({ row: rowNumber, message: "Phone is required and must contain 8-15 digits." });
      continue;
    }

    const contactType = typeCell ? normalizeContactType(typeCell) : undefined;
    if (typeCell && !contactType) {
      errors.push({ row: rowNumber, message: "Type must be Lead, Feedback, Complaint, or Other." });
      continue;
    }

    const sourceType = sourceCell ? normalizeSourceType(sourceCell) : "import";
    if (sourceCell && !sourceType) {
      errors.push({ row: rowNumber, message: "Contact Created Source must be Manual, Import, Web, QR, or API." });
      continue;
    }

    if (email && !normalizeEmail(email)) {
      errors.push({ row: rowNumber, message: "Email is invalid." });
      continue;
    }

    const parsedTags = String(tagsCell ?? "").trim() ? parseTagCell(tagsCell) : [];
    const result = await withTransaction(async (client) => {
      const upserted = await upsertContact(client, {
        userId,
        displayName: name || undefined,
        phoneNumber,
        email: email || undefined,
        contactType: contactType ?? undefined,
        tags: parsedTags.length > 0 || extraTags.length > 0 ? [...parsedTags, ...extraTags] : undefined,
        sourceType: sourceType ?? "import",
        sourceId: sourceId || undefined,
        sourceUrl: sourceUrl || undefined
      }, { mergeTags: true });

      if (Object.keys(customFieldValues).length > 0) {
        await saveFieldValues(client, upserted.contact.id, customFieldValues);
      }

      return upserted;
    });

    if (result.action === "created") {
      created += 1;
    } else if (result.action === "updated") {
      updated += 1;
    } else {
      skipped += 1;
    }

    await emitSequenceContactEvent({
      action: result.action,
      contact: result.contact
    });
  }

  return { created, updated, skipped, errors };
}

function buildWorkbook(headers: readonly string[], rows: Array<Record<string, string>>): Buffer {
  const worksheet =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows, { header: [...headers] })
      : XLSX.utils.aoa_to_sheet([Array.from(headers)]);
  worksheet["!cols"] = headers.map((header) => ({
    wch: Math.max(header.length + 2, 18)
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Contacts");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

export function generateContactsTemplateWorkbook(): { filename: string; content: Buffer } {
  const content = buildWorkbook(CONTACT_TEMPLATE_HEADERS, []);
  return {
    filename: "contacts-template.xlsx",
    content
  };
}

export async function generateContactsExportWorkbook(input: {
  userId: string;
  ids?: string[];
  filters?: ContactsListFilters;
}): Promise<{ filename: string; content: Buffer }> {
  const rows =
    input.ids && input.ids.length > 0
      ? await getContactsByIds(pool, input.userId, input.ids)
      : await listContacts(input.userId, { ...(input.filters ?? {}), limit: 1000 });

  const exportRows = rows.map((contact) => ({
    Name: contact.display_name || "",
    Phone: contact.phone_number ? `+${contact.phone_number}` : "",
    Email: contact.email || "",
    Type: contact.contact_type,
    Tags: contact.tags.join(", "),
    "Contact Created Source": contact.source_type,
    "Source ID": contact.source_id || "",
    "Source URL": contact.source_url || "",
    "Created Date": formatWorkbookDate(contact.created_at),
    "Last Updated": formatWorkbookDate(contact.updated_at)
  }));

  const content = buildWorkbook(
    [
      ...CONTACT_TEMPLATE_HEADERS,
      "Created Date",
      "Last Updated"
    ],
    exportRows
  );
  const stamp = new Date().toISOString().slice(0, 10);

  return {
    filename: `contacts-export-${stamp}.xlsx`,
    content
  };
}

export async function getContactByConversationId(userId: string, conversationId: string): Promise<Contact | null> {
  const result = await pool.query<Contact>(
    `SELECT c.*
     FROM contacts c
     WHERE c.user_id = $1 AND c.linked_conversation_id = $2
     LIMIT 1`,
    [userId, conversationId]
  );
  if (!result.rows[0]) {
    // Fallback: find by phone number of the conversation
    const conv = await pool.query<{ phone_number: string }>(
      `SELECT phone_number FROM conversations WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [conversationId, userId]
    );
    if (!conv.rows[0]) return null;
    const byPhone = await pool.query<Contact>(
      `SELECT c.* FROM contacts c WHERE c.user_id = $1 AND c.phone_number = $2 LIMIT 1`,
      [userId, conv.rows[0].phone_number]
    );
    if (!byPhone.rows[0]) return null;
    const fieldMap = await loadFieldValues(pool, [byPhone.rows[0].id]);
    return { ...byPhone.rows[0], custom_field_values: fieldMap.get(byPhone.rows[0].id) ?? [] };
  }
  const contact = result.rows[0];
  const fieldMap = await loadFieldValues(pool, [contact.id]);
  return { ...contact, custom_field_values: fieldMap.get(contact.id) ?? [] };
}

export function extractCapturedProfileDetails(message: string): { displayName: string | null; phoneNumber: string | null; email: string | null } {
  const displayName = message.match(/Name=([^,]+)/)?.[1]?.trim() ?? null;
  const phoneNumber = normalizePhoneNumber(message.match(/Phone=([0-9]{8,15})/)?.[1] ?? null);
  const email = normalizeEmail(message.match(/Email=([^,\s]+)/)?.[1] ?? null);
  return {
    displayName: normalizeDisplayName(displayName),
    phoneNumber,
    email
  };
}

export function getContactTemplateHeaders(): readonly string[] {
  return CONTACT_TEMPLATE_HEADERS;
}
