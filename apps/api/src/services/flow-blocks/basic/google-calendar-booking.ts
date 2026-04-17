import {
  createGoogleCalendarEvent,
  queryGoogleCalendarFreeBusy,
  type GoogleCalendarBusyInterval,
  type GoogleCalendarEventResult
} from "../../google-calendar-service.js";
import { aiService } from "../../ai-service.js";
import { chargeUser } from "../../ai-token-service.js";
import {
  buildChoicePrompt,
  getNextNodeId,
  interpolate,
  joinTextParts,
  matchChoiceByMessage
} from "../helpers.js";
import type { FlowBlockModule, FlowVariables } from "../types.js";

interface CalendarBookingSlot {
  id: string;
  label: string;
  start: string;
  end: string;
  title: string;
  description: string;
}

type CalendarBookingMode = "suggest_slots" | "check_only" | "book_if_available";
type TimeInputMode = "prefilled" | "ask_user";
type SchedulingRequestKind = "none" | "requested_slot" | "search_window";
type WizardStage =
  | "collect_schedule_request"
  | "slot_selection"
  | "collect_name"
  | "collect_email"
  | "collect_phone"
  | "review";
type DetailField = "name" | "email" | "phone";

interface WizardDetails {
  name: string;
  email: string;
  phone: string;
}

interface WizardRequiredFields {
  name: boolean;
  email: boolean;
  phone: boolean;
}

interface CalendarWizardState {
  stage: WizardStage;
  mode: CalendarBookingMode;
  requestKind: SchedulingRequestKind;
  requestSummary: string;
  searchWindowStart: string;
  searchWindowEnd: string;
  requestedSlot: CalendarBookingSlot | null;
  requestedAvailable: boolean;
  selectedSlot: CalendarBookingSlot | null;
  slots: CalendarBookingSlot[];
  details: WizardDetails;
  requiredFields: WizardRequiredFields;
  collectAllDetails: boolean;
}

interface ParsedSchedulingRequest {
  kind: Exclude<SchedulingRequestKind, "none">;
  summary: string;
  requestedStart: string;
  requestedEnd: string;
  windowStart: string;
  windowEnd: string;
}

interface ChoiceOption {
  id: string;
  label: string;
  aliases?: string[];
}

const SLOT_ID_PREFIX = "slot_";
const REVIEW_CONFIRM_ID = "confirm";
const REVIEW_CHANGE_TIME_ID = "change_time";
const REVIEW_CHANGE_DETAILS_ID = "change_details";
const REVIEW_CANCEL_ID = "cancel";

