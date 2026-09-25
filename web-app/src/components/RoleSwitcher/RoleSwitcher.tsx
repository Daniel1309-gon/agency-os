import type { ChangeEvent } from 'react';
import { roleLabels, type RoleCode } from '../../types/roles';

interface RoleSwitcherProps {
  role: RoleCode;
  onChange: (role: RoleCode) => void;
}

const roleOptions: RoleCode[] = [
  'OPERADOR',
  'COORDINADOR',
  'CAFETERIA',
  'DIRECTOR_OPERATIVO',
  'ADMIN',
];

export function RoleSwitcher({ role, onChange }: RoleSwitcherProps) {
  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange(event.target.value as RoleCode);
  }

  return (
    <label className="role-switcher">
      <span>Vista de rol · demo</span>
      <select value={role} onChange={handleChange} aria-label="Cambiar vista de rol">
        {roleOptions.map((option) => (
          <option key={option} value={option}>
            {roleLabels[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
