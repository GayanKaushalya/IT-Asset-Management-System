import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api,
  clearSession,
  getStoredUser,
  getToken,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  setSession,
  type AuthUser,
  type RegisterPayload,
} from '../services/client';

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: (next: AuthUser) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getToken());

  // Keep profile in sync for multi-user sessions (name/role may change server-side)
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void api<{ user: AuthUser }>('/api/me')
      .then((res) => {
        if (cancelled || !res?.user) return;
        setUser(res.user);
        setSession(token, res.user);
      })
      .catch(() => {
        /* keep cached user if offline */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      async login(email, password) {
        const data = await apiLogin(email, password);
        setUser(data.user);
        setToken(data.token);
      },
      async register(payload) {
        const data = await apiRegister(payload);
        setUser(data.user);
        setToken(data.token);
      },
      async logout() {
        await apiLogout();
        setUser(null);
        setToken(null);
        clearSession();
      },
      refreshUser(next) {
        setUser(next);
        const t = getToken();
        if (t) setSession(t, next);
      },
    }),
    [user, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
