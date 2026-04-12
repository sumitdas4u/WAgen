export const ADMIN_TOKEN_KEY = "super_admin_token";
export const ADMIN_QUEUE_COOKIE = "super_admin_queue_token";

function cookieSecureSuffix(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.protocol === "https:" ? "; Secure" : "";
}

export function setSuperAdminToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
  document.cookie = `${ADMIN_QUEUE_COOKIE}=${encodeURIComponent(token)}; Path=/api/admin/queues; SameSite=Lax${cookieSecureSuffix()}`;
}

export function clearSuperAdminToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  document.cookie = `${ADMIN_QUEUE_COOKIE}=; Path=/api/admin/queues; Max-Age=0; SameSite=Lax${cookieSecureSuffix()}`;
}

export function getStoredSuperAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}
