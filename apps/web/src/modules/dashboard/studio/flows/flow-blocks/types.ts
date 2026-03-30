import type { ComponentType } from "react";
import type { Edge, Node, NodeProps } from "reactflow";

export type FlowChannel = "web" | "qr" | "api";

export type TriggerType =
  | "keyword"
  | "any_message"
  | "template_reply"
  | "qr_start"
  | "website_start";

export interface Trigger {
  id: string;
  type: TriggerType;
  value: string;
}

export interface Btn {
  id: string;
  label: string;
}

export interface FlowKeyValueItem {
  id: string;
  key: string;
  value: string;
}

export interface ListRow {
  id: string;
  title: string;
  description: string;
}

export interface ListSection {
  id: string;
  title: string;
  rows: ListRow[];
}

export interface FlowStartData {
  kind: "flowStart";
  label: string;
  triggers: Trigger[];
  welcomeMessage: string;
  fallbackUseAi?: boolean;
}

export interface SendTextData {
  kind: "sendText";
  text: string;
}

export interface SendMediaData {
  kind: "sendMedia";
  mediaType: "image" | "video" | "document" | "audio";
  url: string;
  caption: string;
}

export interface SendLocationData {
  kind: "sendLocation";
  latitude: string;
  longitude: string;
  name: string;
  address: string;
}

export interface SendContactData {
  kind: "sendContact";
  name: string;
  phone: string;
  org: string;
}

export interface SendPollData {
  kind: "sendPoll";
  question: string;
  options: string[];
  allowMultiple: boolean;
}

export interface SendTextMenuData {
  kind: "sendTextMenu";
  message: string;
  options: Btn[];
}

export interface SendImageMenuData {
  kind: "sendImageMenu";
  url: string;
  intro: string;
  options: Btn[];
}

export interface TextButtonsData {
  kind: "textButtons";
  message: string;
  footer: string;
  buttons: Btn[];
}

export interface MediaButtonsData {
  kind: "mediaButtons";
  mediaType: "image" | "video" | "document";
  url: string;
  caption: string;
  buttons: Btn[];
}

export interface ListData {
  kind: "list";
  message: string;
  buttonLabel: string;
  sections: ListSection[];
}

export interface SingleProductData {
  kind: "singleProduct";
  catalogId: string;
  productId: string;
  bodyText: string;
}

export interface MultiProductData {
  kind: "multiProduct";
  catalogId: string;
  bodyText: string;
  sections: Array<{ title: string; productIds: string[] }>;
}

export interface TemplateData {
  kind: "template";
  templateName: string;
  language: string;
}

export interface RequestInterventionData {
  kind: "requestIntervention";
  message: string;
  teamId: string;
  timeout: number;
}

export interface ApiResponseMapping {
  id: string;
  variableName: string;
  path: string;
}

export interface ApiRequestData {
  kind: "apiRequest";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers: FlowKeyValueItem[];
  bodyMode: "none" | "json" | "text";
  body: string;
  timeoutMs: string;
  saveResponseAs: string;
  responsePath: string;
  responseMappings: ApiResponseMapping[];
}

export interface GoogleSheetsBaseData {
  connectionId: string;
  spreadsheetId: string;
  spreadsheetName: string;
  sheetTitle: string;
  saveAs: string;
}

export type GoogleSheetsOperation = "addRow" | "updateRow" | "fetchRow" | "fetchRows";

export interface GoogleSheetsData extends GoogleSheetsBaseData {
  kind: "googleSheets";
  operation: GoogleSheetsOperation;
  referenceColumn: string;
  referenceValue: string;
  rowValues: FlowKeyValueItem[];
  fetchMappings: FlowKeyValueItem[];
}

export interface GoogleSheetsAddRowData extends GoogleSheetsBaseData {
  kind: "googleSheetsAddRow";
  rowValues: FlowKeyValueItem[];
}

export interface GoogleSheetsUpdateRowData extends GoogleSheetsBaseData {
  kind: "googleSheetsUpdateRow";
  referenceColumn: string;
  referenceValue: string;
  rowValues: FlowKeyValueItem[];
}

export interface GoogleSheetsFetchRowData extends GoogleSheetsBaseData {
  kind: "googleSheetsFetchRow";
  referenceColumn: string;
  referenceValue: string;
}

