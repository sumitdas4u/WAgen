import { useEffect, useRef } from "react";
import { API_URL } from "./api";

interface RealtimeEvent {
  event: string;
  data: unknown;
}

function toWebSocketBase(url: string): string {
  if (url.startsWith("https://")) {
    return url.replace("https://", "wss://");
  }
  if (url.startsWith("http://")) {
    return url.replace("http://", "ws://");
  }
  return url;
}

const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000];

export function useRealtime(token: string | null, onEvent: (event: RealtimeEvent) => void) {
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let destroyed = false;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) {
        return;
      }

      const wsBase = toWebSocketBase(API_URL);
      socket = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token as string)}`);

      socket.onopen = () => {
        attempt = 0;
        keepalive = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send("ping");
          }
        }, 20_000);
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as RealtimeEvent;
          onEventRef.current(payload);
        } catch {
          // No-op.
        }
      };

      socket.onclose = () => {
        if (keepalive !== null) {
          clearInterval(keepalive);
          keepalive = null;
        }
        if (!destroyed) {
          const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
          attempt += 1;
          reconnectTimer = setTimeout(connect, delay);
        }
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (keepalive !== null) {
        clearInterval(keepalive);
      }
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [token]);
}
