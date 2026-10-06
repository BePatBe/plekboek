import { db } from '../db/db';
import { loadSettings } from '../db/settings';
import type { Deletion, Note, Settings, Tag } from '../db/types';
import { toLocalIso } from '../lib/time';
import {
  APP_ID,
  MIGRATIONS,
  SCHEMA_VERSION,
  validateDeletion,
  validateNote,
  validateSettings,
  validateTag,
  type BackupSettings,
} from './schema';

export type ParseError = 'invalidJson' | 'notPlekboek' | 'newerVersion';

export interface ParsedBackup {
  tags: Tag[];
  notes: Note[];
  deletions: Deletion[];
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
  const rawDeletions = Array.isArray(data.deletions) ? data.deletions : [];
  const tags = rawTags.map(validateTag).filter((t): t is Tag => t !== null);
  const notes = rawNotes.map(validateNote).filter((n): n is Note => n !== null);
  const deletions = rawDeletions.map(validateDeletion).filter((d): d is Deletion => d !== null);
  return {
    ok: true,
    data: {
      tags,
      notes,
      deletions,
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
  /** lokaal verwijderd omdat ze elders zijn verwijderd */
  deleted: number;
  skipped: number;
  tagsAdded: number;
  /** nieuwe instellingen (alleen bij vervangen), zodat de app ze direct kan toepassen */
  settings: Settings | null;
}

const ms = (iso: string) => Date.parse(iso);
const newer = (a: { updatedAt: string }, b: { updatedAt: string }) => ms(a.updatedAt) > ms(b.updatedAt);
const key = (name: string) => name.toLocaleLowerCase();

/**
 * Samenvoegen (ook gebruikt door de synchronisatie):
 * - notities en tags: match op id, de nieuwste `updatedAt` wint;
 * - verwijderingen: een record verdwijnt als het niet ná de verwijdering is gewijzigd;
 * - tags met dezelfde naam en een ander id: de tag met het kleinste id wint, op elk toestel,
 *   zodat toestellen na synchroniseren dezelfde tags hebben.
 * Vervangen: eerst alles wissen, dan hetzelfde in één transactie (alles of niets).
 */
export async function applyImport(data: ParsedBackup, mode: ImportMode): Promise<ImportSummary> {
  return db.transaction('rw', [db.notes, db.tags, db.deletions, db.settings], async () => {
    const summary: ImportSummary = { added: 0, updated: 0, unchanged: 0, deleted: 0, skipped: data.invalid, tagsAdded: 0, settings: null };
    const now = toLocalIso();

    if (mode === 'replace') {
      await Promise.all([db.notes.clear(), db.tags.clear(), db.deletions.clear()]);
    }

    // --- verwijderingen ---
    const dels = new Map((await db.deletions.toArray()).map((d) => [d.id, d]));
    for (const d of data.deletions) {
      const known = dels.get(d.id);
      if (!known || ms(d.deletedAt) > ms(known.deletedAt)) {
        dels.set(d.id, d);
        await db.deletions.put(d);
      }
    }
    /** Is dit record door een verwijdering ingehaald? */
    const gone = (r: { id: string; updatedAt: string }) => {
      const d = dels.get(r.id);
      return !!d && ms(d.deletedAt) >= ms(r.updatedAt);
    };
    /** Een record dat ná de verwijdering is gewijzigd, leeft weer: tombstone weg. */
    const revive = async (id: string) => {
      if (dels.delete(id)) await db.deletions.delete(id);
    };

    for (const d of data.deletions) {
      const table = d.kind === 'note' ? db.notes : db.tags;
      const local = await table.get(d.id);
      if (!local) continue;
      if (gone(local)) {
        await table.delete(d.id);
        if (d.kind === 'note') summary.deleted++;
      } else await revive(d.id);
    }

    // --- tags ---
    const existing = await db.tags.toArray();
    const byId = new Map(existing.map((t) => [t.id, t]));
    const byName = new Map(existing.map((t) => [key(t.name), t]));
    const tagMap = new Map<string, string>(); // geïmporteerd id → id in de database

    for (const t of data.tags) {
      if (gone(t)) continue;
      await revive(t.id);
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
      if (sameName && sameName.id < t.id) {
        tagMap.set(t.id, sameName.id);
        continue;
      }
      if (sameName) {
        // De binnenkomende tag wint: lokale notities verhuizen, de lokale tag verdwijnt.
        await db.tags.delete(sameName.id);
        await db.deletions.put({ id: sameName.id, kind: 'tag', deletedAt: now });
        dels.set(sameName.id, { id: sameName.id, kind: 'tag', deletedAt: now });
        await db.notes.where('tagId').equals(sameName.id).modify({ tagId: t.id, updatedAt: now });
        byId.delete(sameName.id);
        tagMap.set(sameName.id, t.id);
      } else summary.tagsAdded++;
      await db.tags.add(t);
      byId.set(t.id, t);
      byName.set(key(t.name), t);
      tagMap.set(t.id, t.id);
    }

    // --- notities ---
    const incoming = data.notes.filter((n) => !gone(n));
    const current = await db.notes.bulkGet(incoming.map((n) => n.id));
    const toPut: Note[] = [];
    for (const [i, raw] of incoming.entries()) {
      await revive(raw.id);
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
    }
    await db.notes.bulkPut(toPut);

    // Notities die naar een verdwenen tag wijzen, krijgen geen tag.
    await db.notes.filter((n) => n.tagId !== null && !byId.has(n.tagId)).modify({ tagId: null });

    if (mode === 'replace') {
      const settings = { ...(await loadSettings()), ...data.settings };
      await db.settings.put({ ...settings, key: 'settings' });
      summary.settings = settings;
    }
    return summary;
  });
}
