import { useEffect, useRef, useState } from "react";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import { API_URL } from "../../../../shared/api/client";

type TestChatSender = "user" | "bot" | "system";

type TestChatRow = {
  id: string;
  sender: TestChatSender;
  text: string;
  time: string;
};

type WidgetSocketPayload = {
  event?: string;
  data?: {
    sender?: unknown;
    text?: unknown;
    message?: unknown;
  };
};

const TEST_CHAT_RESPONSE_TIMEOUT_MS = 12_000;

function toWebSocketBase(url: string): string {
  if (url.startsWith("https://")) {
    return url.replace("https://", "wss://");
  }
  if (url.startsWith("http://")) {
    return url.replace("http://", "ws://");
  }
  return url;
}

function nowTimeLabel() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function createChatRow(sender: TestChatSender, text: string): TestChatRow {
  return {
    id: `${sender}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sender,
    text,
    time: nowTimeLabel()
  };
}

function createSeedChatRows(): TestChatRow[] {
  return [createChatRow("bot", "Hey, how can I help you today?")];
}

function getWidgetStatusLabel(status: "connecting" | "connected" | "disconnected"): string {
  if (status === "connected") {
    return "connected";
  }
  if (status === "connecting") {
    return "connecting";
  }
  return "reconnecting";
}

function getInputPlaceholder(status: "connecting" | "connected" | "disconnected"): string {
  if (status === "connected") {
    return "Type here...";
  }
  if (status === "connecting") {
    return "Connecting live widget...";
  }
  return "Waiting for live widget to reconnect...";
}

export function Component() {
  const { bootstrap } = useDashboardShell();
  const [testWidgetStatus, setTestWidgetStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [testChatRows, setTestChatRows] = useState<TestChatRow[]>(() => createSeedChatRows());
  const [testChatInput, setTestChatInput] = useState("");
  const [testChatSending, setTestChatSending] = useState(false);
  const widgetTestSocketRef = useRef<WebSocket | null>(null);
  const widgetTestVisitorIdRef = useRef<string>("");
  const widgetReplyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWidgetReplyTimeout = () => {
    if (widgetReplyTimeoutRef.current) {
      clearTimeout(widgetReplyTimeoutRef.current);
      widgetReplyTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    clearWidgetReplyTimeout();
    setTestChatRows(createSeedChatRows());
    setTestChatInput("");
    setTestChatSending(false);

    if (!bootstrap?.userSummary.id) {
      setTestWidgetStatus("disconnected");
      widgetTestSocketRef.current?.close();
      widgetTestSocketRef.current = null;
      return;
    }

    const visitorStorageKey = `wagenai_dashboard_widget_test_${bootstrap.userSummary.id}`;
    const existingVisitorId = window.localStorage.getItem(visitorStorageKey);
    const visitorId = existingVisitorId || `dashboard-test-${Math.random().toString(36).slice(2, 10)}`;
    if (!existingVisitorId) {
      window.localStorage.setItem(visitorStorageKey, visitorId);
    }
    widgetTestVisitorIdRef.current = visitorId;

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectSocket = () => {
      if (disposed) {
        return;
      }

      setTestWidgetStatus("connecting");
      const wsBase = toWebSocketBase(API_URL);
      const socket = new WebSocket(
        `${wsBase}/ws/widget?wid=${encodeURIComponent(bootstrap.userSummary.id)}&visitorId=${encodeURIComponent(visitorId)}`
      );
      widgetTestSocketRef.current = socket;

      socket.onopen = () => {
        if (disposed) {
          return;
        }
        setTestWidgetStatus("connected");
      };

      socket.onmessage = (event) => {
        if (disposed) {
          return;
        }

        try {
          const payload = JSON.parse(event.data as string) as WidgetSocketPayload;
          if (payload.event === "ready") {
            setTestWidgetStatus("connected");
            return;
          }

          const text =
            typeof payload.data?.text === "string"
              ? payload.data.text
              : (typeof payload.data?.message === "string" ? payload.data.message : "");

          if (!text) {
            return;
          }

          const sender: TestChatSender =
            payload.event === "error" || payload.data?.sender === "system" ? "system" : "bot";

          setTestChatRows((current) => [...current, createChatRow(sender, text)]);
          clearWidgetReplyTimeout();
          setTestChatSending(false);
        } catch {
          // Ignore malformed payloads.
        }
      };

      socket.onerror = () => {
        if (disposed) {
          return;
        }
        setTestWidgetStatus("disconnected");
        clearWidgetReplyTimeout();
        setTestChatSending(false);
      };

      socket.onclose = () => {
        if (widgetTestSocketRef.current === socket) {
          widgetTestSocketRef.current = null;
        }
        if (disposed) {
          return;
        }
        setTestWidgetStatus("disconnected");
        clearWidgetReplyTimeout();
        setTestChatSending(false);

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectSocket();
        }, 1500);
      };
    };

    connectSocket();

    return () => {
      disposed = true;
      clearWidgetReplyTimeout();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      widgetTestSocketRef.current?.close();
      widgetTestSocketRef.current = null;
    };
  }, [bootstrap?.userSummary.id]);

  return (
    <section className="finance-shell">
      <article className="finance-panel dashboard-test-page">
        <header className="dashboard-test-page-head">
          <div className="dashboard-test-page-copy">
            <span className="dashboard-test-kicker">Live website widget</span>
            <h2>Test your chatbot</h2>
            <p>
              Send a live widget message, review the answer quality, and confirm that the same conversation appears in Inbox.
            </p>
          </div>
          <div className="dashboard-test-page-meta">
            <span className={testWidgetStatus === "connected" ? "status-badge status-connected" : "status-badge status-not_connected"}>
              Widget channel: {getWidgetStatusLabel(testWidgetStatus)}
            </span>
            <p>System notes in the chat explain when the widget is connected but a live auto-reply was not sent.</p>
          </div>
        </header>

        <div className="dashboard-test-stage">
          <article className="journey-chat-preview dashboard-test-chat-card">
            <header>
              <strong>{bootstrap?.userSummary.name ?? "WAgen AI"}</strong>
            </header>
            <div className="journey-chat-scroll dashboard-test-chat-scroll">
              {testChatRows.map((row) => (
                <div
                  key={row.id}
                  className={row.sender === "user" ? "user-row" : row.sender === "system" ? "system-row" : "bot-row"}
                >
                  <p>{row.text}</p>
                  <small>{row.time}</small>
                </div>
              ))}
              {testChatSending ? <div className="bot-row typing">Waiting for live reply...</div> : null}
            </div>
            <form
              className="journey-chat-input dashboard-test-input"
              onSubmit={(event) => {
                event.preventDefault();
                const message = testChatInput.trim();
                if (!message || !bootstrap?.userSummary.id || testChatSending) {
                  return;
                }

                const socket = widgetTestSocketRef.current;
                if (!socket || socket.readyState !== WebSocket.OPEN) {
                  setTestChatRows((current) => [
                    ...current,
                    createChatRow("system", "The live widget is reconnecting. Please wait a moment and try again.")
                  ]);
                  setTestWidgetStatus("connecting");
                  return;
                }

                setTestChatRows((current) => [...current, createChatRow("user", message)]);
                setTestChatInput("");
                setTestChatSending(true);
                clearWidgetReplyTimeout();
                widgetReplyTimeoutRef.current = setTimeout(() => {
                  setTestChatSending(false);
                  setTestChatRows((current) => [
                    ...current,
                    createChatRow(
                      "system",
                      "We did not receive a live widget reply in time. This usually means the widget is reconnecting, the agent is paused, or the default reply mode is set to manual."
                    )
                  ]);
                  widgetReplyTimeoutRef.current = null;
                }, TEST_CHAT_RESPONSE_TIMEOUT_MS);

                try {
                  socket.send(
                    JSON.stringify({
                      type: "message",
                      wid: bootstrap.userSummary.id,
                      visitorId: widgetTestVisitorIdRef.current,
                      message
                    })
                  );
                } catch (chatError) {
                  clearWidgetReplyTimeout();
                  setTestChatRows((current) => [
                    ...current,
                    createChatRow("system", `I could not send this to the live widget. ${(chatError as Error).message}`)
                  ]);
                  setTestChatSending(false);
                }
              }}
            >
              <input
                placeholder={getInputPlaceholder(testWidgetStatus)}
                value={testChatInput}
                onChange={(event) => setTestChatInput(event.target.value)}
              />
              <button type="submit" aria-label="Send" disabled={testWidgetStatus !== "connected" || testChatSending}>
                {"->"}
              </button>
            </form>
            <small className="journey-powered">Powered by WAgen AI</small>
          </article>

          <div className="dashboard-test-footnote">
            <p>Messages sent here create or update the matching web conversation inside Inbox.</p>
            <p>Replies follow the Default Reply mode set in Web Channel settings — AI, Flow, or Manual.</p>
            <p>If the widget disconnects, this page reconnects automatically and system notes keep the reason visible.</p>
          </div>
        </div>
      </article>
    </section>
  );
}

export function prefetchData() {
  return undefined;
}