function normalizeVariableName(value: unknown, fallback: string): string {
  const normalized = String(value ?? "")
    .replace(/\{\{|\}\}/g, "")
    .trim()
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function getBookingMode(value: unknown): CalendarBookingMode {
  const normalized = String(value ?? "").trim();
  if (normalized === "check_only" || normalized === "book_if_available") {
    return normalized;
  }
  return "suggest_slots";
}

function getTimeInputMode(value: unknown): TimeInputMode {
  return String(value ?? "").trim() === "ask_user" ? "ask_user" : "prefilled";
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function sanitizeRequestKind(value: unknown): SchedulingRequestKind {
  const normalized = String(value ?? "").trim();
  if (normalized === "requested_slot" || normalized === "search_window") {
    return normalized;
  }
  return "none";
}

function parseDateTime(value: string, label: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid ISO date-time value.`);
  }
  return parsed;
}

function formatWithTimeZone(
  value: string,
  timeZone: string | null,
  options: Intl.DateTimeFormatOptions
): string {
  const date = new Date(value);
  const formatterOptions = {
    timeZone: timeZone?.trim() || undefined,
    ...options
  };

  try {
    return new Intl.DateTimeFormat("en-US", formatterOptions).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(date);
  }
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function formatSlotLabel(start: string, end: string, timeZone: string | null): string {
  const day = formatWithTimeZone(start, timeZone, {
    weekday: "short",
    month: "short",
    day: "2-digit"
  });
  const startTime = formatWithTimeZone(start, timeZone, {
    hour: "numeric",
    minute: "2-digit"
  });
  const endTime = formatWithTimeZone(end, timeZone, {
    hour: "numeric",
    minute: "2-digit"
  });

  return `${day}, ${startTime} - ${endTime}`;
}

function formatSlotMenuTitle(start: string, timeZone: string | null): string {
  return truncateText(
    formatWithTimeZone(start, timeZone, {
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit"
    }),
    24
  );
}

function formatSlotMenuDescription(start: string, end: string, timeZone: string | null): string {
  const weekday = formatWithTimeZone(start, timeZone, {
    weekday: "long"
  });
  const endTime = formatWithTimeZone(end, timeZone, {
    hour: "numeric",
    minute: "2-digit"
  });
  return truncateText(`${weekday} until ${endTime}`, 72);
}

function serializeSlot(slot: CalendarBookingSlot | null): Record<string, unknown> | null {
  if (!slot) {
    return null;
  }
  return {
    id: slot.id,
    label: slot.label,
    start: slot.start,
    end: slot.end
  };
}

function buildSlot(
  id: string,
  start: string,
  end: string,
  timeZone: string | null
): CalendarBookingSlot {
  return {
    id,
    label: formatSlotLabel(start, end, timeZone),
    start,
    end,
    title: formatSlotMenuTitle(start, timeZone),
    description: formatSlotMenuDescription(start, end, timeZone)
  };
}

function overlapsBusy(
  startMs: number,
  endMs: number,
  busyIntervals: GoogleCalendarBusyInterval[]
): boolean {
  return busyIntervals.some((interval) => {
    const busyStart = new Date(interval.start).getTime();
    const busyEnd = new Date(interval.end).getTime();
    return startMs < busyEnd && endMs > busyStart;
  });
}

function buildExactSlot(start: string, end: string, timeZone: string | null): CalendarBookingSlot {
  return buildSlot("requested_slot", start, end, timeZone);
}

async function buildAvailableSlots(context: {
  userId: string;
  connectionId: string | null;
  calendarId: string;
  timeZone: string | null;
  windowStart: string;
  windowEnd: string;
  slotDurationMinutes: number;
  slotIntervalMinutes: number;
  maxOptions: number;
}): Promise<CalendarBookingSlot[]> {
  const startDate = parseDateTime(context.windowStart, "Window start");
  const endDate = parseDateTime(context.windowEnd, "Window end");
  if (startDate >= endDate) {
    throw new Error("Window end must be after window start.");
  }

  const busyIntervals = await queryGoogleCalendarFreeBusy({
    userId: context.userId,
    connectionId: context.connectionId,
    calendarId: context.calendarId,
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    timeZone: context.timeZone
  });

  const slotDurationMs = context.slotDurationMinutes * 60_000;
  const slotIntervalMs = context.slotIntervalMinutes * 60_000;
  const slots: CalendarBookingSlot[] = [];
  const windowEndMs = endDate.getTime();

  for (
    let cursor = startDate.getTime();
    cursor + slotDurationMs <= windowEndMs && slots.length < context.maxOptions;
    cursor += slotIntervalMs
  ) {
    const slotEnd = cursor + slotDurationMs;
    if (overlapsBusy(cursor, slotEnd, busyIntervals)) {
      continue;
    }

    slots.push(
      buildSlot(
        `${SLOT_ID_PREFIX}${slots.length + 1}`,
        new Date(cursor).toISOString(),
        new Date(slotEnd).toISOString(),
        context.timeZone
      )
    );
  }

  return slots;
}

async function isSlotAvailable(context: {
  userId: string;
  connectionId: string | null;
  calendarId: string;
  timeZone: string | null;
  slot: CalendarBookingSlot;
}): Promise<boolean> {
  const busyIntervals = await queryGoogleCalendarFreeBusy({
    userId: context.userId,
    connectionId: context.connectionId,
    calendarId: context.calendarId,
    timeMin: context.slot.start,
    timeMax: context.slot.end,
    timeZone: context.timeZone
  });

  return busyIntervals.length === 0;
}

function buildSlotsChoiceOptions(slots: CalendarBookingSlot[]): ChoiceOption[] {
  return slots.map((slot, index) => ({
    id: slot.id,
    label: slot.label,
    aliases: [
      slot.start,
      slot.end,
      slot.title,
      slot.description,
      `${index + 1}`,
      `${index + 1}. ${slot.label}`
    ]
  }));
}

function buildReviewChoiceOptions(requiredFields: WizardRequiredFields): ChoiceOption[] {
  const options: ChoiceOption[] = [
    {
      id: REVIEW_CONFIRM_ID,
      label: "Confirm appointment",
      aliases: ["confirm", "yes", "book", "okay"]
    },
    {
      id: REVIEW_CHANGE_TIME_ID,
      label: "Change time",
      aliases: ["change time", "different time", "reschedule"]
    }
  ];

  if (requiredFields.name || requiredFields.email || requiredFields.phone) {
    options.push({
      id: REVIEW_CHANGE_DETAILS_ID,
      label: "Change details",
      aliases: ["change details", "edit details", "edit information"]
    });
  }

  options.push({
    id: REVIEW_CANCEL_ID,
    label: "Cancel booking",
    aliases: ["cancel", "stop"]
  });

  return options;
}

function normalizeEmailValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : "";
}

function normalizePhoneValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const startsWithPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return "";
  }
  return `${startsWithPlus ? "+" : ""}${digits}`;
}

function formatPhoneValue(value: string): string {
  return value.trim();
}

function getRequiredFields(data: Record<string, unknown>): WizardRequiredFields {
  return {
    name: normalizeBoolean(data.requireName),
    email: normalizeBoolean(data.requireEmail),
    phone: normalizeBoolean(data.requirePhone)
  };
}

function readFirstText(vars: FlowVariables, keys: string[]): string {
  for (const key of keys) {
    const value = String(vars[key] ?? "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function resolveInitialDetails(data: Record<string, unknown>, vars: FlowVariables): WizardDetails {
  const name = interpolate(String(data.attendeeName ?? ""), vars).trim() ||
    readFirstText(vars, ["booking_name", "name", "contact_name", "lead_name", "customer_name"]);
  const email = normalizeEmailValue(
    interpolate(String(data.attendeeEmail ?? ""), vars).trim() ||
      readFirstText(vars, ["booking_email", "email", "contact_email", "lead_email"])
  );
  const phone = formatPhoneValue(
    normalizePhoneValue(
      readFirstText(vars, ["booking_phone", "phone", "contact_phone", "lead_phone", "mobile"])
    )
  );

  return {
    name,
    email,
    phone
  };
}

function sanitizeDetails(value: unknown): WizardDetails {
  const raw = (value ?? {}) as Partial<WizardDetails>;
  return {
    name: String(raw.name ?? "").trim(),
    email: normalizeEmailValue(String(raw.email ?? "")),
    phone: formatPhoneValue(normalizePhoneValue(String(raw.phone ?? "")))
  };
}

function sanitizeRequiredFields(value: unknown): WizardRequiredFields {
  const raw = (value ?? {}) as Partial<WizardRequiredFields>;
  return {
    name: normalizeBoolean(raw.name),
    email: normalizeBoolean(raw.email),
    phone: normalizeBoolean(raw.phone)
  };
}

function sanitizeSlot(value: unknown): CalendarBookingSlot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<CalendarBookingSlot>;
  const start = String(raw.start ?? "").trim();
  const end = String(raw.end ?? "").trim();
  const id = String(raw.id ?? "").trim();
  const label = String(raw.label ?? "").trim();
  const title = String(raw.title ?? "").trim();
  const description = String(raw.description ?? "").trim();

  if (!id || !start || !end || !label) {
    return null;
  }

  return {
    id,
    start,
    end,
    label,
    title: title || truncateText(label, 24),
    description
  };
}

function sanitizeSlots(value: unknown): CalendarBookingSlot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(sanitizeSlot).filter((slot): slot is CalendarBookingSlot => Boolean(slot));
}

function getNextDetailField(
  details: WizardDetails,
  requiredFields: WizardRequiredFields,
  collectAllDetails: boolean
): DetailField | null {
  const orderedFields: DetailField[] = ["name", "email", "phone"];

  for (const field of orderedFields) {
    if (!requiredFields[field]) {
      continue;
    }
    if (collectAllDetails || !details[field].trim()) {
      return field;
    }
  }

  return null;
}

function stageForField(field: DetailField): WizardStage {
  if (field === "name") {
    return "collect_name";
  }
  if (field === "email") {
    return "collect_email";
  }
  return "collect_phone";
}

function buildMessageVars(
  vars: FlowVariables,
  saveAs: string,
  state: CalendarWizardState,
  extras: FlowVariables = {}
): FlowVariables {
  const selectedSlot = state.selectedSlot;
  const requestedSlot = state.requestedSlot;
  const details = state.details;

  return {
    ...vars,
    selected_slot_start: selectedSlot?.start ?? "",
    selected_slot_end: selectedSlot?.end ?? "",
    selected_slot_label: selectedSlot?.label ?? "",
    booking_request_kind: state.requestKind,
    booking_request_summary: state.requestSummary,
    booking_search_window_start: state.searchWindowStart,
    booking_search_window_end: state.searchWindowEnd,
    requested_slot_start: requestedSlot?.start ?? "",
    requested_slot_end: requestedSlot?.end ?? "",
    requested_slot_label: requestedSlot?.label ?? "",
    booking_name: details.name,
    booking_email: details.email,
    booking_phone: details.phone,
    [`${saveAs}_selected_slot_start`]: selectedSlot?.start ?? "",
    [`${saveAs}_selected_slot_end`]: selectedSlot?.end ?? "",
    [`${saveAs}_selected_slot_label`]: selectedSlot?.label ?? "",
    [`${saveAs}_request_kind`]: state.requestKind,
    [`${saveAs}_request_summary`]: state.requestSummary,
    [`${saveAs}_search_window_start`]: state.searchWindowStart,
    [`${saveAs}_search_window_end`]: state.searchWindowEnd,
    [`${saveAs}_requested_slot_start`]: requestedSlot?.start ?? "",
    [`${saveAs}_requested_slot_end`]: requestedSlot?.end ?? "",
    [`${saveAs}_requested_slot_label`]: requestedSlot?.label ?? "",
    [`${saveAs}_name`]: details.name,
    [`${saveAs}_email`]: details.email,
    [`${saveAs}_phone`]: details.phone,
    ...extras
  };
}

function buildPublicPayload(input: {
  status: string;
  state: CalendarWizardState | null;
  event?: GoogleCalendarEventResult | null;
  error?: string;
}): Record<string, unknown> {
  return {
    status: input.status,
    mode: input.state?.mode ?? null,
    requestKind: input.state?.requestKind ?? "none",
    requestSummary: input.state?.requestSummary ?? "",
    searchWindowStart: input.state?.searchWindowStart ?? "",
    searchWindowEnd: input.state?.searchWindowEnd ?? "",
    requestedAvailable: input.state?.requestedAvailable ?? false,
    selectedSlot: serializeSlot(input.state?.selectedSlot ?? null),
    requestedSlot: serializeSlot(input.state?.requestedSlot ?? null),
    slots: (input.state?.slots ?? []).map((slot) => serializeSlot(slot)),
    details: input.state?.details ?? { name: "", email: "", phone: "" },
    event: input.event
      ? {
          id: input.event.id,
          status: input.event.status,
          htmlLink: input.event.htmlLink,
          summary: input.event.summary,
          startTime: input.event.startTime,
          endTime: input.event.endTime
        }
      : null,
    error: input.error ?? ""
  };
}

function buildEmptyWizardState(mode: CalendarBookingMode = "suggest_slots"): CalendarWizardState {
  return {
    stage: "review",
    mode,
    requestKind: "none",
    requestSummary: "",
    searchWindowStart: "",
    searchWindowEnd: "",
    requestedSlot: null,
    requestedAvailable: false,
    selectedSlot: null,
    slots: [],
    details: { name: "", email: "", phone: "" },
    requiredFields: { name: false, email: false, phone: false },
    collectAllDetails: false
  };
}

function buildRuntimeVariables(input: {
  vars: FlowVariables;
  saveAs: string;
  status: string;
  state: CalendarWizardState | null;
  event?: GoogleCalendarEventResult | null;
  error?: string;
  clearWizardState?: boolean;
}): FlowVariables {
  const payload = buildPublicPayload({
    status: input.status,
    state: input.state,
    event: input.event,
    error: input.error
  });

  return {
    ...buildMessageVars(input.vars, input.saveAs, input.state ?? buildEmptyWizardState()),
    [input.saveAs]: JSON.stringify(payload),
    [`${input.saveAs}_payload`]: payload,
    [`${input.saveAs}_status`]: input.status,
    [`${input.saveAs}_available`]: Boolean(input.state?.selectedSlot),
    [`${input.saveAs}_requested_available`]: input.state?.requestedAvailable ?? false,
    [`${input.saveAs}_slot_count`]: input.state?.slots.length ?? 0,
    [`${input.saveAs}_slots`]: input.state?.slots ?? [],
    [`${input.saveAs}_wizard_state`]: input.clearWizardState ? null : input.state,
    [`${input.saveAs}_event_id`]: input.event?.id ?? "",
    [`${input.saveAs}_event_status`]: input.event?.status ?? "",
    [`${input.saveAs}_event_link`]: input.event?.htmlLink ?? "",
    [`${input.saveAs}_error`]: input.error ?? ""
  };
}

function readWizardState(vars: FlowVariables, saveAs: string): CalendarWizardState | null {
  const raw = vars[`${saveAs}_wizard_state`];
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const state = raw as Partial<CalendarWizardState>;
  const mode = getBookingMode(state.mode);
  const stage = String(state.stage ?? "").trim();

  return {
    stage:
      stage === "collect_schedule_request" ||
      stage === "slot_selection" ||
      stage === "collect_name" ||
      stage === "collect_email" ||
      stage === "collect_phone" ||
      stage === "review"
        ? stage
        : "slot_selection",
    mode,
    requestKind: sanitizeRequestKind(state.requestKind),
    requestSummary: String(state.requestSummary ?? "").trim(),
    searchWindowStart: String(state.searchWindowStart ?? "").trim(),
    searchWindowEnd: String(state.searchWindowEnd ?? "").trim(),
    requestedSlot: sanitizeSlot(state.requestedSlot),
    requestedAvailable: normalizeBoolean(state.requestedAvailable),
    selectedSlot: sanitizeSlot(state.selectedSlot),
    slots: sanitizeSlots(state.slots),
    details: sanitizeDetails(state.details),
    requiredFields: sanitizeRequiredFields(state.requiredFields),
    collectAllDetails: normalizeBoolean(state.collectAllDetails)
  };
}

function buildSearchWindowAroundSlot(
  start: string,
  end: string,
  windowHours: number
): { start: string; end: string } {
  const startMs = parseDateTime(start, "Requested start").getTime();
  const endMs = parseDateTime(end, "Requested end").getTime();
  const midpoint = startMs + (endMs - startMs) / 2;
  const totalWindowMs = Math.max(1, windowHours) * 60 * 60 * 1000;
  return {
    start: new Date(midpoint - totalWindowMs / 2).toISOString(),
    end: new Date(midpoint + totalWindowMs / 2).toISOString()
  };
}

function tryParseDateLiteral(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function tryParseSchedulingRequestFallback(input: {
  message: string;
  slotDurationMinutes: number;
  promptSearchWindowHours: number;
}): ParsedSchedulingRequest | null {
  const message = input.message.trim();
  if (!message) {
    return null;
  }

  const betweenMatch = message.match(/^between\s+(.+?)\s+and\s+(.+)$/i);
  const rangeParts = betweenMatch
    ? [betweenMatch[1], betweenMatch[2]]
    : message.split(/\s+(?:to|until|-)\s+/i);

  if (rangeParts.length === 2) {
    const start = tryParseDateLiteral(rangeParts[0]);
    const end = tryParseDateLiteral(rangeParts[1]);
    if (start && end && parseDateTime(end, "Search window end") > parseDateTime(start, "Search window start")) {
      return {
        kind: "search_window",
        summary: message,
        requestedStart: "",
        requestedEnd: "",
        windowStart: start,
        windowEnd: end
      };
    }
  }

  const exactStart = tryParseDateLiteral(message);
  if (!exactStart) {
    return null;
  }

  const exactEnd = new Date(
    parseDateTime(exactStart, "Requested start").getTime() + input.slotDurationMinutes * 60_000
  ).toISOString();
  const derivedWindow = buildSearchWindowAroundSlot(
    exactStart,
    exactEnd,
    input.promptSearchWindowHours
  );

  return {
    kind: "requested_slot",
    summary: message,
    requestedStart: exactStart,
    requestedEnd: exactEnd,
    windowStart: derivedWindow.start,
    windowEnd: derivedWindow.end
  };
}

function normalizeParsedSchedulingRequest(input: {
  raw: Record<string, unknown>;
  fallbackSummary: string;
  slotDurationMinutes: number;
  promptSearchWindowHours: number;
}): ParsedSchedulingRequest | null {
  const kind = sanitizeRequestKind(input.raw.kind);
  if (kind === "none") {
    return null;
  }

  const summary = String(input.raw.summary ?? input.fallbackSummary).trim() || input.fallbackSummary;
  const requestedStart = String(input.raw.requestedStart ?? "").trim();
  const requestedEndRaw = String(input.raw.requestedEnd ?? "").trim();
  const windowStartRaw = String(input.raw.windowStart ?? "").trim();
  const windowEndRaw = String(input.raw.windowEnd ?? "").trim();

  if (kind === "requested_slot") {
    if (!requestedStart) {
      return null;
    }
    const start = parseDateTime(requestedStart, "Requested start").toISOString();
    const end = requestedEndRaw
      ? parseDateTime(requestedEndRaw, "Requested end").toISOString()
      : new Date(parseDateTime(start, "Requested start").getTime() + input.slotDurationMinutes * 60_000).toISOString();
    if (parseDateTime(end, "Requested end") <= parseDateTime(start, "Requested start")) {
      return null;
    }
    const derivedWindow =
      windowStartRaw && windowEndRaw
        ? {
            start: parseDateTime(windowStartRaw, "Search window start").toISOString(),
            end: parseDateTime(windowEndRaw, "Search window end").toISOString()
          }
        : buildSearchWindowAroundSlot(start, end, input.promptSearchWindowHours);
    if (parseDateTime(derivedWindow.end, "Search window end") <= parseDateTime(derivedWindow.start, "Search window start")) {
      return null;
    }
    return {
      kind,
      summary,
      requestedStart: start,
      requestedEnd: end,
      windowStart: derivedWindow.start,
      windowEnd: derivedWindow.end
    };
  }

  if (!windowStartRaw || !windowEndRaw) {
    return null;
  }
  const windowStart = parseDateTime(windowStartRaw, "Search window start").toISOString();
  const windowEnd = parseDateTime(windowEndRaw, "Search window end").toISOString();
  if (parseDateTime(windowEnd, "Search window end") <= parseDateTime(windowStart, "Search window start")) {
    return null;
  }
  return {
    kind,
    summary,
    requestedStart: "",
    requestedEnd: "",
    windowStart,
    windowEnd
  };
}

async function parseSchedulingRequest(input: {
  message: string;
  bookingMode: CalendarBookingMode;
  timeZone: string | null;
  slotDurationMinutes: number;
  promptSearchWindowHours: number;
  userId?: string;
}): Promise<ParsedSchedulingRequest | null> {
  const fallback = tryParseSchedulingRequestFallback(input);
  if (fallback) {
    return fallback;
  }
  if (!aiService.isConfigured()) {
    return null;
  }

  try {
    const now = new Date().toISOString();
    const raw = await aiService.generateJson(
      [
        "You convert booking date/time replies into JSON for a calendar scheduler.",
        "Return only valid JSON with keys: kind, summary, requestedStart, requestedEnd, windowStart, windowEnd.",
        "kind must be one of: requested_slot, search_window, invalid.",
        "Use requested_slot when the user gave one preferred appointment time.",
        "Use search_window when the user gave a broader range like a day, part of day, or explicit time window.",
        "If the user gives only one time, requestedEnd may be empty.",
        "If the user gives a broad range, requestedStart/requestedEnd should be empty.",
        "Use ISO 8601 date-times. Include an offset when possible.",
        `Interpret times in timezone: ${input.timeZone || "UTC"}.`,
        `Current reference time: ${now}.`,
        `Booking mode: ${input.bookingMode}.`,
        "If the reply is too ambiguous, return kind as invalid."
      ].join("\n"),
      input.message
    );

    const parsed = normalizeParsedSchedulingRequest({
      raw,
      fallbackSummary: input.message.trim(),
      slotDurationMinutes: input.slotDurationMinutes,
      promptSearchWindowHours: input.promptSearchWindowHours
    });
    if (input.userId) void chargeUser(input.userId, "ai_agent_flow");
    return parsed;
  } catch {
    return null;
  }
}

function resolveRequestedSlot(input: {
  data: Record<string, unknown>;
  vars: FlowVariables;
  timeZone: string | null;
}): CalendarBookingSlot {
  const requestedStartValue = interpolate(String(input.data.requestedStart ?? ""), input.vars).trim();
  if (!requestedStartValue) {
    throw new Error("Requested start must be provided from the flow.");
  }

  const startDate = parseDateTime(requestedStartValue, "Requested start");
  const requestedEndValue = interpolate(String(input.data.requestedEnd ?? ""), input.vars).trim();
  const endDate = requestedEndValue
    ? parseDateTime(requestedEndValue, "Requested end")
    : new Date(
        startDate.getTime() + parsePositiveInteger(input.data.slotDurationMinutes, 30) * 60_000
      );

  if (endDate <= startDate) {
    throw new Error("Requested end must be after requested start.");
  }

  return buildExactSlot(startDate.toISOString(), endDate.toISOString(), input.timeZone);
}

function resolveSearchWindow(input: {
  data: Record<string, unknown>;
  vars: FlowVariables;
  mode: CalendarBookingMode;
}): { start: string; end: string } {
  const startField =
    input.mode === "suggest_slots" ? input.data.windowStart : input.data.alternateWindowStart;
  const endField =
    input.mode === "suggest_slots" ? input.data.windowEnd : input.data.alternateWindowEnd;

  const start = interpolate(String(startField ?? ""), input.vars).trim();
  const end = interpolate(String(endField ?? ""), input.vars).trim();

  if (!start || !end) {
    throw new Error(
      input.mode === "suggest_slots"
        ? "Window start and end are required to suggest appointment slots."
        : "Alternate window start and end are required to suggest other appointment slots."
    );
  }

  if (parseDateTime(start, "Search window start") >= parseDateTime(end, "Search window end")) {
    throw new Error("Search window end must be after search window start.");
  }

  return { start, end };
}

function createWizardState(input: {
  mode: CalendarBookingMode;
  stage?: WizardStage;
  requestKind?: SchedulingRequestKind;
  requestSummary?: string;
  searchWindowStart: string;
  searchWindowEnd: string;
  requestedSlot: CalendarBookingSlot | null;
  requestedAvailable: boolean;
  selectedSlot: CalendarBookingSlot | null;
  slots: CalendarBookingSlot[];
  details: WizardDetails;
  requiredFields: WizardRequiredFields;
  collectAllDetails?: boolean;
}): CalendarWizardState {
  return {
    stage: input.stage ?? "slot_selection",
    mode: input.mode,
    requestKind: input.requestKind ?? "none",
    requestSummary: input.requestSummary ?? "",
    searchWindowStart: input.searchWindowStart,
    searchWindowEnd: input.searchWindowEnd,
    requestedSlot: input.requestedSlot,
    requestedAvailable: input.requestedAvailable,
    selectedSlot: input.selectedSlot,
    slots: input.slots,
    details: input.details,
    requiredFields: input.requiredFields,
    collectAllDetails: Boolean(input.collectAllDetails)
  };
}

function buildSlotIntroText(
  promptMessage: string,
  vars: FlowVariables,
  state: CalendarWizardState,
  saveAs: string
): string {
  const fallback =
    state.mode === "suggest_slots"
      ? "Please choose one of these available appointment slots."
      : "Please choose one of these alternative appointment slots.";
  return (
    interpolate(promptMessage.trim() || fallback, buildMessageVars(vars, saveAs, state)).trim() || fallback
  );
}

function buildSlotPromptText(
  promptMessage: string,
  vars: FlowVariables,
  state: CalendarWizardState,
  saveAs: string,
  prefix?: string | null
): string {
  return joinTextParts([
    prefix,
    buildSlotIntroText(promptMessage, vars, state, saveAs),
    buildChoicePrompt(buildSlotsChoiceOptions(state.slots))
  ]);
}

function buildReviewSummary(
  reviewMessage: string,
  vars: FlowVariables,
  state: CalendarWizardState,
  saveAs: string
): string {
  const fallback = [
    "Please review the appointment details:",
    `Slot: {{selected_slot_label}}`,
    `Name: {{booking_name}}`,
    `Email: {{booking_email}}`,
    `Phone: {{booking_phone}}`
  ].join("\n");

  return (
    interpolate(reviewMessage.trim() || fallback, buildMessageVars(vars, saveAs, state)).trim() ||
    interpolate(fallback, buildMessageVars(vars, saveAs, state)).trim()
  );
}

function buildReviewPromptText(
  reviewMessage: string,
  vars: FlowVariables,
  state: CalendarWizardState,
  saveAs: string,
  prefix?: string | null
): string {
  return joinTextParts([
    prefix,
    buildReviewSummary(reviewMessage, vars, state, saveAs),
    buildChoicePrompt(buildReviewChoiceOptions(state.requiredFields))
  ]);
}

function buildFieldPrompt(data: Record<string, unknown>, field: DetailField): string {
  if (field === "name") {
    return String(data.namePrompt ?? "Please share the attendee name.").trim();
  }
  if (field === "email") {
    return String(data.emailPrompt ?? "Please share the attendee email address.").trim();
  }
  return String(data.phonePrompt ?? "Please share the attendee phone number.").trim();
}

function buildAvailabilityPrefix(
  data: Record<string, unknown>,
  vars: FlowVariables,
  saveAs: string,
  state: CalendarWizardState
): string {
  const fallback = "That appointment time is available: {{selected_slot_label}}.";
  return (
    interpolate(
      String(data.availabilityMessage ?? fallback).trim() || fallback,
      buildMessageVars(vars, saveAs, state)
    ).trim() || fallback
  );
}

function buildUnavailablePrefix(
  data: Record<string, unknown>,
  vars: FlowVariables,
  saveAs: string,
  state: CalendarWizardState
): string {
  const fallback = "That appointment time is no longer available: {{requested_slot_label}}.";
  return (
    interpolate(
      String(data.unavailableMessage ?? fallback).trim() || fallback,
      buildMessageVars(vars, saveAs, state)
    ).trim() || fallback
  );
}

function buildNoAvailabilityText(
  data: Record<string, unknown>,
  vars: FlowVariables,
  saveAs: string,
  state: CalendarWizardState,
  prefix?: string | null
): string {
  const fallback = "No free appointment slots were found in that time window.";
  return joinTextParts([
    prefix,
    interpolate(
      String(data.noAvailabilityMessage ?? fallback).trim() || fallback,
      buildMessageVars(vars, saveAs, state)
    ).trim()
  ]);
}

function buildCancellationText(
  data: Record<string, unknown>,
  vars: FlowVariables,
  saveAs: string,
  state: CalendarWizardState
): string {
  const fallback = "Appointment booking was cancelled.";
  return (
    interpolate(
      String(data.cancellationMessage ?? fallback).trim() || fallback,
      buildMessageVars(vars, saveAs, state)
    ).trim() || fallback
  );
}

function buildTimeRequestPrompt(data: Record<string, unknown>): string {
  return (
    String(
      data.timeRequestPrompt ??
        "Please share your preferred appointment time or time range. Example: tomorrow 3 PM or tomorrow between 2 PM and 5 PM."
    ).trim() ||
    "Please share your preferred appointment time or time range."
  );
}

function buildInvalidTimeRequestText(data: Record<string, unknown>): string {
  return (
    String(
      data.invalidTimeRequestMessage ??
        "I couldn't understand that timing yet. Please share a clear date/time or a time range."
    ).trim() || "I couldn't understand that timing yet. Please share a clear date/time or a time range."
  );
}

function getCurrentFieldForStage(stage: WizardStage): DetailField | null {
  if (stage === "collect_name") {
    return "name";
  }
  if (stage === "collect_email") {
    return "email";
  }
  if (stage === "collect_phone") {
    return "phone";
  }
  return null;
}

function normalizeDetailResponse(
  field: DetailField,
  message: string,
  data: Record<string, unknown>
): { ok: true; value: string } | { ok: false; errorText: string } {
  const trimmed = message.trim();
  if (!trimmed) {
    return {
      ok: false,
      errorText: buildFieldPrompt(data, field)
    };
  }

  if (field === "email") {
    const normalized = normalizeEmailValue(trimmed);
    if (!normalized) {
      return {
        ok: false,
        errorText:
          String(data.invalidEmailMessage ?? "Please enter a valid email address.").trim() ||
          "Please enter a valid email address."
      };
    }
    return { ok: true, value: normalized };
  }

  if (field === "phone") {
    const normalized = normalizePhoneValue(trimmed);
    if (!normalized) {
      return {
        ok: false,
        errorText:
          String(data.invalidPhoneMessage ?? "Please enter a valid phone number.").trim() ||
          "Please enter a valid phone number."
      };
    }
    return { ok: true, value: formatPhoneValue(normalized) };
  }

  return { ok: true, value: trimmed };
}

function resolveAttendeeName(
  data: Record<string, unknown>,
  vars: FlowVariables,
  saveAs: string,
  state: CalendarWizardState
): string | null {
  const fromField = interpolate(
    String(data.attendeeName ?? ""),
    buildMessageVars(vars, saveAs, state)
  ).trim();
  return fromField || state.details.name || null;
}

function resolveAttendeeEmail(
  data: Record<string, unknown>,
  vars: FlowVariables,
  saveAs: string,
  state: CalendarWizardState
): string | null {
  const fromField = normalizeEmailValue(
    interpolate(String(data.attendeeEmail ?? ""), buildMessageVars(vars, saveAs, state)).trim()
  );
  return fromField || state.details.email || null;
}

async function refreshSelectionWindowSlots(input: {
  userId: string;
  connectionId: string | null;
  calendarId: string;
  timeZone: string | null;
  state: CalendarWizardState;
  slotDurationMinutes: number;
  slotIntervalMinutes: number;
  maxOptions: number;
}): Promise<CalendarBookingSlot[]> {
  return buildAvailableSlots({
    userId: input.userId,
    connectionId: input.connectionId,
    calendarId: input.calendarId,
    timeZone: input.timeZone,
    windowStart: input.state.searchWindowStart,
    windowEnd: input.state.searchWindowEnd,
    slotDurationMinutes: input.slotDurationMinutes,
    slotIntervalMinutes: input.slotIntervalMinutes,
    maxOptions: input.maxOptions
  });
}

function sanitizeSendUpdates(value: unknown): "all" | "externalOnly" | "none" {
  const normalized = String(value ?? "").trim();
  if (normalized === "externalOnly" || normalized === "none") {
    return normalized;
  }
  return "all";
}

async function sendTimeRequestPrompt(input: {
  sendReply: (payload: { type: "text"; text: string }) => Promise<void>;
  data: Record<string, unknown>;
  prefix?: string | null;
}): Promise<void> {
  await input.sendReply({
    type: "text",
    text: joinTextParts([input.prefix, buildTimeRequestPrompt(input.data)])
  });
}

async function sendSlotSelectionPrompt(input: {
  sendReply: (payload: { type: "text"; text: string } | { type: "list"; text: string; buttonLabel: string; sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }> }) => Promise<void>;
  channel: "web" | "baileys" | "api_whatsapp";
  data: Record<string, unknown>;
  vars: FlowVariables;
  saveAs: string;
  state: CalendarWizardState;
  prefix?: string | null;
}): Promise<void> {
  const text = buildSlotIntroText(input.data.promptMessage ? String(input.data.promptMessage) : "", input.vars, input.state, input.saveAs);
  if (input.channel === "api_whatsapp") {
    await input.sendReply({
      type: "list",
      text: joinTextParts([input.prefix, text]),
      buttonLabel: "Choose a slot",
      sections: [
        {
          title: "Available slots",
          rows: input.state.slots.map((slot) => ({
            id: slot.id,
            title: slot.title,
            description: slot.description || slot.label
          }))
        }
      ]
    });
    return;
  }

  await input.sendReply({
    type: "text",
    text: buildSlotPromptText(String(input.data.promptMessage ?? ""), input.vars, input.state, input.saveAs, input.prefix)
  });
}

async function sendReviewPrompt(input: {
  sendReply: (payload: { type: "text"; text: string } | { type: "list"; text: string; buttonLabel: string; sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }> }) => Promise<void>;
  channel: "web" | "baileys" | "api_whatsapp";
  data: Record<string, unknown>;
  vars: FlowVariables;
  saveAs: string;
  state: CalendarWizardState;
  prefix?: string | null;
}): Promise<void> {
  const actions = buildReviewChoiceOptions(input.state.requiredFields);
  const summary = buildReviewSummary(String(input.data.reviewMessage ?? ""), input.vars, input.state, input.saveAs);

  if (input.channel === "api_whatsapp") {
    await input.sendReply({
      type: "list",
      text: joinTextParts([input.prefix, summary]),
      buttonLabel: "Choose next step",
      sections: [
        {
          title: "Booking actions",
          rows: actions.map((action) => ({
            id: action.id,
            title: truncateText(action.label, 24),
            description: action.aliases?.[0]
          }))
        }
      ]
    });
    return;
  }

  await input.sendReply({
    type: "text",
    text: buildReviewPromptText(String(input.data.reviewMessage ?? ""), input.vars, input.state, input.saveAs, input.prefix)
  });
}

async function sendDetailPrompt(input: {
  sendReply: (payload: { type: "text"; text: string }) => Promise<void>;
  data: Record<string, unknown>;
  field: DetailField;
}): Promise<void> {
  await input.sendReply({
    type: "text",
    text: buildFieldPrompt(input.data, input.field)
  });
}

async function promptNextWizardStep(input: {
  data: Record<string, unknown>;
  vars: FlowVariables;
  saveAs: string;
  state: CalendarWizardState;
  channel: "web" | "baileys" | "api_whatsapp";
  sendReply: (payload: { type: "text"; text: string } | { type: "list"; text: string; buttonLabel: string; sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }> }) => Promise<void>;
  prefix?: string | null;
}): Promise<CalendarWizardState> {
  const nextField = getNextDetailField(
    input.state.details,
    input.state.requiredFields,
    input.state.collectAllDetails
  );

  if (nextField) {
    const nextState: CalendarWizardState = {
      ...input.state,
      stage: stageForField(nextField),
      collectAllDetails: input.state.collectAllDetails
    };
    await sendDetailPrompt({
      sendReply: input.sendReply as (payload: { type: "text"; text: string }) => Promise<void>,
      data: input.data,
      field: nextField
    });
    return nextState;
  }

  const nextState: CalendarWizardState = {
    ...input.state,
    stage: "review",
    collectAllDetails: false
  };
  await sendReviewPrompt({
    sendReply: input.sendReply,
    channel: input.channel,
    data: input.data,
    vars: input.vars,
    saveAs: input.saveAs,
    state: nextState,
    prefix: input.prefix
  });
  return nextState;
}

function getWaitingStatusForState(state: CalendarWizardState): string {
  if (state.stage === "collect_schedule_request") {
    return "awaiting_schedule_request";
  }
  if (state.stage === "review") {
    return "awaiting_confirmation";
  }
  if (state.stage === "collect_name") {
    return "awaiting_name";
  }
  if (state.stage === "collect_email") {
    return "awaiting_email";
  }
  if (state.stage === "collect_phone") {
    return "awaiting_phone";
  }
  return "awaiting_slot_selection";
}

export const googleCalendarBookingBlock: FlowBlockModule = {
  type: "googleCalendarBooking",
  async execute(context) {
    const userId = context.userId?.trim();
    if (!userId) {
      throw new Error("Google Calendar booking requires an authenticated workspace user.");
    }

    const saveAs = normalizeVariableName(context.node.data.saveAs, "google_calendar_booking");
    const bookingMode = getBookingMode(context.node.data.bookingMode);
    const timeInputMode = getTimeInputMode(context.node.data.timeInputMode);
    const connectionId = String(context.node.data.connectionId ?? "").trim() || null;
    const calendarId = String(context.node.data.calendarId ?? "primary").trim() || "primary";
    const timeZone = String(context.node.data.timeZone ?? "").trim() || null;
    const promptSearchWindowHours = parsePositiveInteger(
      context.node.data.promptSearchWindowHours,
      6
    );
    const slotDurationMinutes = parsePositiveInteger(context.node.data.slotDurationMinutes, 30);
    const slotIntervalMinutes = parsePositiveInteger(
      context.node.data.slotIntervalMinutes,
      slotDurationMinutes
    );
    const maxOptions = Math.min(parsePositiveInteger(context.node.data.maxOptions, 5), 10);
    const requiredFields = getRequiredFields(context.node.data);
    const initialDetails = resolveInitialDetails(context.node.data, context.vars);

    try {
      if (timeInputMode === "ask_user") {
        const initialState = createWizardState({
          stage: "collect_schedule_request",
          mode: bookingMode,
          requestKind: "none",
          requestSummary: "",
          searchWindowStart: "",
          searchWindowEnd: "",
          requestedSlot: null,
          requestedAvailable: false,
          selectedSlot: null,
          slots: [],
          details: initialDetails,
          requiredFields
        });
        const waitingVars = buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: getWaitingStatusForState(initialState),
          state: initialState
        });

        await sendTimeRequestPrompt({
          sendReply: context.sendReply as (payload: { type: "text"; text: string }) => Promise<void>,
          data: context.node.data
        });

        return {
          signal: "wait",
          waitingFor: "message",
          waitingNodeId: context.node.id,
          variables: waitingVars
        };
      }

      const searchWindow = resolveSearchWindow({
        data: context.node.data,
        vars: context.vars,
        mode: bookingMode
      });

      if (bookingMode === "suggest_slots") {
        const slots = await buildAvailableSlots({
          userId,
          connectionId,
          calendarId,
          timeZone,
          windowStart: searchWindow.start,
          windowEnd: searchWindow.end,
          slotDurationMinutes,
          slotIntervalMinutes,
          maxOptions
        });

        const initialState = createWizardState({
          mode: bookingMode,
          requestKind: "search_window",
          requestSummary: "",
          searchWindowStart: searchWindow.start,
          searchWindowEnd: searchWindow.end,
          requestedSlot: null,
          requestedAvailable: false,
          selectedSlot: null,
          slots,
          details: initialDetails,
          requiredFields
        });

        if (!slots.length) {
          const failVars = buildRuntimeVariables({
            vars: context.vars,
            saveAs,
            status: "no_availability",
            state: initialState,
            error: "No free appointment slots were found.",
            clearWizardState: true
          });
          await context.sendReply({
            type: "text",
            text: buildNoAvailabilityText(context.node.data, failVars, saveAs, initialState)
          });
          return {
            signal: "continue",
            nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, "fail"),
            variables: failVars
          };
        }

        const waitingVars = buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: "awaiting_slot_selection",
          state: initialState
        });

        await sendSlotSelectionPrompt({
          sendReply: context.sendReply,
          channel: context.channel,
          data: context.node.data,
          vars: waitingVars,
          saveAs,
          state: initialState
        });

        return {
          signal: "wait",
          waitingFor: "message",
          waitingNodeId: context.node.id,
          variables: waitingVars
        };
      }

      const requestedSlot = resolveRequestedSlot({
        data: context.node.data,
        vars: context.vars,
        timeZone
      });
      const requestedAvailable = await isSlotAvailable({
        userId,
        connectionId,
        calendarId,
        timeZone,
        slot: requestedSlot
      });

      if (requestedAvailable) {
        const initialState = createWizardState({
          mode: bookingMode,
          requestKind: "requested_slot",
          requestSummary: requestedSlot.label,
          searchWindowStart: searchWindow.start,
          searchWindowEnd: searchWindow.end,
          requestedSlot,
          requestedAvailable: true,
          selectedSlot: requestedSlot,
          slots: [],
          details: initialDetails,
          requiredFields
        });

        const nextState = await promptNextWizardStep({
          data: context.node.data,
          vars: context.vars,
          saveAs,
          state: initialState,
          channel: context.channel,
          sendReply: context.sendReply,
          prefix: buildAvailabilityPrefix(context.node.data, context.vars, saveAs, initialState)
        });

        return {
          signal: "wait",
          waitingFor: "message",
          waitingNodeId: context.node.id,
          variables: buildRuntimeVariables({
            vars: context.vars,
            saveAs,
            status: getWaitingStatusForState(nextState),
            state: nextState
          })
        };
      }

      const alternateSlots = await buildAvailableSlots({
        userId,
        connectionId,
        calendarId,
        timeZone,
        windowStart: searchWindow.start,
        windowEnd: searchWindow.end,
        slotDurationMinutes,
        slotIntervalMinutes,
        maxOptions
      });

      const alternateState = createWizardState({
        mode: bookingMode,
        requestKind: "requested_slot",
        requestSummary: requestedSlot.label,
        searchWindowStart: searchWindow.start,
        searchWindowEnd: searchWindow.end,
        requestedSlot,
        requestedAvailable: false,
        selectedSlot: null,
        slots: alternateSlots,
        details: initialDetails,
        requiredFields
      });

      if (!alternateSlots.length) {
        const failVars = buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: "no_availability",
          state: alternateState,
          error: "Requested appointment time is unavailable and no alternate slots were found.",
          clearWizardState: true
        });
        await context.sendReply({
          type: "text",
          text: buildNoAvailabilityText(
            context.node.data,
            failVars,
            saveAs,
            alternateState,
            buildUnavailablePrefix(context.node.data, failVars, saveAs, alternateState)
          )
        });
        return {
          signal: "continue",
          nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, "fail"),
          variables: failVars
        };
      }

      const waitingVars = buildRuntimeVariables({
        vars: context.vars,
        saveAs,
        status: "awaiting_slot_selection",
        state: alternateState
      });

      await sendSlotSelectionPrompt({
        sendReply: context.sendReply,
        channel: context.channel,
        data: context.node.data,
        vars: waitingVars,
        saveAs,
        state: alternateState,
        prefix: buildUnavailablePrefix(context.node.data, waitingVars, saveAs, alternateState)
      });

      return {
        signal: "wait",
        waitingFor: "message",
        waitingNodeId: context.node.id,
        variables: waitingVars
      };
    } catch (error) {
      const message = (error as Error).message;
      await context.sendReply({
        type: "text",
        text: message
      });
      return {
        signal: "continue",
        nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, "fail"),
        variables: buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: "request_failed",
          state: null,
          error: message
        })
      };
    }
  },
  async resumeWait(context) {
    const userId = context.userId?.trim();
    if (!userId) {
      throw new Error("Google Calendar booking requires an authenticated workspace user.");
    }

    const saveAs = normalizeVariableName(context.node.data.saveAs, "google_calendar_booking");
    const bookingMode = getBookingMode(context.node.data.bookingMode);
    const connectionId = String(context.node.data.connectionId ?? "").trim() || null;
    const calendarId = String(context.node.data.calendarId ?? "primary").trim() || "primary";
    const timeZone = String(context.node.data.timeZone ?? "").trim() || null;
    const promptSearchWindowHours = parsePositiveInteger(
      context.node.data.promptSearchWindowHours,
      6
    );
    const slotDurationMinutes = parsePositiveInteger(context.node.data.slotDurationMinutes, 30);
    const slotIntervalMinutes = parsePositiveInteger(
      context.node.data.slotIntervalMinutes,
      slotDurationMinutes
    );
    const maxOptions = Math.min(parsePositiveInteger(context.node.data.maxOptions, 5), 10);
    const state = readWizardState(context.vars, saveAs);

    if (!state) {
      return {
        signal: "advance",
        nextHandleId: "fail",
        variables: buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: "expired",
          state: null,
          error: "The appointment booking session expired. Please start again."
        })
      };
    }

    if (state.stage === "collect_schedule_request") {
      const parsedRequest = await parseSchedulingRequest({
        message: context.message,
        bookingMode,
        timeZone,
        slotDurationMinutes,
        promptSearchWindowHours,
        userId: context.userId ?? undefined
      });

      if (!parsedRequest) {
        await sendTimeRequestPrompt({
          sendReply: context.sendReply as (payload: { type: "text"; text: string }) => Promise<void>,
          data: context.node.data,
          prefix: buildInvalidTimeRequestText(context.node.data)
        });
        return {
          signal: "stay_waiting",
          variables: buildRuntimeVariables({
            vars: context.vars,
            saveAs,
            status: getWaitingStatusForState(state),
            state
          })
        };
      }

      const requestedSlot =
        parsedRequest.kind === "requested_slot"
          ? buildExactSlot(parsedRequest.requestedStart, parsedRequest.requestedEnd, timeZone)
          : null;

      if (requestedSlot && bookingMode !== "suggest_slots") {
        const requestedAvailable = await isSlotAvailable({
          userId,
          connectionId,
          calendarId,
          timeZone,
          slot: requestedSlot
        });

        if (requestedAvailable) {
          const nextBaseState = createWizardState({
            mode: bookingMode,
            requestKind: parsedRequest.kind,
            requestSummary: parsedRequest.summary,
            searchWindowStart: parsedRequest.windowStart,
            searchWindowEnd: parsedRequest.windowEnd,
            requestedSlot,
            requestedAvailable: true,
            selectedSlot: requestedSlot,
            slots: [],
            details: state.details,
            requiredFields: state.requiredFields
          });
          const nextState = await promptNextWizardStep({
            data: context.node.data,
            vars: context.vars,
            saveAs,
            state: nextBaseState,
            channel: context.channel,
            sendReply: context.sendReply,
            prefix: buildAvailabilityPrefix(context.node.data, context.vars, saveAs, nextBaseState)
          });
          return {
            signal: "stay_waiting",
            variables: buildRuntimeVariables({
              vars: context.vars,
              saveAs,
              status: getWaitingStatusForState(nextState),
              state: nextState
            })
          };
        }

        const alternateSlots = await buildAvailableSlots({
          userId,
          connectionId,
          calendarId,
          timeZone,
          windowStart: parsedRequest.windowStart,
          windowEnd: parsedRequest.windowEnd,
          slotDurationMinutes,
          slotIntervalMinutes,
          maxOptions
        });

        const alternateState = createWizardState({
          mode: bookingMode,
          requestKind: parsedRequest.kind,
          requestSummary: parsedRequest.summary,
          searchWindowStart: parsedRequest.windowStart,
          searchWindowEnd: parsedRequest.windowEnd,
          requestedSlot,
          requestedAvailable: false,
          selectedSlot: null,
          slots: alternateSlots,
          details: state.details,
          requiredFields: state.requiredFields
        });

        if (!alternateSlots.length) {
          await context.sendReply({
            type: "text",
            text: buildNoAvailabilityText(
              context.node.data,
              context.vars,
              saveAs,
              alternateState,
              buildUnavailablePrefix(context.node.data, context.vars, saveAs, alternateState)
            )
          });
          return {
            signal: "advance",
            nextHandleId: "fail",
            variables: buildRuntimeVariables({
              vars: context.vars,
              saveAs,
              status: "no_availability",
              state: alternateState,
              error: "Requested appointment time is unavailable and no alternate slots were found.",
              clearWizardState: true
            })
          };
        }

        const alternateVars = buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: "awaiting_slot_selection",
          state: alternateState
        });
        await sendSlotSelectionPrompt({
          sendReply: context.sendReply,
          channel: context.channel,
          data: context.node.data,
          vars: alternateVars,
          saveAs,
          state: alternateState,
          prefix: buildUnavailablePrefix(context.node.data, alternateVars, saveAs, alternateState)
        });
        return {
          signal: "stay_waiting",
          variables: alternateVars
        };
      }

      const slots = await buildAvailableSlots({
        userId,
        connectionId,
        calendarId,
        timeZone,
        windowStart: parsedRequest.windowStart,
        windowEnd: parsedRequest.windowEnd,
        slotDurationMinutes,
        slotIntervalMinutes,
        maxOptions
      });

      const selectionState = createWizardState({
        mode: bookingMode,
        requestKind: parsedRequest.kind,
        requestSummary: parsedRequest.summary,
        searchWindowStart: parsedRequest.windowStart,
        searchWindowEnd: parsedRequest.windowEnd,
        requestedSlot,
        requestedAvailable: false,
        selectedSlot: null,
        slots,
        details: state.details,
        requiredFields: state.requiredFields
      });

      if (!slots.length) {
        await context.sendReply({
          type: "text",
          text: buildNoAvailabilityText(context.node.data, context.vars, saveAs, selectionState)
        });
        return {
          signal: "advance",
          nextHandleId: "fail",
          variables: buildRuntimeVariables({
            vars: context.vars,
            saveAs,
            status: "no_availability",
            state: selectionState,
            error: "No free appointment slots were found.",
            clearWizardState: true
          })
        };
      }

      const waitingVars = buildRuntimeVariables({
        vars: context.vars,
        saveAs,
        status: "awaiting_slot_selection",
        state: selectionState
      });
      await sendSlotSelectionPrompt({
        sendReply: context.sendReply,
        channel: context.channel,
        data: context.node.data,
        vars: waitingVars,
        saveAs,
        state: selectionState
      });
      return {
        signal: "stay_waiting",
        variables: waitingVars
      };
    }

    if (state.stage === "slot_selection") {
      const choices = buildSlotsChoiceOptions(state.slots);
      const choice = matchChoiceByMessage(context.message, choices);

      if (!choice) {
        await sendSlotSelectionPrompt({
          sendReply: context.sendReply,
          channel: context.channel,
          data: context.node.data,
          vars: context.vars,
          saveAs,
          state,
          prefix: "Please choose one of the available appointment slots."
        });
        return {
          signal: "stay_waiting",
          variables: buildRuntimeVariables({
            vars: context.vars,
            saveAs,
            status: "awaiting_slot_selection",
            state
          })
        };
      }

      const selectedSlot = state.slots.find((slot) => slot.id === choice.id) ?? null;
      if (!selectedSlot) {
        return {
          signal: "stay_waiting",
          variables: buildRuntimeVariables({
            vars: context.vars,
            saveAs,
            status: "awaiting_slot_selection",
            state
          })
        };
      }

      const slotAvailable = await isSlotAvailable({
        userId,
        connectionId,
        calendarId,
        timeZone,
        slot: selectedSlot
      });

      if (!slotAvailable) {
        const refreshedSlots = await refreshSelectionWindowSlots({
          userId,
          connectionId,
          calendarId,
          timeZone,
          state,
          slotDurationMinutes,
          slotIntervalMinutes,
          maxOptions
        });

        if (!refreshedSlots.length) {
          await context.sendReply({
            type: "text",
            text: buildNoAvailabilityText(
              context.node.data,
              context.vars,
              saveAs,
              {
                ...state,
                slots: [],
                selectedSlot: null
              },
              "That slot was just taken and no other free slots are left in that window."
            )
          });
          return {
            signal: "advance",
            nextHandleId: "fail",
            variables: buildRuntimeVariables({
              vars: context.vars,
              saveAs,
              status: "no_availability",
              state: {
                ...state,
                slots: [],
                selectedSlot: null
              },
              error: "Selected slot is no longer available.",
              clearWizardState: true
            })
          };
        }

        const nextState: CalendarWizardState = {
          ...state,
          stage: "slot_selection",
          selectedSlot: null,
          slots: refreshedSlots
        };
        const nextVars = buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: "awaiting_slot_selection",
          state: nextState
        });

        await sendSlotSelectionPrompt({
          sendReply: context.sendReply,
          channel: context.channel,
          data: context.node.data,
          vars: nextVars,
          saveAs,
          state: nextState,
          prefix: "That slot was just taken. Please choose a different appointment slot."
        });
        return {
          signal: "stay_waiting",
          variables: nextVars
        };
      }

      const selectedState: CalendarWizardState = {
        ...state,
        selectedSlot,
        collectAllDetails: false
      };

      const nextState = await promptNextWizardStep({
        data: context.node.data,
        vars: context.vars,
        saveAs,
        state: selectedState,
        channel: context.channel,
        sendReply: context.sendReply
      });

      return {
        signal: "stay_waiting",
        variables: buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: getWaitingStatusForState(nextState),
          state: nextState
        })
      };
    }

    const detailField = getCurrentFieldForStage(state.stage);
    if (detailField) {
      const normalized = normalizeDetailResponse(detailField, context.message, context.node.data);
      if (!normalized.ok) {
        await context.sendReply({
          type: "text",
          text: normalized.errorText
        });
        return {
          signal: "stay_waiting",
          variables: buildRuntimeVariables({
            vars: context.vars,
            saveAs,
            status: getWaitingStatusForState(state),
            state
          })
        };
      }

      const nextStateBase: CalendarWizardState = {
        ...state,
        details: {
          ...state.details,
          [detailField]: normalized.value
        }
      };
      const nextState = await promptNextWizardStep({
        data: context.node.data,
        vars: context.vars,
        saveAs,
        state: nextStateBase,
        channel: context.channel,
        sendReply: context.sendReply
      });

      return {
        signal: "stay_waiting",
        variables: buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: getWaitingStatusForState(nextState),
          state: nextState
        })
      };
    }

    const reviewChoices = buildReviewChoiceOptions(state.requiredFields);
    const reviewChoice = matchChoiceByMessage(context.message, reviewChoices);

    if (!reviewChoice) {
      await sendReviewPrompt({
        sendReply: context.sendReply,
        channel: context.channel,
        data: context.node.data,
        vars: context.vars,
        saveAs,
        state,
        prefix: "Please choose one of the booking actions below."
      });
      return {
        signal: "stay_waiting",
        variables: buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: getWaitingStatusForState(state),
          state
        })
      };
    }

    if (reviewChoice.id === REVIEW_CANCEL_ID) {
      await context.sendReply({
        type: "text",
        text: buildCancellationText(context.node.data, context.vars, saveAs, state)
      });
      return {
        signal: "advance",
        nextHandleId: "cancelled",
        variables: buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: "cancelled",
          state,
          clearWizardState: true
        })
      };
    }

    if (reviewChoice.id === REVIEW_CHANGE_DETAILS_ID) {
      if (!state.requiredFields.name && !state.requiredFields.email && !state.requiredFields.phone) {
        await sendReviewPrompt({
          sendReply: context.sendReply,
          channel: context.channel,
          data: context.node.data,
          vars: context.vars,
          saveAs,
          state,
          prefix: "No editable booking details are enabled for this block."
        });
        return {
          signal: "stay_waiting",
          variables: buildRuntimeVariables({
            vars: context.vars,
            saveAs,
            status: getWaitingStatusForState(state),
            state
          })
        };
      }

      const detailState: CalendarWizardState = {
        ...state,
        collectAllDetails: true
      };
      const nextState = await promptNextWizardStep({
        data: context.node.data,
        vars: context.vars,
        saveAs,
        state: detailState,
        channel: context.channel,
        sendReply: context.sendReply
      });
      return {
        signal: "stay_waiting",
        variables: buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: getWaitingStatusForState(nextState),
          state: nextState
        })
      };
    }

    if (reviewChoice.id === REVIEW_CHANGE_TIME_ID) {
      const slots = await refreshSelectionWindowSlots({
        userId,
        connectionId,
        calendarId,
        timeZone,
        state,
        slotDurationMinutes,
        slotIntervalMinutes,
        maxOptions
      });

      if (!slots.length) {
        await context.sendReply({
          type: "text",
          text: buildNoAvailabilityText(
            context.node.data,
            context.vars,
            saveAs,
            {
              ...state,
              slots: [],
              selectedSlot: null
            },
            "No other free appointment slots are available right now."
          )
        });
        return {
          signal: "advance",
          nextHandleId: "fail",
          variables: buildRuntimeVariables({
            vars: context.vars,
            saveAs,
            status: "no_availability",
            state: {
              ...state,
              slots: [],
              selectedSlot: null
            },
            error: "No alternate appointment slots are available.",
            clearWizardState: true
          })
        };
      }

      const nextState: CalendarWizardState = {
        ...state,
        stage: "slot_selection",
        selectedSlot: null,
        slots,
        collectAllDetails: false
      };
      const nextVars = buildRuntimeVariables({
        vars: context.vars,
        saveAs,
        status: "awaiting_slot_selection",
        state: nextState
      });

      await sendSlotSelectionPrompt({
        sendReply: context.sendReply,
        channel: context.channel,
        data: context.node.data,
        vars: nextVars,
        saveAs,
        state: nextState,
        prefix: "Please choose a different appointment slot."
      });
      return {
        signal: "stay_waiting",
        variables: nextVars
      };
    }

    const selectedSlot = state.selectedSlot;
    if (!selectedSlot) {
      return {
        signal: "advance",
        nextHandleId: "fail",
        variables: buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: "request_failed",
          state,
          error: "No appointment slot is selected.",
          clearWizardState: true
        })
      };
    }

    const selectedSlotStillAvailable = await isSlotAvailable({
      userId,
      connectionId,
      calendarId,
      timeZone,
      slot: selectedSlot
    });

    if (!selectedSlotStillAvailable) {
      const refreshedSlots = await refreshSelectionWindowSlots({
        userId,
        connectionId,
        calendarId,
        timeZone,
        state,
        slotDurationMinutes,
        slotIntervalMinutes,
        maxOptions
      });

      if (!refreshedSlots.length) {
        await context.sendReply({
          type: "text",
          text: buildNoAvailabilityText(
            context.node.data,
            context.vars,
            saveAs,
            {
              ...state,
              selectedSlot: null,
              slots: []
            },
            "That slot was just taken and no other slots are available now."
          )
        });
        return {
          signal: "advance",
          nextHandleId: "fail",
          variables: buildRuntimeVariables({
            vars: context.vars,
            saveAs,
            status: "no_availability",
            state: {
              ...state,
              selectedSlot: null,
              slots: []
            },
            error: "Selected slot is no longer available.",
            clearWizardState: true
          })
        };
      }

      const nextState: CalendarWizardState = {
        ...state,
        stage: "slot_selection",
        selectedSlot: null,
        slots: refreshedSlots,
        collectAllDetails: false
      };
      const nextVars = buildRuntimeVariables({
        vars: context.vars,
        saveAs,
        status: "awaiting_slot_selection",
        state: nextState
      });
      await sendSlotSelectionPrompt({
        sendReply: context.sendReply,
        channel: context.channel,
        data: context.node.data,
        vars: nextVars,
        saveAs,
        state: nextState,
        prefix: "That slot was just booked by someone else. Please choose a different time."
      });
      return {
        signal: "stay_waiting",
        variables: nextVars
      };
    }

    if (state.mode === "check_only") {
      return {
        signal: "advance",
        nextHandleId: "success",
        variables: buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: "confirmed_available",
          state,
          clearWizardState: true
        })
      };
    }

    try {
      const messageVars = buildMessageVars(context.vars, saveAs, state);
      const event = await createGoogleCalendarEvent({
        userId,
        connectionId,
        calendarId,
        summary:
          interpolate(String(context.node.data.bookingTitle ?? ""), messageVars).trim() || "Appointment",
        description:
          interpolate(String(context.node.data.bookingDescription ?? ""), messageVars).trim() || null,
        location: interpolate(String(context.node.data.location ?? ""), messageVars).trim() || null,
        startTime: selectedSlot.start,
        endTime: selectedSlot.end,
        timeZone,
        attendeeEmail: resolveAttendeeEmail(context.node.data, context.vars, saveAs, state),
        attendeeName: resolveAttendeeName(context.node.data, context.vars, saveAs, state),
        sendUpdates: sanitizeSendUpdates(context.node.data.sendUpdates)
      });

      const successVars = buildRuntimeVariables({
        vars: context.vars,
        saveAs,
        status: "booked",
        state,
        event,
        clearWizardState: true
      });

      const confirmationText =
        interpolate(
          String(
            context.node.data.confirmationMessage ??
              "Your appointment is booked for {{selected_slot_label}}."
          ),
          buildMessageVars(successVars, saveAs, state, {
            event_id: event.id,
            event_status: event.status,
            event_link: event.htmlLink ?? ""
          })
        ).trim() || "Your appointment is booked.";

      await context.sendReply({
        type: "text",
        text: confirmationText
      });

      return {
        signal: "advance",
        nextHandleId: "success",
        variables: successVars
      };
    } catch (error) {
      const message = (error as Error).message;
      await context.sendReply({
        type: "text",
        text: message
      });
      return {
        signal: "advance",
        nextHandleId: "fail",
        variables: buildRuntimeVariables({
          vars: context.vars,
          saveAs,
          status: "request_failed",
          state,
          error: message,
          clearWizardState: true
        })
      };
    }
  }
};
