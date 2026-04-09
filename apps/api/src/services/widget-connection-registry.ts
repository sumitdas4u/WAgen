import type { WebSocket } from "ws";

const widgetConnections = new Map<string, Set<WebSocket>>();

function connectionKey(userId: string, visitorId: string): string {
  return `${userId}::${visitorId}`;
}

function normalizeVisitorId(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return "";
  }
  return raw.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 128);
}

function resolveVisitorId(identifier: string): string {
  const trimmed = identifier.trim();
  const rawVisitorId = trimmed.startsWith("web:") ? trimmed.slice("web:".length) : trimmed;
  return normalizeVisitorId(rawVisitorId);
}

export function addWidgetConnection(userId: string, visitorId: string, socket: WebSocket): void {
  const key = connectionKey(userId, visitorId);
  const sockets = widgetConnections.get(key) ?? new Set<WebSocket>();
  sockets.add(socket);
  widgetConnections.set(key, sockets);
}

export function removeWidgetConnection(userId: string, visitorId: string, socket: WebSocket): void {
  const key = connectionKey(userId, visitorId);
  const sockets = widgetConnections.get(key);
  if (!sockets) {
    return;
  }
  sockets.delete(socket);
  if (sockets.size === 0) {
    widgetConnections.delete(key);
  }
}

export function getWidgetConnections(userId: string, customerIdentifier: string): Set<WebSocket> | null {
  const visitorId = resolveVisitorId(customerIdentifier);
  if (!visitorId) {
    return null;
  }
  return widgetConnections.get(connectionKey(userId, visitorId)) ?? null;
}

export function isWidgetVisitorConnected(userId: string, customerIdentifier: string): boolean {
  const sockets = getWidgetConnections(userId, customerIdentifier);
  if (!sockets || sockets.size === 0) {
    return false;
  }

  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      return true;
    }
  }

  return false;
}
