const runtimeOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:4000";

export const API_URL = import.meta.env.VITE_API_URL || runtimeOrigin;

interface RequestOptions extends RequestInit {
  token?: string | null;
  timeoutMs?: number;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, headers, timeoutMs, ...rest } = options;
  const hasJsonBody = rest.body !== undefined && rest.body !== null && !(rest.body instanceof FormData);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs ?? 60_000);
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
        "x-request-id": requestId,
        ...headers
      }
    });
  } catch (error) {
    window.clearTimeout(timeout);
    if ((error as Error).name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error((payload as { error?: string }).error || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}
