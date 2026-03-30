import {
  createGoogleCalendarEvent,
  queryGoogleCalendarFreeBusy,
  type GoogleCalendarBusyInterval
} from "../../google-calendar-service.js";
import {
  buildChoicePrompt,
  getNextNodeId,
  interpolate,
  matchChoiceByMessage
} from "../helpers.js";
import type { FlowBlockModule, FlowVariables } from "../types.js";

interface CalendarBookingSlot {
  id: string;
  label: string;
  start: string;
  end: string;
}

type CalendarBookingMode = "suggest_slots" | "check_only" | "book_if_available";

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
  const mode = String(value ?? "").trim();
  if (mode === "check_only" || mode === "book_if_available") {
    return mode;
  }
  return "suggest_slots";
}

function parseDateTime(value: string, label: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid ISO date-time value.`);
  }
  return parsed;
}

function formatSlotLabel(start: string, end: string, timeZone: string | null): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const formatDate = (date: Date, options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: timeZone?.trim() || undefined,
        ...options
      }).format(date);
    } catch {
      return new Intl.DateTimeFormat("en-US", options).format(date);
    }
  };

  const startDay = formatDate(startDate, {
    weekday: "short",
    month: "short",
    day: "2-digit"
  });
  const startTime = formatDate(startDate, {
    hour: "numeric",
    minute: "2-digit"
  });
  const endTime = formatDate(endDate, {
    hour: "numeric",
    minute: "2-digit"
  });

  return `${startDay}, ${startTime} - ${endTime}`;
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
  return {
    id: "requested",
    label: formatSlotLabel(start, end, timeZone),
    start,
    end
  };
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

  for (
    let cursor = startDate.getTime();
    cursor + slotDurationMs <= endDate.getTime() && slots.length < context.maxOptions;
    cursor += slotIntervalMs
  ) {
    const slotEnd = cursor + slotDurationMs;
    if (overlapsBusy(cursor, slotEnd, busyIntervals)) {
      continue;
    }

    const startIso = new Date(cursor).toISOString();
    const endIso = new Date(slotEnd).toISOString();
    slots.push({
      id: String(slots.length + 1),
      label: formatSlotLabel(startIso, endIso, context.timeZone),
      start: startIso,
      end: endIso
    });
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

function buildPromptMessage(promptMessage: string, slots: CalendarBookingSlot[]): string {
  const menu = buildChoicePrompt(
    slots.map((slot) => ({
      id: slot.id,
      label: slot.label
    }))
  );
  const intro = promptMessage.trim() || "Please choose a free appointment slot:";
  return `${intro}\n${menu}`.trim();
}

function buildSelectedSlotVariables(saveAs: string, slot: CalendarBookingSlot): FlowVariables {
  return {
    [`${saveAs}_selected_slot_start`]: slot.start,
    [`${saveAs}_selected_slot_end`]: slot.end,
    [`${saveAs}_selected_slot_label`]: slot.label
  };
}

function buildMessageVars(
  vars: FlowVariables,
  saveAs: string,
  slot: CalendarBookingSlot | null,
  extras: FlowVariables = {}
): FlowVariables {
  if (!slot) {
    return {
      ...vars,
      ...extras
    };
  }

  return {
    ...vars,
    ...buildSelectedSlotVariables(saveAs, slot),
    selected_slot_start: slot.start,
    selected_slot_end: slot.end,
    selected_slot_label: slot.label,
    ...extras
  };
}

function buildStateVariables(input: {
  vars: FlowVariables;
  saveAs: string;
  status: string;
  available: boolean;
  slots?: CalendarBookingSlot[];
  selectedSlot?: CalendarBookingSlot | null;
  payload?: unknown;
  error?: string;
}): FlowVariables {
  const slots = input.slots ?? [];
  const selectedSlotVars = input.selectedSlot
    ? buildSelectedSlotVariables(input.saveAs, input.selectedSlot)
    : {};

  return {
    ...input.vars,
    ...selectedSlotVars,
    [input.saveAs]: JSON.stringify(
      input.payload ?? {
        status: input.status,
        available: input.available,
        slots,
        selectedSlot: input.selectedSlot
          ? {
              start: input.selectedSlot.start,
              end: input.selectedSlot.end,
              label: input.selectedSlot.label
            }
          : null,
        error: input.error || ""
      }
    ),
    [`${input.saveAs}_status`]: input.status,
    [`${input.saveAs}_available`]: input.available,
    [`${input.saveAs}_requested_available`]: input.available,
    [`${input.saveAs}_slot_count`]: slots.length,
    [`${input.saveAs}_slots`]: slots,
    [`${input.saveAs}_error`]: input.error ?? ""
  };
}

function buildPendingVariables(
  vars: FlowVariables,
  saveAs: string,
  status: string,
  slots: CalendarBookingSlot[]
): FlowVariables {
  return buildStateVariables({
    vars,
    saveAs,
    status,
    available: slots.length > 0,
    slots
  });
}

function resolveRequestedSlot(input: {
  data: Record<string, unknown>;
  vars: FlowVariables;
  timeZone: string | null;
}): CalendarBookingSlot {
  const requestedStartValue = interpolate(
    String(input.data.requestedStart ?? ""),
    input.vars
  ).trim();
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

function readPendingSlots(vars: FlowVariables, saveAs: string): CalendarBookingSlot[] {
  const raw = vars[`${saveAs}_slots`];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      const slot = (item ?? {}) as Partial<CalendarBookingSlot>;
      return {
        id: String(slot.id ?? "").trim(),
        label: String(slot.label ?? "").trim(),
        start: String(slot.start ?? "").trim(),
        end: String(slot.end ?? "").trim()
      };
    })
    .filter((slot) => slot.id && slot.label && slot.start && slot.end);
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
    const calendarId = String(context.node.data.calendarId ?? "primary").trim() || "primary";
    const connectionId = String(context.node.data.connectionId ?? "").trim() || null;
    const timeZone = String(context.node.data.timeZone ?? "").trim() || null;
    const slotDurationMinutes = parsePositiveInteger(context.node.data.slotDurationMinutes, 30);

    try {
      if (bookingMode !== "suggest_slots") {
        const requestedSlot = resolveRequestedSlot({
          data: context.node.data,
          vars: context.vars,
          timeZone
        });
        const available = await isSlotAvailable({
          userId,
          connectionId,
          calendarId,
          timeZone,
          slot: requestedSlot
        });

        if (!available) {
          const unavailableVars = buildStateVariables({
            vars: context.vars,
            saveAs,
            status: "unavailable",
            available: false,
            slots: [],
            selectedSlot: requestedSlot,
            error: "Requested appointment time is not available."
          });
          const unavailableMessage = interpolate(
            String(
              context.node.data.unavailableMessage ??
                "That appointment time is not available: {{selected_slot_label}}."
            ),
            buildMessageVars(unavailableVars, saveAs, requestedSlot)
          ).trim();

          if (unavailableMessage) {
            await context.sendReply({
              type: "text",
              text: unavailableMessage
            });
          }

          return {
            signal: "continue",
            nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, "fail"),
            variables: unavailableVars
          };
        }

        if (bookingMode === "check_only") {
          const availableVars = buildStateVariables({
            vars: context.vars,
            saveAs,
            status: "available",
            available: true,
            slots: [requestedSlot],
            selectedSlot: requestedSlot
          });
          const availabilityMessage = interpolate(
            String(
              context.node.data.availabilityMessage ??
                "That appointment time is available: {{selected_slot_label}}."
            ),
            buildMessageVars(availableVars, saveAs, requestedSlot)
          ).trim();

          if (availabilityMessage) {
            await context.sendReply({
              type: "text",
              text: availabilityMessage
            });
          }

          return {
            signal: "continue",
            nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, "success"),
            variables: availableVars
          };
        }

        const varsWithSelection = buildMessageVars(context.vars, saveAs, requestedSlot);
        try {
          const event = await createGoogleCalendarEvent({
            userId,
            connectionId,
            calendarId,
            summary:
              interpolate(String(context.node.data.bookingTitle ?? ""), varsWithSelection).trim() ||
              "Appointment",
            description:
              interpolate(
                String(context.node.data.bookingDescription ?? ""),
                varsWithSelection
              ).trim() || null,
            location:
              interpolate(String(context.node.data.location ?? ""), varsWithSelection).trim() ||
              null,
            startTime: requestedSlot.start,
            endTime: requestedSlot.end,
            timeZone,
            attendeeEmail:
              interpolate(String(context.node.data.attendeeEmail ?? ""), varsWithSelection).trim() ||
              null,
            attendeeName:
              interpolate(String(context.node.data.attendeeName ?? ""), varsWithSelection).trim() ||
              null,
            sendUpdates:
              (String(context.node.data.sendUpdates ?? "all").trim() as
                | "all"
                | "externalOnly"
                | "none") || "all"
          });

          const successVars = {
            ...buildStateVariables({
              vars: context.vars,
              saveAs,
              status: "booked",
              available: true,
              slots: [requestedSlot],
              selectedSlot: requestedSlot,
              payload: event
            }),
            [`${saveAs}_event_id`]: event.id,
            [`${saveAs}_event_status`]: event.status,
            [`${saveAs}_event_link`]: event.htmlLink ?? ""
          };

          const confirmationMessage = interpolate(
            String(
              context.node.data.confirmationMessage ??
                "Your appointment is booked for {{selected_slot_label}}."
            ),
            buildMessageVars(successVars, saveAs, requestedSlot, {
              event_id: event.id,
              event_status: event.status,
              event_link: event.htmlLink ?? ""
            })
          ).trim();

          if (confirmationMessage) {
            await context.sendReply({
              type: "text",
              text: confirmationMessage
            });
          }

          return {
            signal: "continue",
            nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, "success"),
            variables: successVars
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
            variables: buildStateVariables({
              vars: context.vars,
              saveAs,
              status: "request_failed",
              available: false,
              slots: [requestedSlot],
              selectedSlot: requestedSlot,
              error: message
            })
          };
        }
      }

      const windowStart = interpolate(String(context.node.data.windowStart ?? ""), context.vars).trim();
      const windowEnd = interpolate(String(context.node.data.windowEnd ?? ""), context.vars).trim();
      const slotIntervalMinutes = parsePositiveInteger(
        context.node.data.slotIntervalMinutes,
        slotDurationMinutes
      );
      const maxOptions = Math.min(parsePositiveInteger(context.node.data.maxOptions, 5), 10);

      const slots = await buildAvailableSlots({
        userId,
        connectionId,
        calendarId,
        timeZone,
        windowStart,
        windowEnd,
        slotDurationMinutes,
        slotIntervalMinutes,
        maxOptions
      });

      const nextVars = buildPendingVariables(
        context.vars,
        saveAs,
        slots.length > 0 ? "awaiting_selection" : "no_availability",
        slots
      );

      if (slots.length === 0) {
        await context.sendReply({
          type: "text",
          text: "No free appointment slots were found in that time window."
        });
        return {
          signal: "continue",
          nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, "fail"),
          variables: {
            ...nextVars,
            [`${saveAs}_error`]: "No free appointment slots were found."
          }
        };
      }

      await context.sendReply({
        type: "text",
        text: buildPromptMessage(
          interpolate(String(context.node.data.promptMessage ?? ""), context.vars),
          slots
        )
      });

      return {
        signal: "wait",
        waitingFor: "message",
        waitingNodeId: context.node.id,
        variables: nextVars
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
        variables: {
          ...context.vars,
          [saveAs]: JSON.stringify({ status: "request_failed", error: message }),
          [`${saveAs}_status`]: "request_failed",
          [`${saveAs}_available`]: false,
          [`${saveAs}_requested_available`]: false,
          [`${saveAs}_slot_count`]: 0,
          [`${saveAs}_slots`]: [],
          [`${saveAs}_error`]: message
        }
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

    if (bookingMode !== "suggest_slots") {
      return {
        signal: "advance",
        nextHandleId: "fail",
        variables: {
          ...context.vars,
          [`${saveAs}_status`]: "unexpected_wait_state",
          [`${saveAs}_error`]: "This calendar booking step is not waiting for a slot selection."
        }
      };
    }

    const pendingSlots = readPendingSlots(context.vars, saveAs);

    if (pendingSlots.length === 0) {
      return {
        signal: "advance",
        nextHandleId: "fail",
        variables: {
          ...context.vars,
          [`${saveAs}_status`]: "expired",
          [`${saveAs}_error`]: "Appointment slot options are no longer available."
        }
      };
    }

    const choice = matchChoiceByMessage(
      context.message,
      pendingSlots.map((slot) => ({
        id: slot.id,
        label: slot.label
      }))
    );

    if (!choice) {
      await context.sendReply({
        type: "text",
        text: `Please reply with one of the slot numbers.\n${buildChoicePrompt(
          pendingSlots.map((slot) => ({
            id: slot.id,
            label: slot.label
          }))
        )}`
      });
      return {
        signal: "stay_waiting",
        variables: context.vars
      };
    }

    const selectedSlot = pendingSlots.find((slot) => slot.id === choice.id) ?? null;
    if (!selectedSlot) {
      return {
        signal: "stay_waiting",
        variables: context.vars
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
      const refreshedSlots = await buildAvailableSlots({
        userId,
        connectionId,
        calendarId,
        timeZone,
        windowStart: interpolate(String(context.node.data.windowStart ?? ""), context.vars).trim(),
        windowEnd: interpolate(String(context.node.data.windowEnd ?? ""), context.vars).trim(),
        slotDurationMinutes: parsePositiveInteger(context.node.data.slotDurationMinutes, 30),
        slotIntervalMinutes: parsePositiveInteger(
          context.node.data.slotIntervalMinutes,
          parsePositiveInteger(context.node.data.slotDurationMinutes, 30)
        ),
        maxOptions: Math.min(parsePositiveInteger(context.node.data.maxOptions, 5), 10)
      });

      if (refreshedSlots.length === 0) {
        await context.sendReply({
          type: "text",
          text: "That slot is no longer available and no other free slots remain in that time window."
        });
        return {
          signal: "advance",
          nextHandleId: "fail",
          variables: {
            ...buildPendingVariables(context.vars, saveAs, "no_availability", []),
            [`${saveAs}_error`]: "Selected slot is no longer available."
          }
        };
      }

      await context.sendReply({
        type: "text",
        text: `That slot was just taken. Please choose another free slot.\n${buildChoicePrompt(
          refreshedSlots.map((slot) => ({
            id: slot.id,
            label: slot.label
          }))
        )}`
      });
      return {
        signal: "stay_waiting",
        variables: buildPendingVariables(
          context.vars,
          saveAs,
          "awaiting_selection",
          refreshedSlots
        )
      };
    }

    const varsWithSelection = buildMessageVars(context.vars, saveAs, selectedSlot);

    try {
      const event = await createGoogleCalendarEvent({
        userId,
        connectionId,
        calendarId,
        summary:
          interpolate(String(context.node.data.bookingTitle ?? ""), varsWithSelection).trim() ||
          "Appointment",
        description:
          interpolate(String(context.node.data.bookingDescription ?? ""), varsWithSelection).trim() ||
          null,
        location:
          interpolate(String(context.node.data.location ?? ""), varsWithSelection).trim() || null,
        startTime: selectedSlot.start,
        endTime: selectedSlot.end,
        timeZone,
        attendeeEmail:
          interpolate(String(context.node.data.attendeeEmail ?? ""), varsWithSelection).trim() ||
          null,
        attendeeName:
          interpolate(String(context.node.data.attendeeName ?? ""), varsWithSelection).trim() ||
          null,
        sendUpdates:
          (String(context.node.data.sendUpdates ?? "all").trim() as
            | "all"
            | "externalOnly"
            | "none") || "all"
      });

      const successVars = {
        ...buildPendingVariables(context.vars, saveAs, "booked", pendingSlots),
        ...buildSelectedSlotVariables(saveAs, selectedSlot),
        [saveAs]: JSON.stringify(event),
        [`${saveAs}_event_id`]: event.id,
        [`${saveAs}_event_status`]: event.status,
        [`${saveAs}_event_link`]: event.htmlLink ?? "",
        [`${saveAs}_error`]: ""
      };

      const confirmationMessage = interpolate(
        String(
          context.node.data.confirmationMessage ??
            "Your appointment is booked for {{selected_slot_label}}."
        ),
        buildMessageVars(successVars, saveAs, selectedSlot, {
          event_id: event.id,
          event_status: event.status,
          event_link: event.htmlLink ?? ""
        })
      ).trim();

      if (confirmationMessage) {
        await context.sendReply({
          type: "text",
          text: confirmationMessage
        });
      }

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
        variables: {
          ...context.vars,
          ...buildSelectedSlotVariables(saveAs, selectedSlot),
          [saveAs]: JSON.stringify({ status: "request_failed", error: message }),
          [`${saveAs}_status`]: "request_failed",
          [`${saveAs}_error`]: message
        }
      };
    }
  }
};
