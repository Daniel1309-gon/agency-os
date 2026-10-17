import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import type { UserSummary } from '@agency-os/shared';
import { roleLabels, type RoleCode } from '../../types/roles';

interface UserMenuProps {
  user: UserSummary;
  role: RoleCode;
  onLogout: () => void;
  /** `initials` es el disparador compacto de la barra angosta. */
  variant?: 'full' | 'initials';
}

function initialsOf(fullName: string): string {
  return fullName.split(' ').map((part) => part[0]).slice(0, 2).join('');
}

export function UserMenu({ user, role, onLogout, variant = 'full' }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

      const items = containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      if (!items?.length) return;
      event.preventDefault();
      const current = Array.from(items).indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = current === -1 ? (step === 1 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
      items[next].focus();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const initials = initialsOf(user.fullName);

  return <div className="relative" ref={containerRef}>
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={isOpen}
      aria-label={variant === 'initials' ? `Menú de ${user.fullName}` : undefined}
      onClick={() => setIsOpen((isCurrentlyOpen) => !isCurrentlyOpen)}
      className={variant === 'full'
        ? 'flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white py-1 pr-3 pl-1 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50'
        : 'grid h-9 w-9 place-items-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white transition-transform active:scale-95'}
    >
      {variant === 'full'
        ? <>
          <span className="grid h-7 w-7 place-items-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white" aria-hidden="true">{initials}</span>
          <span className="text-xs font-medium text-zinc-700">{user.fullName}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-zinc-400 transition-transform duration-200${isOpen ? ' rotate-180' : ''}`} aria-hidden="true" />
        </>
        : <span aria-hidden="true">{initials}</span>}
    </button>

    {isOpen && <div role="menu" aria-label="Menú de usuario" className="user-menu-panel absolute top-[calc(100%+8px)] right-0 z-40 w-56 rounded-2xl border border-zinc-200/80 bg-white p-1.5 shadow-xl">
      <div className="px-3 pt-2 pb-3">
        <p className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">Sesión activa</p>
        <p className="mt-1 truncate text-sm font-semibold text-zinc-900">{user.fullName}</p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-zinc-100 py-1 pr-2.5 pl-2 text-[11px] font-medium text-zinc-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          Rol: {roleLabels[role]}
        </p>
      </div>
      <div className="border-t border-zinc-100 pt-1.5">
        <button type="button" role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50/80">
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Cerrar sesión
        </button>
      </div>
    </div>}
  </div>;
}
