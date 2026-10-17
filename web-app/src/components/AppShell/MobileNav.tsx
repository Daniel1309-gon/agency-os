import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { BrandMark } from '../BrandMark/BrandMark';
import { groupWorkspaceRoutes, isPlainLeftClick, type WorkspaceRoute } from '../../navigation/workspace-navigation';

interface MobileNavProps {
  navigation: readonly WorkspaceRoute[];
  activeRoute: WorkspaceRoute;
  onNavigate: (path: string) => void;
  /** Menú de usuario ya resuelto: la barra solo lo coloca, no sabe de sesión. */
  userMenu?: ReactNode;
}

/** Misma condición que el CSS que oculta el sidebar: ancho angosto o poca altura. */
const COMPACT_VIEWPORT = '(max-width: 820px), (max-height: 520px)';

/**
 * Navegación de pantallas angostas: barra con el apartado actual y un menú a
 * pantalla completa. El panel es un <dialog> modal, así que el navegador se
 * encarga de contener el foco, de Escape y de devolver el foco al disparador;
 * además deja inerte el resto del documento.
 */
export function MobileNav({ navigation, activeRoute, onNavigate, userMenu }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
      closeRef.current?.focus();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Si la ventana deja de ser angosta, el panel quedaría abierto pero fuera del
  // media query: sin reglas propias, cubriría el escritorio con el fondo inerte.
  useEffect(() => {
    const compact = window.matchMedia(COMPACT_VIEWPORT);
    function handleChange(event: MediaQueryListEvent) {
      if (!event.matches) setIsOpen(false);
    }
    compact.addEventListener('change', handleChange);
    return () => compact.removeEventListener('change', handleChange);
  }, []);

  function go(event: React.MouseEvent<HTMLAnchorElement>, path: string) {
    if (!isPlainLeftClick(event)) {
      setIsOpen(false);
      return;
    }
    event.preventDefault();
    onNavigate(path);
    setIsOpen(false);
  }

  const groups = groupWorkspaceRoutes(navigation);

  return <>
    <div className="mobile-menu__bar">
      <button className="mobile-menu__icon-button" type="button" aria-label="Abrir menú de navegación" aria-expanded={isOpen} aria-controls="mobile-menu" onClick={() => setIsOpen(true)}>
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>
      <h2 className="mobile-menu__title">{activeRoute.label}</h2>
      <div className="mobile-menu__user">{userMenu}</div>
    </div>

    <dialog id="mobile-menu" className="mobile-menu" ref={dialogRef} aria-label="Navegación principal" onClose={() => setIsOpen(false)}>
      <div className="mobile-menu__header">
        <a href="/" className="mobile-menu__brand" onClick={(event) => go(event, '/')}>
          <BrandMark className="h-9 w-9" />
          <span className="mobile-menu__brand-text">
            <span className="mobile-menu__brand-name">Agency OS</span>
            <span className="mobile-menu__brand-caption">Navegación</span>
          </span>
        </a>
        <button ref={closeRef} className="mobile-menu__icon-button" type="button" aria-label="Cerrar menú de navegación" onClick={() => setIsOpen(false)}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <nav className="workspace-nav" aria-label="Secciones del workspace">
        {groups.map(([group, routes]) => <div className="workspace-nav__group" key={group}>
          {groups.length > 1 && <span className="sidebar-label workspace-nav__group-label">{group}</span>}
          {routes.map((route) => <a className={route.path === activeRoute.path ? 'workspace-nav__item is-active' : 'workspace-nav__item'} href={route.path} key={route.id} aria-current={route.path === activeRoute.path ? 'page' : undefined} onClick={(event) => go(event, route.path)}>
            <span>{route.label}</span>
            {route.pending && <small className="workspace-nav__status">Pendiente</small>}
          </a>)}
        </div>)}
      </nav>

      <div className="workspace-sidebar__footer">
        <div className="sidebar-security">
          <span className="sidebar-security__mark">✓</span>
          <span><strong>Acceso protegido</strong><small>Sesión auditada</small></span>
        </div>
      </div>
    </dialog>
  </>;
}
