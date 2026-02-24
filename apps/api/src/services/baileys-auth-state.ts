import {
  type AuthenticationState,
  initAuthCreds,
  proto,
  type SignalDataTypeMap
} from "@whiskeysockets/baileys";
import {
  getOrCreateWhatsAppSession,
  saveWhatsAppAuthState
} from "./whatsapp-session-store.js";

interface StoredAuthState {
  creds: ReturnType<typeof initAuthCreds>;
  keys: Record<string, Record<string, unknown>>;
}

const authStateCache = new Map<string, StoredAuthState>();

export function clearAuthStateCache(userId?: string): void {
  if (userId) {
    authStateCache.delete(userId);
    return;
  }
  authStateCache.clear();
}

function reviveBuffers<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => reviveBuffers(item)) as T;
  }

  if (typeof value !== "object") {
    return value;
  }

  const maybeBuffer = value as { type?: string; data?: unknown };
  if (maybeBuffer.type === "Buffer") {
    if (typeof maybeBuffer.data === "string") {
      return Buffer.from(maybeBuffer.data, "base64") as T;
    }
    if (Array.isArray(maybeBuffer.data)) {
      return Buffer.from(maybeBuffer.data) as T;
    }
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = reviveBuffers(nested);
  }

  return output as T;
}

function serializeBuffers<T>(value: T): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return {
      type: "Buffer",
      data: value.toString("base64")
    };
  }

  if (value instanceof Uint8Array) {
    return {
      type: "Buffer",
      data: Buffer.from(value).toString("base64")
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeBuffers(item));
  }

  if (typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = serializeBuffers(nested);
  }

  return output;
}

function normalizeRawAuth(raw: Record<string, unknown>): StoredAuthState {
  const revived = reviveBuffers(raw ?? {}) as Partial<StoredAuthState>;

  return {
    creds: revived.creds ?? initAuthCreds(),
    keys: revived.keys ?? {}
  };
}

async function persist(userId: string, stored: StoredAuthState): Promise<void> {
  const serialized = serializeBuffers(stored) as Record<string, unknown>;
  await saveWhatsAppAuthState(userId, serialized);
}

export async function useDbAuthState(userId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const cached = authStateCache.get(userId);
  const stored = cached ?? normalizeRawAuth((await getOrCreateWhatsAppSession(userId)).session_auth_json);

  if (!cached) {
    authStateCache.set(userId, stored);
  }

  const state: AuthenticationState = {
    creds: stored.creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[]
      ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
        const data = {} as { [id: string]: SignalDataTypeMap[T] };
        for (const id of ids) {
          let value = stored.keys[type]?.[id];
          if (!value) {
            continue;
          }

          if (type === "app-state-sync-key") {
            value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
          }

          data[id] = value as SignalDataTypeMap[T];
        }
        return data;
      },
      set: async (data: { [T in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[T] } }) => {
        for (const [type, entries] of Object.entries(data)) {
          if (!stored.keys[type]) {
            stored.keys[type] = {};
          }

          for (const [id, value] of Object.entries(entries ?? {})) {
            if (value) {
              stored.keys[type][id] = value;
            } else {
              delete stored.keys[type][id];
            }
          }
        }

        await persist(userId, stored);
      }
    }
  };

  return {
    state,
    saveCreds: async () => {
      await persist(userId, stored);
    }
  };
}
