import { db } from './db';
import { DEFAULT_SETTINGS, type Settings } from './types';

export async function loadSettings(): Promise<Settings> {
  const row = await db.settings.get('settings');
  if (!row) return { ...DEFAULT_SETTINGS };
  const { key: _key, ...settings } = row;
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await db.settings.put({ ...settings, key: 'settings' });
}
