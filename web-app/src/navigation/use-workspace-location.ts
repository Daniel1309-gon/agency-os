import { useCallback, useEffect, useState } from 'react';

interface WorkspaceLocation {
  pathname: string;
  navigate: (path: string) => void;
  replace: (path: string) => void;
}

function currentPathname(): string {
  return window.location.pathname || '/';
}

function moveTo(path: string, replace: boolean): void {
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
  document.querySelector<HTMLElement>('.workspace-main')?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

export function useWorkspaceLocation(): WorkspaceLocation {
  const [pathname, setPathname] = useState(currentPathname);

  useEffect(() => {
    const handlePopState = () => setPathname(currentPathname());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((path: string) => {
    if (currentPathname() === path) return;
    moveTo(path, false);
    setPathname(path);
  }, []);

  const replace = useCallback((path: string) => {
    if (currentPathname() === path) return;
    moveTo(path, true);
    setPathname(path);
  }, []);

  return { pathname, navigate, replace };
}
