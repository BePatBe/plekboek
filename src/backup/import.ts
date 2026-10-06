import { db } from '../db/db';
import { loadSettings } from '../db/settings';
import type { Note, Settings, Tag } from '../db/types';
import { APP_ID, MIGRATIONS, SCHEMA_VERSION, validateNote, validateSettings, validateTag, type BackupSettings } from './schema';

export type ParseError = 'invalidJson' | 'notPlekboek' | 'newerVersion';

export interface ParsedBackup {
  tags: Tag[];
  notes: Note[];
  settings: Partial<BackupSettings>;
  /** aantal ongeldige records (notities + tags) dat wordt overgeslagen */
  invalid: number;
}

export function parseBackup(json: string): { ok: true; data: ParsedBackup } | { ok: false; error: ParseError } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'invalidJson' };
  }
  if (typeof raw !== 'object' || raw === null || (raw as { app?: unknown }).app !== APP_ID) {
    return { ok: false, error: 'notPlekboek' };
  }
  let data = raw as Record<string, unknown>;
  const version = Number(data.schemaVersion);
  if (!Number.isInteger(version) || version < 1) return { ok: false, error: 'notPlekboek' };
  if (version > SCHEMA_VERSION) return { ok: false, error: 'newerVersion' };
  for (let v = version; v < SCHEMA_VERSION; v++) data = MIGRATIONS[v](data);

  const rawTags = Array.isArray(data.tags) ? data.tags : [];
  const rawNotes = Array.isArray(data.notes) ? data.notes : [];
  const tags = rawTags.map(validateTag).filter((t): t is Tag => t !== null);
  const notes = rawNotes.map(validateNote).filter((n): n is Note => n !== null);
  return {
    ok: true,
    data: {
      tags,
      notes,
      settings: validateSettings(data.settings),
      invalid: rawTags.length - tags.length + (rawNotes.length - notes.length),
    },
  };
}

export type ImportMode = 'merge' | 'replace';

export interface ImportSummary {
  added: number;
  updated: number;
  unchanged: number;
  skipped: number;
  tagsAdded: number;
  /** nieuwe instellingen (alleen bij vervangen), zodat de app ze direct kan toepassen */
  settings: Settings | null;
}

const newer = (a: { updatedAt: string }, b: { updatedAt: string }) => Date.parse(a.updatedAt) > Date.parse(b.updatedAt);
const key = (name: string) => name.toLocaleLowerCase();

export async function applyImport(data: ParsedBackup, mode: ImportMode): Promise<ImportSummary> {
  return db.transaction('rw', db.notes, db.tags, db.settings, async () => {
    const summary: ImportSummary = { added: 0, updated: 0, unchanged: 0, skipped: data.invalid, tagsAdded: 0, settings: null };

    if (mode === 'replace') {
      await Promise.all([db.notes.clear(), db.tags.clear()]);
    }

    // --- tags: match op id; zelfde naam met ander id = samenvoegen ---
    const existing = await db.tags.toArray();
    const byId = new Map(existing.map((t) => [t.id, t]));
    const byName = new Map(existing.map((t) => [key(t.name), t]));
    const tagMap = new Map<string, string>(); // geïmporteerd id → id in de database

    for (const t of data.tags) {
      const sameId = byId.get(t.id);
      if (sameId) {
        tagMap.set(t.id, t.id);
        if (newer(t, sameId)) {
          const clash = byName.get(key(t.name));
          const next = clash && clash.id !== t.id ? { ...t, name: sameId.name } : t;
          await db.tags.put(next);
          byName.delete(key(sameId.name));
          byName.set(key(next.name), next);
          byId.set(t.id, next);
        }
        continue;
      }
      const sameName = byName.get(key(t.name));
      if (sameName) {
        tagMap.set(t.id, sameName.id);
        continue;
      }
      await db.tags.add(t);
      byId.set(t.id, t);
      byName.set(key(t.name), t);
      tagMap.set(t.id, t.id);
      summary.tagsAdded++;
    }

    // --- notities: match op id; bij conflict wint de nieuwste updatedAt ---
    const current = await db.notes.bulkGet(data.notes.map((n) => n.id));
    const toPut: Note[] = [];
    data.notes.forEach((raw, i) => {
      const tagId = raw.tagId ? tagMap.get(raw.tagId) ?? (byId.has(raw.tagId) ? raw.tagId : null) : null;
      const note = { ...raw, tagId };
      const old = current[i];
      if (!old) {
        toPut.push(note);
        summary.added++;
      } else if (newer(note, old)) {
        toPut.push(note);
        summary.updated++;
      } else summary.unchanged++;
    });
    await db.notes.bulkPut(toPut);

    if (mode === 'replace') {
      const settings = { ...(await loadSettings()), ...data.settings };
      await db.settings.put({ ...settings, key: 'settings' });
      summary.settings = settings;
    }
    return summary;
  });
}
