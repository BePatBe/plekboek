import { GOOGLE_CLIENT_ID } from './config';
import { local } from '../state';

/** Alleen de verborgen app-map in Drive: Plekboek ziet je andere bestanden niet. */
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const TOKEN_KEY = 'plekboek-google-token';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        prompt?: string;
        login_hint?: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type: string }) => void;
      }): { requestAccessToken(): void };
      revoke(token: string, done?: () => void): void;
    };
  };
}

declare global {
  interface Window {
    google?: Gis;
  }
}

let loading: Promise<void> | null = null;

/** Laadt Google Identity Services. Vooraf laden, zodat een tik op een knop direct het inlogvenster opent. */
export function loadGoogle(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('gis-load'));
    };
    document.head.append(s);
  });
  return loading;
}

/** Geldig toegangstoken (Google geeft er een voor ongeveer een uur), of null. */
export function cachedToken(): string | null {
  try {
    const t = JSON.parse(local.get(TOKEN_KEY) ?? 'null') as { token: string; exp: number } | null;
    return t && t.exp - 60_000 > Date.now() ? t.token : null;
  } catch {
    return null;
  }
}

export function clearToken() {
  local.set(TOKEN_KEY, null);
}

export class AuthCancelled extends Error {}

/**
 * Vraagt een toegangstoken via een Google-venster. Moet starten vanuit een tik of klik,
 * anders blokkeert de browser het venster; daarom geen `await` vóór requestAccessToken als GIS al geladen is.
 */
export async function requestToken(opts: { hint?: string; consent?: boolean } = {}): Promise<string> {
  if (!window.google?.accounts?.oauth2) await loadGoogle();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      prompt: opts.consent ? 'consent' : '',
      login_hint: opts.hint,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new AuthCancelled(r.error ?? 'no-token'));
        local.set(TOKEN_KEY, JSON.stringify({ token: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 }));
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new AuthCancelled(e.type)),
    });
    client.requestAccessToken();
  });
}

export function revokeToken() {
  const token = cachedToken();
  clearToken();
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token);
}
