import { AuthProvider, useAuth } from './auth/AuthProvider';
import LoginPage from './pages/LoginPage/LoginPage';
import PasswordChangePage from './pages/PasswordChangePage/PasswordChangePage';
import DashboardPage from './pages/DashboardPage/DashboardPage';

function AuthenticatedApp() {
  const { user, accessToken, status, isSubmitting, error, login, changePassword, logout } = useAuth();

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

  return <DashboardPage user={user} accessToken={accessToken} onLogout={logout} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
