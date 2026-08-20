import { type FormEvent, useState } from 'react';
import { BrandMark } from '../../components/BrandMark/BrandMark';
import { BrandPanel } from '../../components/BrandPanel/BrandPanel';

interface PasswordChangePageProps {
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>;
  error?: string | null;
}

export default function PasswordChangePage({ onSubmit, error }: PasswordChangePageProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setNotice('Las contraseñas nuevas no coinciden.');
      return;
    }
    setNotice('');
    setIsSubmitting(true);
    try {
      await onSubmit(currentPassword, newPassword);
    } catch {
      // El contexto de autenticación muestra el error sanitizado.
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <BrandPanel />
      <section className="form-panel" aria-labelledby="password-title">
        <div className="form-panel__inner">
          <div className="mobile-lockup">
            <BrandMark />
            <span>Agency OS</span>
          </div>
          <div className="form-heading">
            <p className="eyebrow">Primer acceso</p>
            <h2 id="password-title">Actualiza tu contraseña.</h2>
            <p>Por seguridad, necesitas definir una contraseña nueva antes de entrar al workspace.</p>
          </div>
          <form className="login-form" onSubmit={handleSubmit}>
            <div className="field-group">
              <label htmlFor="current-password">Contraseña temporal</label>
              <input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required disabled={isSubmitting} />
            </div>
            <div className="field-group">
              <label htmlFor="new-password">Nueva contraseña</label>
              <input id="new-password" type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required disabled={isSubmitting} />
            </div>
            <div className="field-group">
              <label htmlFor="confirm-password">Repite la nueva contraseña</label>
              <input id="confirm-password" type="password" autoComplete="new-password" minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required disabled={isSubmitting} />
            </div>
            <button className="submit-button" type="submit" disabled={isSubmitting}>
              <span>{isSubmitting ? 'Guardando…' : 'Guardar contraseña'}</span>
              <span className="submit-arrow" aria-hidden="true">↗</span>
            </button>
            <p className="form-notice" role="status" aria-live="polite">{error || notice}</p>
          </form>
        </div>
      </section>
    </main>
  );
}
