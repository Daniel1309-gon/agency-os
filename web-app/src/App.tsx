import { AuthProvider, useAuth } from './auth/AuthProvider';
import LoginPage from './pages/LoginPage/LoginPage';
import PasswordChangePage from './pages/PasswordChangePage/PasswordChangePage';
import DashboardPage from './pages/DashboardPage/DashboardPage';
import { useWorkspaceLocation } from './navigation/use-workspace-location';

function AuthenticatedApp() {
  const { user, accessToken, status, isSubmitting, error, login, changePassword, logout, retryRestore } = useAuth();
  const location = useWorkspaceLocation();

  if (status === 'loading') {
    return (
      <main className="auth-loading" aria-live="polite">
        <div className="auth-loading__mark" aria-hidden="true">AO</div>
        <p>Verificando tu sesión segura…</p>
      </main>
    );
  }

  if (status === 'recoverable') {
    return (
      <main className="auth-loading" aria-live="polite">
        <div className="auth-retry-panel">
          <div className="auth-loading__mark" aria-hidden="true">AO</div>
          <h1>Estamos verificando tu acceso.</h1>
          <p>{error ?? 'El servicio no respondió. Puedes reintentar sin volver a ingresar tus credenciales.'}</p>
          <button className="submit-button" type="button" onClick={() => void retryRestore()}>
            <span>Reintentar conexión</span>
            <span className="submit-arrow" aria-hidden="true">↗</span>
          </button>
        </div>
      </main>
    );
  }

  if (!user) return <LoginPage onAuthenticated={login} isSubmitting={isSubmitting} error={error} />;
  if (user.mustChangePassword) return <PasswordChangePage onSubmit={changePassword} error={error} />;

  async function logoutAndReturn() {
    await logout();
    location.replace('/');
  }

  return <DashboardPage user={user} accessToken={accessToken} pathname={location.pathname} onNavigate={location.navigate} onReplace={location.replace} onLogout={logoutAndReturn} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
