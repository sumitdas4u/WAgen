import { useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import {
  disconnectGoogleCalendar,
  fetchGoogleCalendarConfig,
  fetchGoogleCalendarConnectionById,
  fetchGoogleCalendars,
  fetchGoogleCalendarStatus,
  startGoogleCalendarConnect,
  type GoogleCalendarConfig,
  type GoogleCalendarStatus,
  type GoogleCalendarSummary
} from "../../../../../../lib/api";
import { NodeHeader, useFlowEditorToken, useNodePatch } from "../editor-shared";
import type { GoogleCalendarBookingData, StudioFlowBlockDefinition } from "../types";

const MODE_LABELS: Record<GoogleCalendarBookingData["bookingMode"], string> = {
  suggest_slots: "Suggest & Book Slots",
  check_only: "Check Requested Time",
  book_if_available: "Book Requested Time"
};

const TIME_INPUT_LABELS: Record<GoogleCalendarBookingData["timeInputMode"], string> = {
  prefilled: "Use Node Fields / Variables",
  ask_user: "Ask User In Chat"
};

function GoogleCalendarBookingNode({
  id,
  data,
  selected
}: NodeProps<GoogleCalendarBookingData>) {
  const { patch, del } = useNodePatch<GoogleCalendarBookingData>(id);
  const token = useFlowEditorToken();
  const bookingMode = data.bookingMode || "suggest_slots";
  const timeInputMode = data.timeInputMode || "prefilled";
  const isSuggestMode = bookingMode === "suggest_slots";
  const isCheckOnlyMode = bookingMode === "check_only";
  const isPromptMode = timeInputMode === "ask_user";

  const [config, setConfig] = useState<GoogleCalendarConfig | null>(null);
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [storedConnection, setStoredConnection] = useState<{ id: string; googleEmail: string; displayName: string | null; status: string } | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Active connection: stored node's connectionId first, then current user's
  const activeConnectionId = data.connectionId || status?.connection?.id || null;

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void Promise.all([fetchGoogleCalendarConfig(token), fetchGoogleCalendarStatus(token)])
      .then(([nextConfig, nextStatus]) => {
        if (!cancelled) { setConfig(nextConfig); setStatus(nextStatus); setStatusMessage(null); }
      })
      .catch((error) => { if (!cancelled) setStatusMessage((error as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadNonce, token]);

  // Fetch stored connection info (may belong to another user)
  useEffect(() => {
    if (!token || !data.connectionId) { setStoredConnection(null); return; }
    let cancelled = false;
    void fetchGoogleCalendarConnectionById(token, data.connectionId)
      .then((r) => { if (!cancelled) setStoredConnection(r.connection); })
      .catch(() => { if (!cancelled) setStoredConnection(null); });
    return () => { cancelled = true; };
  }, [token, data.connectionId, reloadNonce]);

  // Only auto-set connectionId when the node has none yet (first-time connect)
  useEffect(() => {
    const cid = status?.connection?.id ?? "";
    if (cid && !data.connectionId) patch({ connectionId: cid });
  }, [data.connectionId, patch, status?.connection?.id]);

  useEffect(() => {
    if (!token || !config?.configured || !activeConnectionId) {
      setCalendars([]);
      return;
    }

    let cancelled = false;
    setCatalogLoading(true);

    void fetchGoogleCalendars(token, { connectionId: activeConnectionId })
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
      const payload = event.data as { type?: string; message?: string };
      if (payload?.type !== "wagen-google-calendar-oauth") return;
      setOauthLoading(false);
      setStatusMessage(payload.message ?? null);
      // Clear stored connectionId so the auto-sync picks up the newly connected account
      patch({ connectionId: "", calendarId: "", calendarSummary: "" });
      setReloadNonce((value) => value + 1);
    };
    window.addEventListener("message", listener);
    return () => { window.removeEventListener("message", listener); };
  }, [patch]);

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

  const toggleRequiredField = (field: "requireName" | "requireEmail" | "requirePhone") =>
    patch({ [field]: !data[field] } as Partial<GoogleCalendarBookingData>);

  return (
    <div className={`fn-node fn-node-googleCalendarBooking${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="📅" title="Google Calendar Scheduler" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-api-hint" style={{ marginBottom: "0.45rem" }}>
          {isPromptMode
            ? "Ask the contact for a preferred appointment time or time range, parse the reply, then continue the scheduling wizard automatically."
            : isSuggestMode
            ? "Show live free slots, collect booking details, confirm, and create the Google Calendar event."
            : isCheckOnlyMode
              ? "Check a requested chat time, suggest alternates if needed, and save the confirmed slot for the next flow step."
              : "Check a requested chat time, suggest alternates if needed, then confirm and book the slot in Google Calendar."}
        </div>

        <div className="fn-google-connection">
          {loading ? (
            <div className="fn-google-banner">Loading Google Calendar connection...</div>
          ) : !config?.configured ? (
            <div className="fn-google-banner fn-google-banner-error">
              Google Calendar is not configured on the server yet.
            </div>
          ) : (storedConnection ?? status?.connection) ? (
            <div className="fn-google-banner">
              <div>
                Using <strong>{storedConnection?.googleEmail ?? status?.connection?.googleEmail}</strong>
                {storedConnection && storedConnection.id !== status?.connection?.id && (
                  <span style={{ fontSize: "0.65rem", color: "#6b7280", marginLeft: "0.35rem" }}>(connected by another user)</span>
                )}
              </div>
              <div className="fn-google-actions">
                <button type="button" className="fn-btn nodrag" onClick={() => setReloadNonce((v) => v + 1)} disabled={catalogLoading}>Refresh</button>
                {status?.connected ? (
                  <>
                    <button type="button" className="fn-btn nodrag" onClick={connectGoogle} disabled={oauthLoading}>{oauthLoading ? "Opening..." : "Use My Account"}</button>
                    <button type="button" className="fn-btn fn-btn-danger nodrag" onClick={disconnectConnection} disabled={disconnecting}>{disconnecting ? "..." : "Disconnect"}</button>
                  </>
                ) : (
                  <button type="button" className="fn-btn fn-btn-primary nodrag" onClick={connectGoogle} disabled={oauthLoading}>{oauthLoading ? "Opening..." : "Connect My Account"}</button>
                )}
              </div>
            </div>
          ) : (
            <div className="fn-google-banner fn-google-banner-warning">
              <div>Connect your Google account to use this block.</div>
              <button type="button" className="fn-btn fn-btn-primary nodrag" onClick={connectGoogle} disabled={oauthLoading}>
                {oauthLoading ? "Opening..." : "Connect with Google"}
              </button>
            </div>
          )}
          {statusMessage ? <div className="fn-google-note">{statusMessage}</div> : null}
        </div>

        <div className="fn-section">
          <div className="fn-node-label">BASIC</div>
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
                    {calendar.summary}
                    {calendar.primary ? " (Primary)" : ""}
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
                <option value="suggest_slots">{MODE_LABELS.suggest_slots}</option>
                <option value="check_only">{MODE_LABELS.check_only}</option>
                <option value="book_if_available">{MODE_LABELS.book_if_available}</option>
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
        </div>

        <div className="fn-section">
          <div className="fn-node-label">SCHEDULING</div>
          <div className="fn-two">
            <div className="fn-node-field">
              <label className="fn-node-label">TIME INPUT</label>
              <select
                className="fn-node-select nodrag"
                value={timeInputMode}
                onChange={(event) =>
                  patch({
                    timeInputMode: event.target.value as GoogleCalendarBookingData["timeInputMode"]
                  })
                }
              >
                <option value="prefilled">{TIME_INPUT_LABELS.prefilled}</option>
                <option value="ask_user">{TIME_INPUT_LABELS.ask_user}</option>
              </select>
            </div>
            <div className="fn-node-field">
              <label className="fn-node-label">SEARCH WINDOW HRS</label>
              <input
                className="fn-node-input nodrag"
                value={data.promptSearchWindowHours}
                onChange={(event) => patch({ promptSearchWindowHours: event.target.value })}
                placeholder="6"
              />
            </div>
          </div>

          {isPromptMode ? (
            <>
              <div className="fn-node-field">
                <label className="fn-node-label">TIME REQUEST PROMPT</label>
                <textarea
                  className="fn-node-textarea nodrag"
                  rows={3}
                  value={data.timeRequestPrompt}
                  onChange={(event) => patch({ timeRequestPrompt: event.target.value })}
                  placeholder="Please share your preferred appointment time or time range. Example: tomorrow 3 PM or tomorrow between 2 PM and 5 PM."
                />
              </div>
              <div className="fn-node-field">
                <label className="fn-node-label">INVALID TIME MESSAGE</label>
                <textarea
                  className="fn-node-textarea nodrag"
                  rows={2}
                  value={data.invalidTimeRequestMessage}
                  onChange={(event) => patch({ invalidTimeRequestMessage: event.target.value })}
                  placeholder="I couldn't understand that timing. Please share a clear date/time or time range."
                />
              </div>
            </>
          ) : isSuggestMode ? (
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

              <div className="fn-two">
                <div className="fn-node-field">
                  <label className="fn-node-label">ALT WINDOW START</label>
                  <input
                    className="fn-node-input nodrag"
                    value={data.alternateWindowStart}
                    onChange={(event) => patch({ alternateWindowStart: event.target.value })}
                    placeholder="2026-04-01T09:00:00+05:30"
                  />
                </div>
                <div className="fn-node-field">
                  <label className="fn-node-label">ALT WINDOW END</label>
                  <input
                    className="fn-node-input nodrag"
                    value={data.alternateWindowEnd}
                    onChange={(event) => patch({ alternateWindowEnd: event.target.value })}
                    placeholder="2026-04-01T18:00:00+05:30"
                  />
                </div>
              </div>
            </>
          )}

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
            <label className="fn-node-label">SLOT PROMPT</label>
            <textarea
              className="fn-node-textarea nodrag"
              rows={3}
              value={data.promptMessage}
              onChange={(event) => patch({ promptMessage: event.target.value })}
              placeholder="Please choose one of these appointment slots."
            />
          </div>

          {!isSuggestMode ? (
            <>
              <div className="fn-node-field">
                <label className="fn-node-label">AVAILABLE MESSAGE</label>
                <textarea
                  className="fn-node-textarea nodrag"
                  rows={2}
                  value={data.availabilityMessage}
                  onChange={(event) => patch({ availabilityMessage: event.target.value })}
                  placeholder="That appointment time is available: {{selected_slot_label}}."
                />
              </div>
              <div className="fn-node-field">
                <label className="fn-node-label">UNAVAILABLE MESSAGE</label>
                <textarea
                  className="fn-node-textarea nodrag"
                  rows={2}
                  value={data.unavailableMessage}
                  onChange={(event) => patch({ unavailableMessage: event.target.value })}
                  placeholder="That appointment time is no longer available: {{requested_slot_label}}."
                />
              </div>
            </>
          ) : null}
        </div>

        <div className="fn-section">
          <div className="fn-node-label">DETAILS</div>
          <div className="fn-api-hint" style={{ marginBottom: "0.35rem" }}>
            Turn on only the details you want this block to collect inside the booking wizard.
          </div>
          <div className="fn-three">
            <label className="fn-node-field" style={{ display: "flex", gap: "0.45rem", alignItems: "center" }}>
              <input
                type="checkbox"
                className="nodrag"
                checked={data.requireName}
                onChange={() => toggleRequiredField("requireName")}
              />
              <span className="fn-node-label" style={{ margin: 0 }}>Collect Name</span>
            </label>
            <label className="fn-node-field" style={{ display: "flex", gap: "0.45rem", alignItems: "center" }}>
              <input
                type="checkbox"
                className="nodrag"
                checked={data.requireEmail}
                onChange={() => toggleRequiredField("requireEmail")}
              />
              <span className="fn-node-label" style={{ margin: 0 }}>Collect Email</span>
            </label>
            <label className="fn-node-field" style={{ display: "flex", gap: "0.45rem", alignItems: "center" }}>
              <input
                type="checkbox"
                className="nodrag"
                checked={data.requirePhone}
                onChange={() => toggleRequiredField("requirePhone")}
              />
              <span className="fn-node-label" style={{ margin: 0 }}>Collect Phone</span>
            </label>
          </div>
        </div>

        {!isCheckOnlyMode ? (
          <div className="fn-section">
            <div className="fn-node-label">BOOKING EVENT</div>
            <div className="fn-node-field">
              <label className="fn-node-label">BOOKING TITLE</label>
              <input
                className="fn-node-input nodrag"
                value={data.bookingTitle}
                onChange={(event) => patch({ bookingTitle: event.target.value })}
                placeholder="Appointment for {{booking_name}}"
              />
            </div>
            <div className="fn-node-field">
              <label className="fn-node-label">BOOKING DESCRIPTION</label>
              <textarea
                className="fn-node-textarea nodrag"
                rows={3}
                value={data.bookingDescription}
                onChange={(event) => patch({ bookingDescription: event.target.value })}
                placeholder="Lead details: {{booking_phone}}"
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
          </div>
        ) : null}

        <div className="fn-section">
          <div className="fn-node-label">ADVANCED</div>
          <div className="fn-node-field">
            <label className="fn-node-label">REVIEW MESSAGE</label>
            <textarea
              className="fn-node-textarea nodrag"
              rows={4}
              value={data.reviewMessage}
              onChange={(event) => patch({ reviewMessage: event.target.value })}
              placeholder={"Please review the appointment details:\nSlot: {{selected_slot_label}}\nName: {{booking_name}}"}
            />
          </div>
          <div className="fn-two">
            <div className="fn-node-field">
              <label className="fn-node-label">NO AVAILABILITY</label>
              <textarea
                className="fn-node-textarea nodrag"
                rows={3}
                value={data.noAvailabilityMessage}
                onChange={(event) => patch({ noAvailabilityMessage: event.target.value })}
                placeholder="No free appointment slots were found in that time window."
              />
            </div>
            <div className="fn-node-field">
              <label className="fn-node-label">CANCELLATION</label>
              <textarea
                className="fn-node-textarea nodrag"
                rows={3}
                value={data.cancellationMessage}
                onChange={(event) => patch({ cancellationMessage: event.target.value })}
                placeholder="Appointment booking was cancelled."
              />
            </div>
          </div>

          {data.requireName ? (
            <div className="fn-node-field">
              <label className="fn-node-label">NAME PROMPT</label>
              <input
                className="fn-node-input nodrag"
                value={data.namePrompt}
                onChange={(event) => patch({ namePrompt: event.target.value })}
                placeholder="Please share the attendee name."
              />
            </div>
          ) : null}

          {data.requireEmail ? (
            <div className="fn-two">
              <div className="fn-node-field">
                <label className="fn-node-label">EMAIL PROMPT</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.emailPrompt}
                  onChange={(event) => patch({ emailPrompt: event.target.value })}
                  placeholder="Please share the attendee email address."
                />
              </div>
              <div className="fn-node-field">
                <label className="fn-node-label">INVALID EMAIL</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.invalidEmailMessage}
                  onChange={(event) => patch({ invalidEmailMessage: event.target.value })}
                  placeholder="Please enter a valid email address."
                />
              </div>
            </div>
          ) : null}

          {data.requirePhone ? (
            <div className="fn-two">
              <div className="fn-node-field">
                <label className="fn-node-label">PHONE PROMPT</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.phonePrompt}
                  onChange={(event) => patch({ phonePrompt: event.target.value })}
                  placeholder="Please share the attendee phone number."
                />
              </div>
              <div className="fn-node-field">
                <label className="fn-node-label">INVALID PHONE</label>
                <input
                  className="fn-node-input nodrag"
                  value={data.invalidPhoneMessage}
                  onChange={(event) => patch({ invalidPhoneMessage: event.target.value })}
                  placeholder="Please enter a valid phone number."
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="fn-api-hint" style={{ marginBottom: "0.4rem" }}>
          {isPromptMode ? (
            <>
              The block will ask the user for a preferred time or time range, then parse that reply and search availability automatically.
              If the user gives one exact time, the scheduler searches nearby slots inside the configured search window hours.
            </>
          ) : (
            <>
              Use full ISO date-times like <code style={{ fontSize: "0.65rem" }}>2026-04-01T09:00:00+05:30</code>.
              You can pass chat-captured values such as <code style={{ fontSize: "0.65rem" }}>{`{{appointment_start}}`}</code>.
              {!isSuggestMode ? " If the requested time is busy, the block searches the alternate window and keeps the booking wizard going." : ""}
            </>
          )}
        </div>

        <div className="fn-api-outputs">
          <div className="fn-api-branch">
            <span className="fn-cond-dot fn-cond-dot-true" />
            <span>{isCheckOnlyMode ? "Confirmed Available" : "Booked"}</span>
            <Handle
              type="source"
              position={Position.Right}
              id="success"
              className="fn-handle-out fn-handle-success"
              style={{ position: "absolute", right: -7 }}
            />
          </div>
          <div className="fn-api-branch">
            <span className="fn-cond-dot" style={{ background: "#f59e0b" }} />
            <span>Cancelled</span>
            <Handle
              type="source"
              position={Position.Right}
              id="cancelled"
              className="fn-handle-out"
              style={{ position: "absolute", right: -7, background: "#f59e0b", borderColor: "#f59e0b" }}
            />
          </div>
          <div className="fn-api-branch">
            <span className="fn-cond-dot fn-cond-dot-false" />
            <span>Failed / No Slot</span>
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

export const googleCalendarBookingStudioBlock: StudioFlowBlockDefinition<GoogleCalendarBookingData> = {
  kind: "googleCalendarBooking",
  channels: ["web", "qr", "api"],
  catalog: {
    kind: "googleCalendarBooking",
    icon: "📅",
    name: "Google Calendar Scheduler",
    desc: "Suggest, confirm, and book appointment slots",
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
      timeInputMode: "prefilled",
      timeZone: "Asia/Kolkata",
      windowStart: "",
      windowEnd: "",
      alternateWindowStart: "",
      alternateWindowEnd: "",
      requestedStart: "",
      requestedEnd: "",
      timeRequestPrompt:
        "Please share your preferred appointment time or time range. Example: tomorrow 3 PM or tomorrow between 2 PM and 5 PM.",
      invalidTimeRequestMessage:
        "I couldn't understand that timing yet. Please share a clear date/time or a time range.",
      promptSearchWindowHours: "6",
      slotDurationMinutes: "30",
      slotIntervalMinutes: "30",
      maxOptions: "5",
      promptMessage: "Please choose one of these appointment slots.",
      availabilityMessage: "That appointment time is available: {{selected_slot_label}}.",
      unavailableMessage: "That appointment time is no longer available: {{requested_slot_label}}.",
      reviewMessage:
        "Please review the appointment details:\nSlot: {{selected_slot_label}}\nName: {{booking_name}}\nEmail: {{booking_email}}\nPhone: {{booking_phone}}",
      noAvailabilityMessage: "No free appointment slots were found in that time window.",
      requireName: false,
      requireEmail: false,
      requirePhone: false,
      namePrompt: "Please share the attendee name.",
      emailPrompt: "Please share the attendee email address.",
      phonePrompt: "Please share the attendee phone number.",
      invalidEmailMessage: "Please enter a valid email address.",
      invalidPhoneMessage: "Please enter a valid phone number.",
      cancellationMessage: "Appointment booking was cancelled.",
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
