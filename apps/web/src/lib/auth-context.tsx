import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile
} from "firebase/auth";
import { createFirebaseSession, fetchMe, migrateLegacyPasswordUser, type AuthResponse, type User } from "./api";
import { firebaseAuth, googleProvider } from "./firebase";

const PENDING_SIGNUP_BUSINESS_TYPE_KEY = "typo_signup_business_type";

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
  loginWithGoogle: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const TOKEN_KEY = "typo_token";

const AuthContext = createContext<AuthContextValue | null>(null);

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

      const currentFirebaseUser = firebaseAuth.currentUser;
      if (!currentFirebaseUser) {
        if (isActive) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      try {
        await currentFirebaseUser.reload();
        if (!currentFirebaseUser.emailVerified) {
          await signOut(firebaseAuth);
          if (isActive) {
            setLoading(false);
          }
          return;
        }

        const idToken = await currentFirebaseUser.getIdToken();
        const pendingBusinessType = localStorage.getItem(PENDING_SIGNUP_BUSINESS_TYPE_KEY) ?? undefined;
        const response = await createFirebaseSession({ idToken, businessType: pendingBusinessType });
        if (isActive) {
          setAuthenticatedState(response);
          localStorage.removeItem(PENDING_SIGNUP_BUSINESS_TYPE_KEY);
        }
      } catch {
        await signOut(firebaseAuth).catch(() => undefined);
        if (isActive) {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setUser(null);
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
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
        const credentials = await createUserWithEmailAndPassword(
          firebaseAuth,
          payload.email.trim().toLowerCase(),
          payload.password
        );
        await updateProfile(credentials.user, { displayName: payload.name.trim() });
        localStorage.setItem(PENDING_SIGNUP_BUSINESS_TYPE_KEY, payload.businessType);
        await sendEmailVerification(credentials.user, {
          url: `${window.location.origin}/signup`
        });
        await signOut(firebaseAuth);
        return { emailVerificationRequired: true };
      },
      loginWithPassword: async (payload) => {
        const normalizedEmail = payload.email.trim().toLowerCase();
        const password = payload.password;

        let credentials;
        try {
          credentials = await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (
            code !== "auth/user-not-found" &&
            code !== "auth/wrong-password" &&
            code !== "auth/invalid-credential"
          ) {
            throw error;
          }

          await migrateLegacyPasswordUser({ email: normalizedEmail, password });
          credentials = await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
        }

        await credentials.user.reload();
        if (!credentials.user.emailVerified) {
          await sendEmailVerification(credentials.user).catch(() => undefined);
          await signOut(firebaseAuth);
          throw new Error("Email not verified. Check your inbox and verify your email before logging in.");
        }

        const idToken = await credentials.user.getIdToken();
        const pendingBusinessType = localStorage.getItem(PENDING_SIGNUP_BUSINESS_TYPE_KEY) ?? undefined;
        const response = await createFirebaseSession({ idToken, businessType: pendingBusinessType });
        setAuthenticatedState(response);
        localStorage.removeItem(PENDING_SIGNUP_BUSINESS_TYPE_KEY);
      },
      loginWithGoogle: async () => {
        const credentials = await signInWithPopup(firebaseAuth, googleProvider);
        const idToken = await credentials.user.getIdToken();
        const response = await createFirebaseSession({
          idToken,
          name: credentials.user.displayName ?? undefined
        });
        setAuthenticatedState(response);
        localStorage.removeItem(PENDING_SIGNUP_BUSINESS_TYPE_KEY);
      },
      requestPasswordReset: async (email: string) => {
        await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase());
      },
      refreshUser: async () => {
        if (!token) {
          return;
        }
        const response = await fetchMe(token);
        setUser(response.user);
      },
      logout: async () => {
        await signOut(firebaseAuth).catch(() => undefined);
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
