import type { Pool, PoolClient } from "pg";
import * as XLSX from "xlsx";
import { pool, withTransaction } from "../db/pool.js";
import type { Contact, ContactSourceType, Conversation, ConversationKind } from "../types/models.js";

const CONTACT_TYPE_VALUES = new Set<ConversationKind>(["lead", "feedback", "complaint", "other"]);
const CONTACT_SOURCE_VALUES = new Set<ContactSourceType>(["manual", "import", "web", "qr", "api"]);
const USER_MANAGED_SOURCES = new Set<ContactSourceType>(["manual", "import"]);
const CONTACT_TEMPLATE_HEADERS = [
  "Name",
  "Phone",
  "Email",
  "Type",
  "Tags",
  "Order Date",
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
  orderDate?: string | null;
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
  orderDate?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
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

function normalizePhoneNumber(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  return digits;
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

function parseOrderDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S));
      if (Number.isFinite(date.getTime())) {
        return date.toISOString();
      }
    }
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const timestamp = Date.parse(trimmed);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  return null;
}

function isSourcePreserved(existingSource: ContactSourceType | null | undefined): boolean {
  return existingSource ? USER_MANAGED_SOURCES.has(existingSource) : false;
}

function mergeTags(left: string[], right: string[]): string[] {
  return normalizeTags([...left, ...right]);
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
  orderDate: string | null;
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
       order_date,
       source_type,
       source_id,
       source_url,
       linked_conversation_id
     )
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7::timestamptz, $8, $9, $10, $11)
     RETURNING *`,
    [
      input.userId,
      input.displayName,
      input.phoneNumber,
      input.email,
      input.contactType,
      input.tags,
      input.orderDate,
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
    orderDate: string | null;
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
         order_date = $5::timestamptz,
         source_type = $6,
         source_id = $7,
         source_url = $8,
         linked_conversation_id = $9,
         updated_at = NOW()
     WHERE id = $10
     RETURNING *`,
    [
      input.displayName,
      input.email,
      input.contactType,
      input.tags,
      input.orderDate,
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
  options?: { rejectOnDuplicate?: boolean }
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
  const orderDate = input.orderDate === undefined ? undefined : parseOrderDate(input.orderDate);
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
      orderDate: orderDate ?? null,
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
  const nextTags = tags === undefined ? existing.tags : tags;
  const nextOrderDate = orderDate === undefined ? existing.order_date : orderDate;
  const nextSourceType = preserveSource ? existing.source_type : sourceType;
  const nextSourceId = preserveSource ? existing.source_id : sourceId === undefined ? existing.source_id : sourceId;
  const nextSourceUrl = preserveSource ? existing.source_url : sourceUrl === undefined ? existing.source_url : sourceUrl;
  const nextLinkedConversationId = linkedConversationId ?? existing.linked_conversation_id;

  const changed =
    nextDisplayName !== existing.display_name ||
    nextEmail !== existing.email ||
    nextContactType !== existing.contact_type ||
    !arraysEqual(nextTags, existing.tags) ||
    nextOrderDate !== existing.order_date ||
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
    orderDate: nextOrderDate,
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

  return result.rows;
}

export async function createManualContact(userId: string, input: CreateManualContactInput): Promise<Contact> {
  const displayName = normalizeDisplayName(input.displayName);
  if (!displayName) {
    throw new Error("Name is required.");
  }

  const result = await withTransaction(async (client) => {
    return upsertContact(
      client,
      {
        userId,
        displayName,
        phoneNumber: input.phoneNumber,
        email: input.email ?? undefined,
        contactType: input.contactType ?? "lead",
        tags: input.tags ?? [],
        orderDate: input.orderDate ?? undefined,
        sourceType: "manual",
        sourceId: input.sourceId ?? undefined,
        sourceUrl: input.sourceUrl ?? undefined
      },
      { rejectOnDuplicate: true }
    );
  });

  return result.contact;
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

  return result.contact;
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
    const nextOrderDate = target.order_date ?? source.order_date;
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
      orderDate: nextOrderDate,
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

export async function importContactsWorkbook(userId: string, fileBuffer: Buffer): Promise<ContactImportResult> {
  const workbook = XLSX.read(fileBuffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.Sheets.Contacts ? "Contacts" : workbook.SheetNames[0];
  const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!worksheet) {
    throw new Error("Workbook does not contain a Contacts sheet.");
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: ""
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: ContactImportError[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const name = String(row.Name ?? "");
    const phone = String(row.Phone ?? "");
    const email = String(row.Email ?? "");
    const typeCell = String(row.Type ?? "");
    const tagsCell = row.Tags;
    const orderDateCell = row["Order Date"];
    const sourceCell = String(row["Contact Created Source"] ?? "");
    const sourceId = String(row["Source ID"] ?? "");
    const sourceUrl = String(row["Source URL"] ?? "");

    if (![name, phone, email, typeCell, String(tagsCell ?? ""), String(orderDateCell ?? ""), sourceCell, sourceId, sourceUrl].some((value) => value.trim())) {
      skipped += 1;
      continue;
    }

    const phoneNumber = normalizePhoneNumber(phone);
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

    if (orderDateCell && !parseOrderDate(orderDateCell)) {
      errors.push({ row: rowNumber, message: "Order Date is invalid." });
      continue;
    }

    const result = await withTransaction(async (client) =>
      upsertContact(client, {
        userId,
        displayName: name || undefined,
        phoneNumber,
        email: email || undefined,
        contactType: contactType ?? undefined,
        tags: String(tagsCell ?? "").trim() ? parseTagCell(tagsCell) : undefined,
        orderDate: orderDateCell ? parseOrderDate(orderDateCell) : undefined,
        sourceType: sourceType ?? "import",
        sourceId: sourceId || undefined,
        sourceUrl: sourceUrl || undefined
      })
    );

    if (result.action === "created") {
      created += 1;
    } else if (result.action === "updated") {
      updated += 1;
    } else {
      skipped += 1;
    }
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
    "Order Date": formatWorkbookDate(contact.order_date),
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
