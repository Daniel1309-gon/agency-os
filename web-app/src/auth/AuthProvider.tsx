import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { userSummarySchema, type UserSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../services/api-client';

interface AuthContextValue {
  user: UserSummary | null;
  accessToken: string | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  isSubmitting: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return 'No pudimos conectar con Agency OS. Intenta de nuevo.';
  if (error.status === 401) return 'El correo o la contraseña no son correctos.';
  if (error.status === 403) return 'Tu cuenta no tiene acceso a este momento operativo.';
  if (error.status === 429) return 'Hay demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  return error.message || 'La solicitud no pudo completarse.';
}

async function currentUser(): Promise<UserSummary> {
  const raw = await apiClient.request<unknown>('/auth/me');
  return userSummarySchema.parse(raw);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSummary | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiClient.refresh()
      .then(() => currentUser())
      .then((nextUser) => {
        if (cancelled) return;
        setUser(nextUser);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        apiClient.setAccessToken(null);
        setUser(null);
        setStatus('anonymous');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.login(email, password);
      const nextUser = await currentUser();
      setUser(nextUser);
      setStatus('authenticated');
    } catch (nextError) {
      apiClient.setAccessToken(null);
      setUser(null);
      setStatus('anonymous');
      const friendlyMessage = messageFor(nextError);
      setError(friendlyMessage);
      throw new Error(friendlyMessage);
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    setError(null);
    try {
      await apiClient.request('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      apiClient.setAccessToken(null);
      setUser(null);
      setStatus('anonymous');
    } catch (nextError) {
      const friendlyMessage = messageFor(nextError);
      setError(friendlyMessage);
      throw new Error(friendlyMessage);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.logout();
    } finally {
      setUser(null);
      setStatus('anonymous');
      setError(null);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const value = useMemo<AuthContextValue>(() => ({
    user,
    accessToken: apiClient.getAccessToken(),
    status,
    isSubmitting,
    error,
    login,
    changePassword,
    logout,
    clearError,
  }), [user, status, isSubmitting, error, login, changePassword, logout, clearError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
