import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import { fetchMe, login, signup, type User } from "./api";

interface AuthContextValue {
  token: string | null;
  user: User | null;
  loading: boolean;
  signupAndLogin: (payload: {
    name: string;
    email: string;
    password: string;
    businessType: string;
  }) => Promise<void>;
  loginWithPassword: (payload: { email: string; password: string }) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const TOKEN_KEY = "typo_token";

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    void fetchMe(token)
      .then((response) => {
        setUser(response.user);
      })
      .catch(() => {
        setToken(null);
        localStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      loading,
      signupAndLogin: async (payload) => {
        const response = await signup(payload);
        localStorage.setItem(TOKEN_KEY, response.token);
        setToken(response.token);
        setUser(response.user);
      },
      loginWithPassword: async (payload) => {
        const response = await login(payload);
        localStorage.setItem(TOKEN_KEY, response.token);
        setToken(response.token);
        setUser(response.user);
      },
      refreshUser: async () => {
        if (!token) {
          return;
        }
        const response = await fetchMe(token);
        setUser(response.user);
      },
      logout: () => {
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