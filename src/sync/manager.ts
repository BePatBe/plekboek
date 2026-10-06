import { db } from '../db/db';
import { createStore } from '../lib/store';
import { toLocalIso } from '../lib/time';
import { onlineStore, settingsStore, updateSettings } from '../state';
import { GOOGLE_CLIENT_ID } from './config';
import { AuthExpired, driveEmail, driveRemote } from './drive';
import { AuthCancelled, cachedToken, clearToken, loadGoogle, requestToken, revokeToken } from './google';
import { syncWith, type SyncResult } from './sync';

export type SyncStatus =
  | { state: 'off' }
  | { state: 'idle'; last?: SyncResult }
  | { state: 'syncing' }
  /** Het uur-token is verlopen: één tik op "Synchroniseren" nodig. */
  | { state: 'needsAuth' }
  | { state: 'offline' }
  | { state: 'error'; message: string };

export const syncStore = createStore<SyncStatus>({ state: 'off' });

export const driveConfigured = () => GOOGLE_CLIENT_ID !== '';
export const driveConnected = () => driveConfigured() && settingsStore.get().syncMethod === 'gdrive' && !!settingsStore.get().driveEmail;

let running: Promise<void> | null = null;
let again = false;
let applying = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Synchroniseert nu. `interactive` = gestart door een tik, dan mag er een Google-venster openen. */
export function syncNow(interactive = false): Promise<void> {
  if (!driveConnected()) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = run(interactive).finally(() => {
    running = null;
    if (again) {
      again = false;
      syncNow();
    }
  });
  return running;
}

async function run(interactive: boolean) {
  if (!onlineStore.get()) return syncStore.set({ state: 'offline' });
  let token = cachedToken();
  if (!token) {
    if (!interactive) return syncStore.set({ state: 'needsAuth' });
    try {
      token = await requestToken({ hint: settingsStore.get().driveEmail });
    } catch (e) {
      return syncStore.set(e instanceof AuthCancelled ? { state: 'needsAuth' } : { state: 'error', message: 'auth' });
    }
  }
  syncStore.set({ state: 'syncing' });
  applying = true;
  try {
    const last = await syncWith(driveRemote(token));
    await updateSettings({ lastSyncAt: toLocalIso() });
    syncStore.set({ state: 'idle', last });
  } catch (e) {
    if (e instanceof AuthExpired) {
      clearToken();
      syncStore.set({ state: 'needsAuth' });
    } else syncStore.set({ state: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    applying = false;
  }
}

/** Lokale wijziging: even wachten (er komen vaak meer), dan synchroniseren. */
function changed() {
  if (applying || !driveConnected()) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), 3000);
}

/** Eerste koppeling: toestemming vragen, account tonen, meteen synchroniseren. Moet vanuit een tik starten. */
export async function connectDrive(): Promise<void> {
  const token = await requestToken({ consent: true });
  const email = (await driveEmail(token)) ?? 'Google';
  await updateSettings({ syncMethod: 'gdrive', driveEmail: email });
  await syncNow();
}

export async function disconnectDrive(): Promise<void> {
  revokeToken();
  await updateSettings({ driveEmail: undefined, lastSyncAt: undefined });
  syncStore.set({ state: 'off' });
}

export function initSync() {
  for (const table of [db.notes, db.tags, db.deletions]) {
    table.hook('creating', changed);
    table.hook('updating', changed);
    table.hook('deleting', changed);
  }
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());
  onlineStore.subscribe((online) => online && syncNow());
  settingsStore.subscribe((s) => {
    if (s.syncMethod === 'gdrive' && driveConfigured()) loadGoogle().catch(() => {});
    if (!driveConnected() && syncStore.get().state !== 'off') syncStore.set({ state: 'off' });
  });
  if (driveConnected()) {
    syncStore.set({ state: 'idle' });
    loadGoogle().catch(() => {});
    syncNow();
  }
}
