import { useEffect, useState } from 'preact/hooks';

export type Route =
  | { name: 'search' }
  | { name: 'new'; params: URLSearchParams }
  | { name: 'read'; id: string }
  | { name: 'edit'; id: string }
  | { name: 'settings' }
  | { name: 'sync' };

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'sync') return { name: 'sync' };
  if (parts[0] === 'note') {
    if (parts[1] === 'new') return { name: 'new', params: new URLSearchParams(query) };
    if (parts[1] && parts[2] === 'edit') return { name: 'edit', id: decodeURIComponent(parts[1]) };
    if (parts[1]) return { name: 'read', id: decodeURIComponent(parts[1]) };
  }
  return { name: 'search' };
}

const EVENT = 'plekboek:route';

/** Navigeert binnen de app. Elke stap krijgt `inApp` in de history-state, zodat "terug" weet of het de app verlaat. */
export function navigate(hash: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState({ inApp: history.state?.inApp ?? false }, '', hash);
  else history.pushState({ inApp: true }, '', hash);
  window.dispatchEvent(new Event(EVENT));
}

/** Terug binnen de app, of naar `fallback` als er geen vorige app-pagina is (bijv. na openen via een link). */
export function goBack(fallback = '#/search') {
  if (history.state?.inApp) history.back();
  else navigate(fallback, { replace: true });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const update = () => setRoute(parseHash(location.hash));
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return route;
}
