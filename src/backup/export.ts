import { db } from '../db/db';
import { loadSettings } from '../db/settings';
import { toLocalIso } from '../lib/time';
import { APP_ID, SCHEMA_VERSION, type BackupFile } from './schema';

export async function buildBackup(now = new Date()): Promise<BackupFile> {
  return db.transaction('r', db.notes, db.tags, db.settings, async () => {
    const [tags, notes, s] = await Promise.all([db.tags.toArray(), db.notes.toArray(), loadSettings()]);
    return {
      app: APP_ID,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: toLocalIso(now),
      tags,
      notes,
      settings: {
        language: s.language,
        theme: s.theme,
        samePlaceRadiusM: s.samePlaceRadiusM,
        backupReminderDays: s.backupReminderDays,
        ...(s.defaultMapCenter && { defaultMapCenter: s.defaultMapCenter }),
      },
    };
  });
}

export function backupFileName(now = new Date()): string {
  return `plekboek-backup-${toLocalIso(now).slice(0, 10)}.json`;
}

export interface ExportResult {
  fileName: string;
  notes: number;
  tags: number;
  method: 'share' | 'download';
}

/**
 * Bied het bestand aan via de deelfunctie (Web Share API) of download het.
 * Geeft null terug als de gebruiker het delen afbreekt.
 */
export async function exportBackup(): Promise<ExportResult | null> {
  const now = new Date();
  const data = await buildBackup(now);
  const fileName = backupFileName(now);
  const json = JSON.stringify(data, null, 2);
  const file = new File([json], fileName, { type: 'application/json' });
  const base = { fileName, notes: data.notes.length, tags: data.tags.length };

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return { ...base, method: 'share' };
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null;
      // Delen mislukt om een andere reden: val terug op downloaden.
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { ...base, method: 'download' };
}
