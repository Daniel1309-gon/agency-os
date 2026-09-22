import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { userSummarySchema, type UserSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../services/api-client';

interface AuthContextValue {
  user: UserSummary | null;
  accessToken: string | null;
  status: 'loading' | 'authenticated' | 'anonymous' | 'recoverable';
  isSubmitting: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  retryRestore: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function sessionRestoreDisposition(error: unknown): 'anonymous' | 'recoverable' {
  return error instanceof ApiError && error.status === 401 ? 'anonymous' : 'recoverable';
}

function sessionRestoreMessage(error: unknown): string {
  if (error instanceof ApiError && error.status >= 500) {
    return 'No pudimos verificar tu sesión porque el servicio no está disponible. Reintenta en unos segundos.';
  }
  return 'No pudimos verificar tu sesión. Comprueba la conexión e inténtalo de nuevo.';
}

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
  const mounted = useRef(false);
  const restoreAttempt = useRef(0);

  useEffect(() => apiClient.onSessionExpired(() => {
    restoreAttempt.current += 1;
    setUser(null);
    setStatus('anonymous');
    setError(null);
  }), []);

  const restoreSession = useCallback(async () => {
    const attempt = ++restoreAttempt.current;
    setStatus('loading');
    setError(null);
    try {
      await apiClient.refresh();
      const nextUser = await currentUser();
      if (!mounted.current || attempt !== restoreAttempt.current) return;
      setUser(nextUser);
      setStatus('authenticated');
    } catch (nextError) {
      if (!mounted.current || attempt !== restoreAttempt.current) return;
      if (sessionRestoreDisposition(nextError) === 'anonymous') {
        apiClient.setAccessToken(null);
        setUser(null);
        setStatus('anonymous');
        return;
      }
      setUser(null);
      setStatus('recoverable');
      setError(sessionRestoreMessage(nextError));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void restoreSession();

    return () => {
      mounted.current = false;
      restoreAttempt.current += 1;
    };
  }, [restoreSession]);

  const login = useCallback(async (email: string, password: string) => {
    restoreAttempt.current += 1;
    setError(null);
    setIsSubmitting(true);
    let sessionEstablished = false;
    try {
      await apiClient.login(email, password);
      sessionEstablished = true;
      const nextUser = await currentUser();
      setUser(nextUser);
      setStatus('authenticated');
    } catch (nextError) {
      setUser(null);
      if (!sessionEstablished || sessionRestoreDisposition(nextError) === 'anonymous') {
        apiClient.setAccessToken(null);
        setStatus('anonymous');
      } else {
        setStatus('recoverable');
      }
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
    restoreAttempt.current += 1;
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
    retryRestore: restoreSession,
    clearError,
  }), [user, status, isSubmitting, error, login, changePassword, logout, restoreSession, clearError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
