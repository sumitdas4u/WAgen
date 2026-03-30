import {
  createContact,
  downloadContactsTemplate,
  exportContactsWorkbook,
  fetchContacts,
  importContactsWorkbook,
  type ContactImportResult,
  type ContactRecord,
  type ContactSourceType,
  type ContactType
} from "../../../lib/api";

export interface ContactsFilters {
  q?: string;
  type?: ContactType;
  source?: ContactSourceType;
  limit?: number;
}

export function fetchContactsList(token: string, filters: ContactsFilters): Promise<ContactRecord[]> {
  return fetchContacts(token, filters).then((response) => response.contacts);
}

export function createManualContact(
  token: string,
  payload: {
    name: string;
    phone: string;
    email?: string;
    type?: ContactType;
    tags?: string[];
    orderDate?: string;
    sourceId?: string;
    sourceUrl?: string;
  }
): Promise<ContactRecord> {
  return createContact(token, payload).then((response) => response.contact);
}

export function uploadContactsWorkbook(token: string, file: File): Promise<ContactImportResult> {
  return importContactsWorkbook(token, file);
}

export { downloadContactsTemplate, exportContactsWorkbook };
export type { ContactImportResult, ContactRecord, ContactSourceType, ContactType };