export interface GoogleSheetsFetchRowsData extends GoogleSheetsBaseData {
  kind: "googleSheetsFetchRows";
  referenceColumn: string;
  referenceValue: string;
}

export interface GoogleCalendarBookingData {
  kind: "googleCalendarBooking";
  connectionId: string;
  calendarId: string;
  calendarSummary: string;
  bookingMode: "suggest_slots" | "check_only" | "book_if_available";
  timeInputMode: "prefilled" | "ask_user";
  timeZone: string;
  windowStart: string;
  windowEnd: string;
  alternateWindowStart: string;
  alternateWindowEnd: string;
  requestedStart: string;
  requestedEnd: string;
  timeRequestPrompt: string;
  invalidTimeRequestMessage: string;
  promptSearchWindowHours: string;
  slotDurationMinutes: string;
  slotIntervalMinutes: string;
  maxOptions: string;
  promptMessage: string;
  availabilityMessage: string;
  unavailableMessage: string;
  reviewMessage: string;
  noAvailabilityMessage: string;
  requireName: boolean;
  requireEmail: boolean;
  requirePhone: boolean;
  namePrompt: string;
  emailPrompt: string;
  phonePrompt: string;
  invalidEmailMessage: string;
  invalidPhoneMessage: string;
  cancellationMessage: string;
  bookingTitle: string;
  bookingDescription: string;
  confirmationMessage: string;
  attendeeEmail: string;
  attendeeName: string;
  location: string;
  sendUpdates: "all" | "externalOnly" | "none";
  saveAs: string;
}

export interface ConditionData {
  kind: "condition";
  variable: string;
  operator: string;
  value: string;
}

export interface AskLocationData {
  kind: "askLocation";
  promptMessage: string;
  variableName: string;
}

export interface AskQuestionData {
  kind: "askQuestion";
  question: string;
  variableName: string;
  inputType: "text" | "number" | "email" | "phone";
}

export interface WhatsappPayData {
  kind: "whatsappPay";
  amount: string;
  description: string;
  currency: string;
}

export interface AiReplyData {
  kind: "aiReply";
  mode: "one_shot" | "ongoing";
  contextNote: string;
}

export interface AiAgentMapping {
  id: string;
  variableName: string;
  path: string;
}

export interface AiAgentData {
  kind: "aiAgent";
  instructions: string;
  inputTemplate: string;
  outputMode: "text" | "json";
  saveAs: string;
  responseMappings: AiAgentMapping[];
}

export type AnyNodeData =
  | AiAgentData
  | AiReplyData
  | FlowStartData
  | SendTextData
  | SendMediaData
  | SendLocationData
  | SendContactData
  | SendPollData
  | SendTextMenuData
  | SendImageMenuData
  | TextButtonsData
  | MediaButtonsData
  | ListData
  | SingleProductData
  | MultiProductData
  | TemplateData
  | RequestInterventionData
  | ApiRequestData
  | GoogleCalendarBookingData
  | GoogleSheetsData
  | GoogleSheetsAddRowData
  | GoogleSheetsUpdateRowData
  | GoogleSheetsFetchRowData
  | GoogleSheetsFetchRowsData
  | ConditionData
  | AskLocationData
  | AskQuestionData
  | WhatsappPayData;

export type FlowBlockKind = AnyNodeData["kind"];
export type FlowNode = Node<AnyNodeData>;
export type FlowEdge = Edge;

export interface FlowDoc {
  id: string;
  name: string;
  channel: FlowChannel;
  published: boolean;
  createdAt: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  triggers: Trigger[];
}

export type StudioFlowBlockSection =
  | "Triggers"
  | "Messages"
  | "Collect"
  | "Logic"
  | "Actions"
  | "Commerce";

export interface StudioFlowBlockCatalogItem {
  kind: FlowBlockKind;
  icon: string;
  name: string;
  desc: string;
  section: StudioFlowBlockSection;
  availableInPalette?: boolean;
  status?: "active" | "legacy";
}

export interface StudioFlowBlockDefinition<TData extends AnyNodeData = AnyNodeData> {
  kind: TData["kind"];
  /** Which channels this block is available in. If omitted, available in all channels. */
  channels?: FlowChannel[];
  catalog: StudioFlowBlockCatalogItem;
  createDefaultData(): TData;
  NodeComponent: ComponentType<NodeProps<any>>;
}
