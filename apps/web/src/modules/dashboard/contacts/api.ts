import {
  createContact,
  downloadContactsTemplate,
  exportContactsWorkbook,
  fetchContacts,
  importContactsWorkbook,
  previewContactsImportWorkbook,
  type ContactImportColumnMapping,
  type ContactImportPreview,
  type ContactImportResult,
  type ContactRecord,
  type ContactSourceType,
  type ContactType
} from "../../../lib/api";

export type MarketingConsentFilter = "subscribed" | "unsubscribed" | "unknown" | "revoked";

export interface ContactsFilters {
  q?: string;
  type?: ContactType;
  source?: ContactSourceType;
  tag?: string;
  consent?: MarketingConsentFilter;
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
    sourceId?: string;
    sourceUrl?: string;
    customFields?: Record<string, string>;
  }
): Promise<ContactRecord> {
  return createContact(token, payload).then((response) => response.contact);
}

export function previewContactsWorkbookUpload(token: string, file: File): Promise<ContactImportPreview> {
  return previewContactsImportWorkbook(token, file).then((response) => response.preview);
}

export function uploadContactsWorkbook(
  token: string,
  file: File,
  options?: { mapping?: ContactImportColumnMapping }
): Promise<ContactImportResult> {
  return importContactsWorkbook(token, file, options);
}

export { downloadContactsTemplate, exportContactsWorkbook };
export type {
  ContactImportColumnMapping,
  ContactImportPreview,
  ContactImportResult,
  ContactRecord,
  ContactSourceType,
  ContactType
};
