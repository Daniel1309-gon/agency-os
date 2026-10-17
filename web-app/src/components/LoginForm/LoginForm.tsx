import { type FormEvent, useState } from 'react';
import { EyeIcon } from '../icons/EyeIcon';
import { LockIcon } from '../icons/LockIcon';

interface LoginFormProps {
  onAuthenticated: (email: string, password: string) => Promise<void>;
  isSubmitting?: boolean;
  error?: string | null;
}

export function LoginForm({ onAuthenticated, isSubmitting = false, error = null }: LoginFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    try {
      await onAuthenticated(email, password);
    } catch {
      // El error sanitizado se muestra a través del contexto de autenticación.
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <div className="field-group">
        <label htmlFor="email">Correo o usuario</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="nombre@agencia.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          disabled={isSubmitting}
        />
      </div>

      <div className="field-group">
        <div className="field-label-row">
          <label htmlFor="password">Contraseña</label>
          <span className="field-hint">Protegida con scrypt</span>
        </div>
        <div className="password-field">
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Introduce tu contraseña"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={isSubmitting}
          />
          <button
            className="icon-button"
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={showPassword}
          >
            <EyeIcon isVisible={showPassword} />
          </button>
        </div>
      </div>

      <div className="form-options">
        <label className="remember-option">
          <span className="checkbox-mark" aria-hidden="true" />
          <span>Refresh seguro en cookie HttpOnly</span>
        </label>
        <button
          className="text-link"
          type="button"
          onClick={() => setNotice('Contacta a coordinación para recuperar el acceso a tu cuenta.')}
        >
          ¿Olvidaste tu contraseña?
        </button>
      </div>

      <button className="submit-button" type="submit" disabled={isSubmitting}>
        <span>{isSubmitting ? 'Validando acceso…' : 'Entrar al workspace'}</span>
        <span className="submit-arrow" aria-hidden="true">↗</span>
      </button>

      <div className="secure-note">
        <LockIcon />
        <span>Tu acceso queda registrado de forma segura y nunca guardamos tu contraseña en los logs.</span>
      </div>

      <p className="form-notice" role="status" aria-live="polite">
        {error || notice}
      </p>
    </form>
  );
}
