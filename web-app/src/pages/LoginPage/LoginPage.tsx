import { BrandMark } from '../../components/BrandMark/BrandMark';
import { BrandPanel } from '../../components/BrandPanel/BrandPanel';
import { LoginForm } from '../../components/LoginForm/LoginForm';

interface LoginPageProps {
  onAuthenticated: (email: string, password: string) => Promise<void>;
  isSubmitting?: boolean;
  error?: string | null;
}

export default function LoginPage({ onAuthenticated, isSubmitting, error }: LoginPageProps) {
  return (
    <main className="login-shell">
      <BrandPanel />

      <section className="form-panel" aria-labelledby="login-title">
        <div className="form-panel__inner">
          <div className="mobile-lockup">
            <BrandMark />
            <span>Agency OS</span>
          </div>

          <div className="form-heading">
            <p className="eyebrow">Acceso de equipo</p>
            <h2 id="login-title">Bienvenida de vuelta.</h2>
            <p>Ingresa tus datos para continuar al espacio de trabajo.</p>
          </div>

          <LoginForm onAuthenticated={onAuthenticated} isSubmitting={isSubmitting} error={error} />

          <footer className="form-footer">
            <span>Agency OS / Access layer</span>
            <span>v0.1.0</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
