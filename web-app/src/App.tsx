import { AuthProvider, useAuth } from './auth/AuthProvider';
import LoginPage from './pages/LoginPage/LoginPage';
import PasswordChangePage from './pages/PasswordChangePage/PasswordChangePage';
import DashboardPage from './pages/DashboardPage/DashboardPage';
import { useWorkspaceLocation } from './navigation/use-workspace-location';

function AuthenticatedApp() {
  const { user, accessToken, status, isSubmitting, error, login, changePassword, logout } = useAuth();
  const location = useWorkspaceLocation();

  if (status === 'loading') {
    return (
      <main className="auth-loading" aria-live="polite">
        <div className="auth-loading__mark" aria-hidden="true">AO</div>
        <p>Verificando tu sesión segura…</p>
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
