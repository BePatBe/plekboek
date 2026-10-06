import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { createNote, deleteNote, updateNote } from '../src/db/notes';
import { createTag, deleteTag } from '../src/db/tags';
import { buildBackup } from '../src/backup/export';
import { applyImport, parseBackup } from '../src/backup/import';
import type { BackupFile } from '../src/backup/schema';
import type { Note, Tag } from '../src/db/types';
import { syncWith, type Remote } from '../src/sync/sync';
import { input, resetDb } from './helpers';

beforeEach(resetDb);

/** Nep-cloud in het geheugen; `onRead` kan een ander toestel laten schrijven tussen lezen en schrijven. */
function memoryRemote(initial: BackupFile | null = null) {
  let text = initial ? JSON.stringify(initial) : null;
  let version = initial ? 1 : 0;
  let writes = 0;
  const remote: Remote & { file: () => BackupFile | null; writes: () => number; onRead?: () => void; set: (b: BackupFile) => void } = {
    async read() {
      const r = text ? { text, version: String(version) } : null;
      remote.onRead?.();
      return r;
    },
    async version() {
      return text ? String(version) : null;
    },
    async write(t) {
      text = t;
      version++;
      writes++;
    },
    file: () => (text ? JSON.parse(text) : null),
    writes: () => writes,
    set(b) {
      text = JSON.stringify(b);
      version++;
    },
  };
  return remote;
}

/** Een bestand zoals een ander toestel het zou schrijven. */
function otherDevice(parts: { notes?: Note[]; tags?: Tag[]; deletions?: BackupFile['deletions'] }): BackupFile {
  return {
    app: 'plekboek',
    schemaVersion: 1,
    exportedAt: '2026-10-06T12:00:00+02:00',
    notes: parts.notes ?? [],
    tags: parts.tags ?? [],
    deletions: parts.deletions ?? [],
    settings: { language: 'en', theme: 'dark', samePlaceRadiusM: 300, backupReminderDays: 0 },
  };
}

const later = (iso: string, s = 60) => new Date(Date.parse(iso) + s * 1000).toISOString();

