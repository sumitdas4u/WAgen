import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import {
  buildGoogleAuthStartUrl,
  fetchMe,
  login,
  requestPasswordReset as requestLocalPasswordReset,
  signup,
  type AuthResponse,
  type GoogleAuthPopupPayload,
  type User
} from "./api";

interface AuthContextValue {
  token: string | null;
  user: User | null;
  loading: boolean;
  signupAndLogin: (payload: {
    name: string;
    email: string;
    password: string;
    businessType: string;
  }) => Promise<{ emailVerificationRequired: boolean }>;
  loginWithPassword: (payload: { email: string; password: string }) => Promise<void>;
  loginWithGoogle: (payload?: {
    mode?: "login" | "signup";
    businessType?: string;
  }) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const TOKEN_KEY = "typo_token";

const AuthContext = createContext<AuthContextValue | null>(null);

function runGoogleAuthPopup(input?: {
  mode?: "login" | "signup";
  businessType?: string;
}): Promise<AuthResponse> {
  return new Promise((resolve, reject) => {
    const popup = window.open(
      buildGoogleAuthStartUrl(input),
      "wagenGoogleAuth",
      "popup=yes,width=560,height=760"
    );

    if (!popup) {
      reject(new Error("Popup was blocked. Allow popups and try again."));
      return;
    }

    let finished = false;
    let popupClosedTimer = 0;

    const cleanup = () => {
      finished = true;
      window.removeEventListener("message", onMessage);
      if (popupClosedTimer) {
        window.clearInterval(popupClosedTimer);
      }
    };

    const onMessage = (event: MessageEvent<GoogleAuthPopupPayload>) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const payload = event.data;
      if (payload?.type !== "wagen-google-auth") {
        return;
      }

      cleanup();

      if (payload.status !== "success" || !payload.token || !payload.user) {
        reject(new Error(payload.message || "Google login failed."));
        return;
      }

      resolve({
        token: payload.token,
        user: payload.user
      });
    };

    window.addEventListener("message", onMessage);
    popupClosedTimer = window.setInterval(() => {
      if (!finished && popup.closed) {
        cleanup();
        reject(new Error("Google login was closed before completion."));
      }
    }, 400);
  });
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const setAuthenticatedState = (response: AuthResponse) => {
    localStorage.setItem(TOKEN_KEY, response.token);
    setToken(response.token);
    setUser(response.user);
  };

  useEffect(() => {
    let isActive = true;

    const loadSession = async () => {
      setLoading(true);

      if (token) {
        try {
          const response = await fetchMe(token);
          if (isActive) {
            setUser(response.user);
          }
          return;
        } catch {
          if (isActive) {
            setToken(null);
            setUser(null);
            localStorage.removeItem(TOKEN_KEY);
          }
          return;
        } finally {
          if (isActive) {
            setLoading(false);
          }
        }
      }

      if (isActive) {
        setUser(null);
        setLoading(false);
      }
    };

    void loadSession();
    return () => {
      isActive = false;
    };
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      loading,
      signupAndLogin: async (payload) => {
        const response = await signup(payload);
        setAuthenticatedState(response);
        return { emailVerificationRequired: false };
      },
      loginWithPassword: async (payload) => {
        const response = await login({
          email: payload.email.trim().toLowerCase(),
          password: payload.password
        });
        setAuthenticatedState(response);
      },
      loginWithGoogle: async (payload) => {
        const response = await runGoogleAuthPopup(payload);
        setAuthenticatedState(response);
      },
      requestPasswordReset: async (email: string) => {
        await requestLocalPasswordReset({ email: email.trim().toLowerCase() });
      },
      refreshUser: async () => {
        if (!token) {
          return;
        }
        const response = await fetchMe(token);
        setUser(response.user);
      },
      logout: async () => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      }
    }),
    [loading, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
