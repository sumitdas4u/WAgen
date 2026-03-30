import { useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import {
  disconnectGoogleCalendar,
  fetchGoogleCalendarConfig,
  fetchGoogleCalendars,
  fetchGoogleCalendarStatus,
  startGoogleCalendarConnect,
  type GoogleCalendarConfig,
  type GoogleCalendarStatus,
  type GoogleCalendarSummary
} from "../../../../../../lib/api";
import { NodeHeader, useFlowEditorToken, useNodePatch } from "../editor-shared";
import type { GoogleCalendarBookingData, StudioFlowBlockDefinition } from "../types";

function GoogleCalendarBookingNode({
  id,
  data,
  selected
}: NodeProps<GoogleCalendarBookingData>) {
  const { patch, del } = useNodePatch<GoogleCalendarBookingData>(id);
  const token = useFlowEditorToken();
  const bookingMode = data.bookingMode || "suggest_slots";
  const isSuggestMode = bookingMode === "suggest_slots";
  const isCheckOnlyMode = bookingMode === "check_only";

  const [config, setConfig] = useState<GoogleCalendarConfig | null>(null);
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void Promise.all([fetchGoogleCalendarConfig(token), fetchGoogleCalendarStatus(token)])
      .then(([nextConfig, nextStatus]) => {
        if (cancelled) {
          return;
        }
        setConfig(nextConfig);
        setStatus(nextStatus);
        setStatusMessage(null);
      })
      .catch((error) => {
        if (!cancelled) {
          setStatusMessage((error as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadNonce, token]);

  useEffect(() => {
    const connectionId = status?.connection?.id ?? "";
    if (connectionId && data.connectionId !== connectionId) {
      patch({ connectionId });
    }
  }, [data.connectionId, patch, status?.connection?.id]);

  useEffect(() => {
    if (!token || !config?.configured || !status?.connected) {
      setCalendars([]);
      return;
    }

    let cancelled = false;
    setCatalogLoading(true);
    void fetchGoogleCalendars(token, { connectionId: status.connection?.id ?? null })
      .then((response) => {
        if (!cancelled) {
          setCalendars(response.calendars);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatusMessage((error as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCatalogLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [config?.configured, reloadNonce, status?.connected, status?.connection?.id, token]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const payload = event.data as {
        type?: string;
        message?: string;
      };
      if (payload?.type !== "wagen-google-calendar-oauth") {
        return;
      }
      setOauthLoading(false);
      setStatusMessage(payload.message ?? null);
      setReloadNonce((value) => value + 1);
    };

    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
    };
  }, []);

  const connectGoogle = async () => {
    if (!token) {
      return;
    }

    setOauthLoading(true);
    setStatusMessage(null);
    try {
      const response = await startGoogleCalendarConnect(token);
      const popup = window.open(
        response.url,
        "wagenGoogleCalendarOauth",
        "popup=yes,width=560,height=760"
      );
      if (!popup) {
        setOauthLoading(false);
        setStatusMessage("Popup was blocked. Allow popups and try again.");
      }
    } catch (error) {
      setOauthLoading(false);
      setStatusMessage((error as Error).message);
    }
  };

  const disconnectConnection = async () => {
    if (!token || !status?.connection?.id) {
      return;
    }

    setDisconnecting(true);
    setStatusMessage(null);
    try {
      await disconnectGoogleCalendar(token, { connectionId: status.connection.id });
      patch({
        connectionId: "",
        calendarId: "",
        calendarSummary: ""
      });
      setReloadNonce((value) => value + 1);
    } catch (error) {
      setStatusMessage((error as Error).message);
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className={`fn-node fn-node-googleCalendarBooking${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="GC" title="Google Calendar Booking" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-api-hint" style={{ marginBottom: "0.45rem" }}>
          {isSuggestMode
            ? "Check live availability, show free slots, and book the user's selected appointment."
            : isCheckOnlyMode
              ? "Use date/time captured earlier in the chat flow to check one exact appointment slot."
              : "Use date/time captured earlier in the chat flow to book one exact appointment slot if it is still free."}
        </div>

        <div className="fn-google-connection">
          {loading ? (
            <div className="fn-google-banner">Loading Google Calendar connection...</div>
          ) : !config?.configured ? (
            <div className="fn-google-banner fn-google-banner-error">
              Google Calendar is not configured on the server yet.
            </div>
          ) : status?.connected && status.connection ? (
            <div className="fn-google-banner">
              <div>
                Connected as <strong>{status.connection.googleEmail}</strong>
              </div>
              <div className="fn-google-actions">
                <button
                  type="button"
                  className="fn-btn nodrag"
                  onClick={() => setReloadNonce((value) => value + 1)}
                  disabled={catalogLoading}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="fn-btn nodrag"
                  onClick={connectGoogle}
                  disabled={oauthLoading}
                >
                  {oauthLoading ? "Opening..." : "Reconnect"}
                </button>
                <button
                  type="button"
                  className="fn-btn fn-btn-danger nodrag"
                  onClick={disconnectConnection}
                  disabled={disconnecting}
                >
                  {disconnecting ? "Disconnecting..." : "Disconnect"}
                </button>
              </div>
            </div>
          ) : (
            <div className="fn-google-banner fn-google-banner-warning">
              <div>Connect your Google account to use this block.</div>
              <button
                type="button"
                className="fn-btn fn-btn-primary nodrag"
                onClick={connectGoogle}
                disabled={oauthLoading}
              >
                {oauthLoading ? "Opening..." : "Connect with Google"}
              </button>
            </div>
          )}
          {statusMessage ? <div className="fn-google-note">{statusMessage}</div> : null}
        </div>

        <div className="fn-two">
          <div className="fn-node-field">
            <label className="fn-node-label">CALENDAR</label>
            <select
              className="fn-node-select nodrag"
              value={data.calendarId}
              onChange={(event) => {
                const next = calendars.find((calendar) => calendar.id === event.target.value);
                patch({
                  calendarId: event.target.value,
                  calendarSummary: next?.summary ?? "",
                  timeZone: data.timeZone || next?.timeZone || ""
                });
              }}
              disabled={!status?.connected || catalogLoading}
            >
              <option value="">{catalogLoading ? "Loading calendars..." : "Select a calendar"}</option>
              {data.calendarId && !calendars.some((calendar) => calendar.id === data.calendarId) ? (
                <option value={data.calendarId}>{data.calendarSummary || data.calendarId}</option>
              ) : null}
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.summary}{calendar.primary ? " (Primary)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="fn-node-field">
            <label className="fn-node-label">MODE</label>
            <select
              className="fn-node-select nodrag"
              value={bookingMode}
              onChange={(event) =>
                patch({
                  bookingMode: event.target.value as GoogleCalendarBookingData["bookingMode"]
                })
              }
            >
              <option value="suggest_slots">Suggest free slots</option>
              <option value="check_only">Check requested time</option>
              <option value="book_if_available">Book requested time</option>
            </select>
          </div>
        </div>

        <div className="fn-two">
          <div className="fn-node-field">
            <label className="fn-node-label">TIME ZONE</label>
            <input
              className="fn-node-input nodrag"
              value={data.timeZone}
              onChange={(event) => patch({ timeZone: event.target.value })}
              placeholder="Asia/Kolkata"
            />
          </div>
          <div className="fn-node-field">
            <label className="fn-node-label">SAVE AS</label>
            <input
              className="fn-node-input nodrag"
              value={data.saveAs}
              onChange={(event) => patch({ saveAs: event.target.value })}
              placeholder="google_calendar_booking"
            />
          </div>
        </div>

        {isSuggestMode ? (
          <>
            <div className="fn-two">
              <div className="fn-node-field">
                <label className="fn-node-label">WINDOW START</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.windowStart}
                  onChange={(event) => patch({ windowStart: event.target.value })}
                  placeholder="2026-04-01T09:00:00+05:30"
                />
              </div>
              <div className="fn-node-field">
                <label className="fn-node-label">WINDOW END</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.windowEnd}
                  onChange={(event) => patch({ windowEnd: event.target.value })}
                  placeholder="2026-04-01T18:00:00+05:30"
                />
              </div>
            </div>

            <div className="fn-three">
              <div className="fn-node-field">
                <label className="fn-node-label">SLOT MINS</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.slotDurationMinutes}
                  onChange={(event) => patch({ slotDurationMinutes: event.target.value })}
                  placeholder="30"
                />
              </div>
              <div className="fn-node-field">
                <label className="fn-node-label">STEP MINS</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.slotIntervalMinutes}
                  onChange={(event) => patch({ slotIntervalMinutes: event.target.value })}
                  placeholder="30"
                />
              </div>
              <div className="fn-node-field">
                <label className="fn-node-label">MAX OPTIONS</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.maxOptions}
                  onChange={(event) => patch({ maxOptions: event.target.value })}
                  placeholder="5"
                />
              </div>
            </div>

            <div className="fn-node-field">
              <label className="fn-node-label">PROMPT MESSAGE</label>
              <textarea
                className="fn-node-textarea nodrag"
                rows={3}
                value={data.promptMessage}
                onChange={(event) => patch({ promptMessage: event.target.value })}
                placeholder="Please choose one of these appointment slots:"
              />
            </div>
          </>
        ) : (
          <>
            <div className="fn-two">
              <div className="fn-node-field">
                <label className="fn-node-label">REQUESTED START</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.requestedStart}
                  onChange={(event) => patch({ requestedStart: event.target.value })}
                  placeholder="{{appointment_start}}"
                />
              </div>
              <div className="fn-node-field">
                <label className="fn-node-label">REQUESTED END</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.requestedEnd}
                  onChange={(event) => patch({ requestedEnd: event.target.value })}
                  placeholder="{{appointment_end}}"
                />
              </div>
            </div>

            <div className="fn-node-field">
              <label className="fn-node-label">SLOT MINS</label>
              <input
                className="fn-node-input nodrag"
                value={data.slotDurationMinutes}
                onChange={(event) => patch({ slotDurationMinutes: event.target.value })}
                placeholder="30"
              />
            </div>

            <div className="fn-node-field">
              <label className="fn-node-label">AVAILABLE MESSAGE</label>
              <textarea
                className="fn-node-textarea nodrag"
                rows={3}
                value={data.availabilityMessage}
                onChange={(event) => patch({ availabilityMessage: event.target.value })}
                placeholder="That appointment time is available: {{selected_slot_label}}."
              />
            </div>

            <div className="fn-node-field">
              <label className="fn-node-label">UNAVAILABLE MESSAGE</label>
              <textarea
                className="fn-node-textarea nodrag"
                rows={3}
                value={data.unavailableMessage}
                onChange={(event) => patch({ unavailableMessage: event.target.value })}
                placeholder="That appointment time is not available: {{selected_slot_label}}."
              />
            </div>
          </>
        )}

        {!isCheckOnlyMode ? (
          <>
            <div className="fn-node-field">
              <label className="fn-node-label">BOOKING TITLE</label>
              <input
                className="fn-node-input nodrag"
                value={data.bookingTitle}
                onChange={(event) => patch({ bookingTitle: event.target.value })}
                placeholder="Appointment for {{name}}"
              />
            </div>

            <div className="fn-node-field">
              <label className="fn-node-label">BOOKING DESCRIPTION</label>
              <textarea
                className="fn-node-textarea nodrag"
                rows={3}
                value={data.bookingDescription}
                onChange={(event) => patch({ bookingDescription: event.target.value })}
                placeholder="Lead details: {{phone}}"
              />
            </div>

            <div className="fn-node-field">
              <label className="fn-node-label">CONFIRMATION MESSAGE</label>
              <textarea
                className="fn-node-textarea nodrag"
                rows={3}
                value={data.confirmationMessage}
                onChange={(event) => patch({ confirmationMessage: event.target.value })}
                placeholder="Your appointment is booked for {{selected_slot_label}}."
              />
            </div>

            <div className="fn-two">
              <div className="fn-node-field">
                <label className="fn-node-label">ATTENDEE EMAIL</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.attendeeEmail}
                  onChange={(event) => patch({ attendeeEmail: event.target.value })}
                  placeholder="{{email}}"
                />
              </div>
              <div className="fn-node-field">
                <label className="fn-node-label">ATTENDEE NAME</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.attendeeName}
                  onChange={(event) => patch({ attendeeName: event.target.value })}
                  placeholder="{{name}}"
                />
              </div>
            </div>

            <div className="fn-two">
              <div className="fn-node-field">
                <label className="fn-node-label">LOCATION</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.location}
                  onChange={(event) => patch({ location: event.target.value })}
                  placeholder="Google Meet / Office"
                />
              </div>
              <div className="fn-node-field">
                <label className="fn-node-label">SEND UPDATES</label>
                <select
                  className="fn-node-select nodrag"
                  value={data.sendUpdates}
                  onChange={(event) =>
                    patch({
                      sendUpdates: event.target.value as GoogleCalendarBookingData["sendUpdates"]
                    })
                  }
                >
                  <option value="all">All attendees</option>
                  <option value="externalOnly">External only</option>
                  <option value="none">Do not send</option>
                </select>
              </div>
            </div>
          </>
        ) : null}

        <div className="fn-api-hint" style={{ marginBottom: "0.4rem" }}>
          Use full ISO date-times, for example
          {" "}
          <code style={{ fontSize: "0.65rem" }}>2026-04-01T09:00:00+05:30</code>.
          You can inject chat flow variables like
          {" "}
          <code style={{ fontSize: "0.65rem" }}>{`{{appointment_start}}`}</code>.
          {!isSuggestMode ? " Leave requested end blank to use the slot duration." : ""}
        </div>

        <div className="fn-api-outputs">
          <div className="fn-api-branch">
            <span className="fn-cond-dot fn-cond-dot-true" />
            <span>{isCheckOnlyMode ? "Available" : "Booked"}</span>
            <Handle
              type="source"
              position={Position.Right}
              id="success"
              className="fn-handle-out fn-handle-success"
              style={{ position: "absolute", right: -7 }}
            />
          </div>
          <div className="fn-api-branch">
            <span className="fn-cond-dot fn-cond-dot-false" />
            <span>{isCheckOnlyMode ? "Unavailable / Failed" : "No Slot / Failed"}</span>
            <Handle
              type="source"
              position={Position.Right}
              id="fail"
              className="fn-handle-out fn-handle-fail"
              style={{ position: "absolute", right: -7 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const googleCalendarBookingStudioBlock: StudioFlowBlockDefinition<GoogleCalendarBookingData> =
  {
    kind: "googleCalendarBooking",
    channels: ["web", "qr", "api"],
    catalog: {
      kind: "googleCalendarBooking",
      icon: "GC",
      name: "Google Calendar Booking",
      desc: "Check availability and book appointments",
      section: "Actions",
      availableInPalette: true,
      status: "active"
    },
    createDefaultData() {
      return {
        kind: "googleCalendarBooking",
        connectionId: "",
        calendarId: "",
        calendarSummary: "",
        bookingMode: "suggest_slots",
        timeZone: "Asia/Kolkata",
        windowStart: "",
        windowEnd: "",
        requestedStart: "",
        requestedEnd: "",
        slotDurationMinutes: "30",
        slotIntervalMinutes: "30",
        maxOptions: "5",
        promptMessage: "Please choose one of these appointment slots:",
        availabilityMessage: "That appointment time is available: {{selected_slot_label}}.",
        unavailableMessage: "That appointment time is not available: {{selected_slot_label}}.",
        bookingTitle: "Appointment",
        bookingDescription: "",
        confirmationMessage: "Your appointment is booked for {{selected_slot_label}}.",
        attendeeEmail: "",
        attendeeName: "",
        location: "",
        sendUpdates: "all",
        saveAs: "google_calendar_booking"
      };
    },
    NodeComponent: GoogleCalendarBookingNode
  };