describe('synchroniseren', () => {
  it('eerste keer: lokale notities naar een lege cloud', async () => {
    await createNote(input({ title: 'A' }));
    const remote = memoryRemote();
    const r = await syncWith(remote);
    expect(r).toEqual({ pulled: null, uploaded: true });
    expect(remote.file()!.notes.map((n) => n.title)).toEqual(['A']);
  });

  it('haalt notities van een ander toestel op en schrijft niet als er niets verandert', async () => {
    const a = await createNote(input({ title: 'Hier' }));
    const remote = memoryRemote();
    await syncWith(remote);
    const theirs = { ...a, id: 'van-de-laptop', title: 'Daar' };
    remote.set({ ...remote.file()!, notes: [...remote.file()!.notes, theirs] });

    const r = await syncWith(remote);
    expect(r.pulled).toMatchObject({ added: 1, updated: 0 });
    expect((await db.notes.get('van-de-laptop'))!.title).toBe('Daar');
    expect(r.uploaded).toBe(false); // cloud had al alles
    const writes = remote.writes();
    await syncWith(remote);
    expect(remote.writes()).toBe(writes);
  });

  it('synchroniseert geen instellingen', async () => {
    const remote = memoryRemote(otherDevice({}));
    await syncWith(remote);
    const s = await db.settings.get('settings');
    expect(s?.theme ?? 'system').toBe('system');
  });

  it('een verwijdering op dit toestel verdwijnt ook in de cloud', async () => {
    const a = await createNote(input({ title: 'Weg' }));
    const remote = memoryRemote();
    await syncWith(remote);
    await deleteNote(a.id);
    await syncWith(remote);
    expect(remote.file()!.notes).toHaveLength(0);
    expect(remote.file()!.deletions).toEqual([expect.objectContaining({ id: a.id, kind: 'note' })]);
  });

  it('een verwijdering elders verwijdert hier, behalve als de notitie hier later is gewijzigd', async () => {
    const a = await createNote(input({ title: 'A' }));
    const b = await createNote(input({ title: 'B' }));
    const remote = memoryRemote(
      otherDevice({
        deletions: [
          { id: a.id, kind: 'note', deletedAt: later(a.updatedAt) },
          { id: b.id, kind: 'note', deletedAt: b.updatedAt },
        ],
      }),
    );
    await new Promise((r) => setTimeout(r, 1100));
    await updateNote(b.id, input({ title: 'B gewijzigd' })); // ná de verwijdering
    const r = await syncWith(remote);
    expect(r.pulled!.deleted).toBe(1);
    expect(await db.notes.get(a.id)).toBeUndefined();
    expect((await db.notes.get(b.id))!.title).toBe('B gewijzigd');
    expect((await db.deletions.get(b.id))).toBeUndefined(); // b leeft weer
    expect(remote.file()!.notes.map((n) => n.id)).toEqual([b.id]);
  });

  it('een verwijderde notitie komt niet terug via een oud bestand', async () => {
    const a = await createNote(input({ title: 'A' }));
    const old = await buildBackup();
    await deleteNote(a.id);
    const parsed = parseBackup(JSON.stringify(old));
    if (!parsed.ok) throw new Error();
    await applyImport(parsed.data, 'merge');
    expect(await db.notes.get(a.id)).toBeUndefined();
  });

  it('tags met dezelfde naam komen op beide toestellen op dezelfde tag uit', async () => {
    const mine = await createTag('Vogels');
    const n = await createNote(input({ tagId: mine.id }));
    const theirTag: Tag = { ...mine, id: '00000000-aaaa-4aaa-8aaa-000000000000', name: 'vogels' }; // kleiner id wint
    const theirNote = { ...n, id: 'hun-notitie', tagId: theirTag.id };
    const remote = memoryRemote(otherDevice({ tags: [theirTag], notes: [theirNote] }));

    await syncWith(remote);
    expect((await db.tags.toArray()).map((t) => t.id)).toEqual([theirTag.id]);
    expect((await db.notes.get(n.id))!.tagId).toBe(theirTag.id);
    expect((await db.notes.get('hun-notitie'))!.tagId).toBe(theirTag.id);
    expect((await db.deletions.get(mine.id))!.kind).toBe('tag');
    const cloud = remote.file()!;
    expect(cloud.tags.map((t) => t.id)).toEqual([theirTag.id]);
    expect(cloud.notes.every((x) => x.tagId === theirTag.id)).toBe(true);
  });

  it('een verwijderde tag elders: notities hier verliezen die tag', async () => {
    const tag = await createTag('Strand');
    const n = await createNote(input({ tagId: tag.id }));
    const remote = memoryRemote(otherDevice({ deletions: [{ id: tag.id, kind: 'tag', deletedAt: later(tag.updatedAt) }] }));
    await syncWith(remote);
    expect(await db.tags.count()).toBe(0);
    expect((await db.notes.get(n.id))!.tagId).toBeNull();
  });

  it('lokaal tag verwijderen synchroniseert naar de cloud', async () => {
    const tag = await createTag('Strand');
    await createNote(input({ tagId: tag.id }));
    const remote = memoryRemote();
    await syncWith(remote);
    await deleteTag(tag.id, null);
    await syncWith(remote);
    expect(remote.file()!.tags).toHaveLength(0);
    expect(remote.file()!.notes[0].tagId).toBeNull();
  });

  it('schrijft een ander toestel tussendoor, dan begint de ronde opnieuw', async () => {
    await createNote(input({ title: 'Hier' }));
    const remote = memoryRemote(otherDevice({}));
    let first = true;
    remote.onRead = () => {
      if (!first) return;
      first = false;
      const n = { ...(remote.file()!), notes: [{ ...(input() as Note), id: 'tussendoor', title: 'Tussendoor', textPlain: '', createdAt: '2026-10-06T10:00:00+02:00', updatedAt: '2026-10-06T10:00:00+02:00' }] };
      remote.set(n);
    };
    await syncWith(remote);
    expect((await db.notes.get('tussendoor'))!.title).toBe('Tussendoor');
    expect(remote.file()!.notes.map((n) => n.title).sort()).toEqual(['Hier', 'Tussendoor']);
  });

  it('weigert een kapot sync-bestand zonder lokale data aan te raken', async () => {
    await createNote(input());
    const remote = memoryRemote();
    await remote.write('{"app":"iets anders"}');
    await expect(syncWith(remote)).rejects.toThrow('notPlekboek');
    expect(await db.notes.count()).toBe(1);
  });
});
