import { createStore } from './lib/store';
import { DEFAULT_SETTINGS, type Settings } from './db/types';
import { loadSettings, saveSettings } from './db/settings';
import { setLang, systemLang } from './i18n';

/* ---------- instellingen ---------- */

export const settingsStore = createStore<Settings>({ ...DEFAULT_SETTINGS });

const THEME_COLORS = { light: '#ffffff', dark: '#141a18' };

function applyTheme(theme: Settings['theme']) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  // Systeembalk: bij een vaste keuze krijgen beide varianten dezelfde kleur.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const media = m.media.includes('dark') ? 'dark' : 'light';
    m.content = THEME_COLORS[theme === 'system' ? media : theme];
  });
}

export function applySettings(s: Settings) {
  applyTheme(s.theme);
  setLang(s.language === 'system' ? systemLang() : s.language);
}

export async function initSettings() {
  const s = await loadSettings();
  settingsStore.set(s);
  applySettings(s);
  window.addEventListener('languagechange', () => applySettings(settingsStore.get()));
}

export async function updateSettings(patch: Partial<Settings>) {
  const next = { ...settingsStore.get(), ...patch };
  settingsStore.set(next);
  applySettings(next);
  await saveSettings(next);
}

/** Laatste export of synchronisatie met een ander toestel; beide tellen als back-up. */
export function lastBackupAt(s: Settings): string | undefined {
  const all = [s.lastExportAt, s.lastSyncAt].filter((x): x is string => !!x);
  return all.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

/** Zet instellingen die elders (bijv. bij importeren) al zijn opgeslagen. */
export function replaceSettings(s: Settings) {
  settingsStore.set(s);
  applySettings(s);
}

/* ---------- online/offline ---------- */

export const onlineStore = createStore(typeof navigator === 'undefined' ? true : navigator.onLine);
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => onlineStore.set(true));
  window.addEventListener('offline', () => onlineStore.set(false));
}

/* ---------- installeren ---------- */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const installPromptStore = createStore<BeforeInstallPromptEvent | null>(null);
export const installedStore = createStore(false);

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function initInstall() {
  installedStore.set(isStandalone());
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPromptStore.set(e as BeforeInstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => {
    installPromptStore.set(null);
    installedStore.set(true);
  });
}

export async function promptInstall() {
  const e = installPromptStore.get();
  if (!e) return;
  await e.prompt();
  const { outcome } = await e.userChoice;
  installPromptStore.set(null);
  if (outcome === 'accepted') installedStore.set(true);
}

/* ---------- opslag ---------- */

/** Vraag de browser de data niet zomaar op te ruimen (§2). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* niet ondersteund */
  }
}

/* ---------- kleine localStorage-hulp (alleen voor gemak per toestel) ---------- */

export const local = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* privémodus of geen opslag */
    }
  },
};
