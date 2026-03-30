import { env } from "../config/env.js";
import { decryptJsonPayload, encryptJsonPayload } from "../utils/encryption.js";
import type { User } from "../types/models.js";

interface GoogleAuthState {
  mode: "login" | "signup";
  businessType?: string | null;
  createdAt: number;
}

interface GoogleTokenResponse {
  access_token?: string;
}

interface GoogleAuthUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

const GOOGLE_AUTH_SCOPES = ["openid", "email", "profile"] as const;

function getGoogleAuthClientId(): string {
  return (
    env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ||
    env.GOOGLE_SHEETS_CLIENT_ID?.trim() ||
    ""
  );
}

function getGoogleAuthClientSecret(): string {
  return (
    env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ||
    env.GOOGLE_SHEETS_CLIENT_SECRET?.trim() ||
    ""
  );
}

function getGoogleAuthStateSecret(): string {
  return (
    env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY?.trim() ||
    env.GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY?.trim() ||
    env.JWT_SECRET
  );
}

function ensureGoogleAuthConfigured(): void {
  if (!getGoogleAuthClientId() || !getGoogleAuthClientSecret()) {
    throw new Error(
      "Google login is not configured. Set Google OAuth credentials on the server first."
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  const params = new URLSearchParams({
    code,
    client_id: getGoogleAuthClientId(),
    client_secret: getGoogleAuthClientSecret(),
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || "Google token exchange failed.");
  }

  return (await response.json()) as GoogleTokenResponse;
}

async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleAuthUserInfo> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || "Unable to fetch Google user profile.");
  }

  return (await response.json()) as GoogleAuthUserInfo;
}

export function buildGoogleAuthConnectUrl(input: {
  mode?: "login" | "signup";
  businessType?: string | null;
  redirectUri: string;
}): string {
  ensureGoogleAuthConfigured();

  const state = encryptJsonPayload(
    {
      mode: input?.mode === "signup" ? "signup" : "login",
      businessType: input?.businessType?.trim() || null,
      createdAt: Date.now()
    } satisfies GoogleAuthState,
    getGoogleAuthStateSecret()
  );

  const params = new URLSearchParams({
    client_id: getGoogleAuthClientId(),
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_AUTH_SCOPES.join(" "),
    include_granted_scopes: "true",
    prompt: "select_account",
    state
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function completeGoogleAuthCallback(input: {
  code: string;
  state: string;
  redirectUri: string;
}): Promise<{
  googleAccountId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  mode: "login" | "signup";
  businessType: string | null;
}> {
  ensureGoogleAuthConfigured();

  let statePayload: GoogleAuthState;
  try {
    statePayload = decryptJsonPayload<GoogleAuthState>(input.state, getGoogleAuthStateSecret());
  } catch {
    throw new Error("Google auth state is invalid or expired.");
  }

  if (!statePayload.createdAt || Date.now() - statePayload.createdAt > 15 * 60_000) {
    throw new Error("Google auth session expired. Start again.");
  }

  const tokenResponse = await exchangeCodeForTokens(input.code, input.redirectUri);
  const accessToken = tokenResponse.access_token?.trim();
  if (!accessToken) {
    throw new Error("Google did not return an access token.");
  }

  const profile = await fetchGoogleUserInfo(accessToken);
  const email = profile.email?.trim().toLowerCase();
  const googleAccountId = profile.sub?.trim();
  if (!email || !googleAccountId) {
    throw new Error("Google account email is missing from the OAuth response.");
  }

  return {
    googleAccountId,
    email,
    emailVerified: Boolean(profile.email_verified),
    name: profile.name?.trim() || null,
    picture: profile.picture?.trim() || null,
    mode: statePayload.mode === "signup" ? "signup" : "login",
    businessType: statePayload.businessType?.trim() || null
  };
}

export function renderGoogleAuthPopupPage(input: {
  status: "success" | "error";
  message: string;
  token?: string;
  user?: User;
  appOrigin?: string | null;
}): string {
  const appOrigin = (() => {
    if (input.appOrigin?.trim()) {
      return input.appOrigin.trim();
    }
    try {
      return new URL(env.APP_BASE_URL).origin;
    } catch {
      return "*";
    }
  })();

  const safeMessage = escapeHtml(input.message);
  const payloadJson = JSON.stringify({
    type: "wagen-google-auth",
    status: input.status,
    message: input.message,
    token: input.token ?? null,
    user: input.user ?? null
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google Login</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f7f8fb;
        color: #0f172a;
      }
      .card {
        width: min(420px, calc(100vw - 32px));
        background: #ffffff;
        border: 1px solid #dbe2ea;
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 20px;
      }
      p {
        margin: 0;
        color: #475569;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${input.status === "success" ? "Google login complete" : "Google login failed"}</h1>
      <p>${safeMessage}</p>
    </div>
    <script>
      (function () {
        var payload = ${payloadJson};
        try {
          if (window.opener && typeof window.opener.postMessage === "function") {
            window.opener.postMessage(payload, ${JSON.stringify(appOrigin)});
          }
        } catch (error) {
          console.error("Failed to notify opener", error);
        }
        setTimeout(function () {
          window.close();
        }, payload.status === "success" ? 600 : 1800);
      })();
    </script>
  </body>
</html>`;
}
