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

export function useRealtime(token: string | null, onEvent: (event: RealtimeEvent) => void) {
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const wsBase = toWebSocketBase(API_URL);
    const socket = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`);

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string) as RealtimeEvent;
        onEventRef.current(payload);
      } catch {
        // No-op.
      }
    };

    const keepalive = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send("ping");
      }
    }, 20_000);

    return () => {
      clearInterval(keepalive);
      socket.close();
    };
  }, [token]);
}
