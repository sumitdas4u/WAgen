import { useEffect, useRef, useState } from "react";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import { API_URL } from "../../../../shared/api/client";

type TestChatRow = {
  id: string;
  sender: "user" | "bot";
  text: string;
  time: string;
};

function toWebSocketBase(url: string): string {
  if (url.startsWith("https://")) {
    return url.replace("https://", "wss://");
  }
  if (url.startsWith("http://")) {
    return url.replace("http://", "ws://");
  }
  return url;
}

export function Component() {
  const { bootstrap } = useDashboardShell();
  const [testWidgetStatus, setTestWidgetStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [testChatRows, setTestChatRows] = useState<TestChatRow[]>([]);
  const [testChatInput, setTestChatInput] = useState("");
  const [testChatSending, setTestChatSending] = useState(false);
  const widgetTestSocketRef = useRef<WebSocket | null>(null);
  const widgetTestVisitorIdRef = useRef<string>("");

  useEffect(() => {
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

    setTestWidgetStatus("connecting");
    const wsBase = toWebSocketBase(API_URL);
    const socket = new WebSocket(
      `${wsBase}/ws/widget?wid=${encodeURIComponent(bootstrap.userSummary.id)}&visitorId=${encodeURIComponent(visitorId)}`
    );
    widgetTestSocketRef.current = socket;

    socket.onopen = () => {
      setTestWidgetStatus("connected");
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string) as {
          event?: string;
          data?: { text?: unknown; message?: unknown };
        };
        const text =
          typeof payload.data?.text === "string"
            ? payload.data.text
            : (typeof payload.data?.message === "string" ? payload.data.message : "");

        if ((payload.event === "message" || payload.event === "error") && text) {
          setTestChatRows((current) => [
            ...current,
            {
              id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              sender: "bot",
              text,
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }
          ]);
          setTestChatSending(false);
        }
      } catch {
        // Ignore malformed payloads.
      }
    };

    socket.onerror = () => {
      setTestWidgetStatus("disconnected");
      setTestChatSending(false);
    };

    socket.onclose = () => {
      setTestWidgetStatus("disconnected");
    };

    return () => {
      socket.close();
      if (widgetTestSocketRef.current === socket) {
        widgetTestSocketRef.current = null;
      }
    };
  }, [bootstrap?.userSummary.id]);

  return (
    <section className="finance-shell">
      <article className="finance-panel dashboard-test-chat-overlay">
        <header className="test-chat-overlay-header">
          <div>
            <h2>Test Website Chat (Live)</h2>
            <p>This test uses the same website widget channel. Incoming test messages create or update web conversations in inbox.</p>
          </div>
          <span className={testWidgetStatus === "connected" ? "status-badge status-connected" : "status-badge status-not_connected"}>
            Widget channel: {testWidgetStatus}
          </span>
        </header>
        <article className="journey-chat-preview dashboard-test-chat dashboard-test-chat-overlay">
          <header>
            <strong>{bootstrap?.userSummary.name ?? "WAgen AI"}</strong>
          </header>
          <div className="journey-chat-scroll">
            {testChatRows.map((row) => (
              <div key={row.id} className={row.sender === "bot" ? "bot-row" : "user-row"}>
                <p>{row.text}</p>
                <small>{row.time}</small>
              </div>
            ))}
            {testChatSending ? <div className="bot-row typing">Typing...</div> : null}
          </div>
          <form
            className="journey-chat-input"
            onSubmit={(event) => {
              event.preventDefault();
              const message = testChatInput.trim();
              if (!message || !bootstrap?.userSummary.id || testChatSending) {
                return;
              }

              setTestChatRows((current) => [
                ...current,
                {
                  id: `u-${Date.now()}`,
                  sender: "user",
                  text: message,
                  time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                }
              ]);
              setTestChatInput("");
              setTestChatSending(true);

              try {
                const socket = widgetTestSocketRef.current;
                if (!socket || socket.readyState !== WebSocket.OPEN) {
                  throw new Error("Website widget test channel is not connected yet. Please wait 1-2 seconds.");
                }
                socket.send(
                  JSON.stringify({
                    type: "message",
                    wid: bootstrap.userSummary.id,
                    visitorId: widgetTestVisitorIdRef.current,
                    message
                  })
                );
              } catch (chatError) {
                setTestChatRows((current) => [
                  ...current,
                  {
                    id: `b-${Date.now()}`,
                    sender: "bot",
                    text: `I could not send this to widget channel. ${(chatError as Error).message}`,
                    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  }
                ]);
                setTestChatSending(false);
              }
            }}
          >
            <input
              placeholder="Type here..."
              value={testChatInput}
              onChange={(event) => setTestChatInput(event.target.value)}
            />
            <button type="submit" aria-label="Send">
              {"->"}
            </button>
          </form>
          <small className="journey-powered">Powered by WAgen AI</small>
        </article>
      </article>
    </section>
  );
}

export function prefetchData() {
  return undefined;
}
