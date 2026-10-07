import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { createNote, deleteNote, updateNote } from '../src/db/notes';
import { createTag, deleteTag } from '../src/db/tags';
import { buildBackup } from '../src/backup/export';
import { applyImport, parseBackup } from '../src/backup/import';
import type { BackupFile } from '../src/backup/schema';
import type { Note, Tag } from '../src/db/types';
import { newSession, open, parseCode, seal } from '../src/sync/relay';
import { input, resetDb } from './helpers';

beforeEach(resetDb);

/** Wat het andere toestel stuurt, samenvoegen zoals de synchronisatie dat doet. */
async function mergeFrom(file: BackupFile) {
  const parsed = parseBackup(JSON.stringify(file));
  if (!parsed.ok) throw new Error(parsed.error);
  return applyImport(parsed.data, 'merge');
}

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
const ids = <T extends { id: string }>(xs: T[]) => xs.map((x) => x.id).sort();

describe('samenvoegen tussen toestellen', () => {
  it('beide toestellen eindigen met dezelfde notities, tags en verwijderingen', async () => {
    // Toestel A
    const vogelsA = await createTag('Vogels');
    const shared = await createNote(input({ title: 'Gedeeld', tagId: vogelsA.id }));
    const onlyA = await createNote(input({ title: 'Alleen A' }));
    const gone = await createNote(input({ title: 'Wordt gewist' }));
    const a0 = await buildBackup();

    // Toestel B: kreeg eerder alles van A, wijzigde daarna zelf
    await resetDb();
    await mergeFrom(a0);
    await new Promise((r) => setTimeout(r, 1100));
    await updateNote(shared.id, input({ title: 'Gedeeld (door B gewijzigd)', tagId: vogelsA.id }));
    await deleteNote(gone.id);
    await createNote(input({ title: 'Alleen B' }));
    const b0 = await buildBackup();

    // A wist intussen "Alleen A" niet, maar voegt iets toe
    await resetDb();
    await mergeFrom(a0);
    await createNote(input({ title: 'Nog een van A' }));
    const a1 = await buildBackup();

    // Uitwisselen: A voegt B samen, B voegt A samen
    await resetDb();
    await mergeFrom(a1);
    await mergeFrom(b0);
    const aEnd = await buildBackup();

    await resetDb();
    await mergeFrom(b0);
    await mergeFrom(a1);
    const bEnd = await buildBackup();

    expect(ids(aEnd.notes)).toEqual(ids(bEnd.notes));
    expect(aEnd.notes.map((n) => n.title).sort()).toEqual(['Alleen A', 'Alleen B', 'Gedeeld (door B gewijzigd)', 'Nog een van A']);
    expect(ids(aEnd.tags)).toEqual(ids(bEnd.tags));
    expect(ids(aEnd.deletions)).toEqual([gone.id]);
    expect(ids(bEnd.deletions)).toEqual([gone.id]);
    expect(onlyA.id).toBeTruthy();
  });

  it('een verwijdering elders verwijdert hier, behalve als de notitie hier later is gewijzigd', async () => {
    const a = await createNote(input({ title: 'A' }));
    const b = await createNote(input({ title: 'B' }));
    await new Promise((r) => setTimeout(r, 1100));
    await updateNote(b.id, input({ title: 'B gewijzigd' }));
    const summary = await mergeFrom(
      otherDevice({
        deletions: [
          { id: a.id, kind: 'note', deletedAt: later(a.updatedAt) },
          { id: b.id, kind: 'note', deletedAt: b.updatedAt }, // vóór de wijziging hier
        ],
      }),
    );
    expect(summary.deleted).toBe(1);
    expect(await db.notes.get(a.id)).toBeUndefined();
    expect((await db.notes.get(b.id))!.title).toBe('B gewijzigd');
    expect(await db.deletions.get(b.id)).toBeUndefined(); // b leeft weer
  });

  it('een gewiste notitie komt niet terug via een oud bestand', async () => {
    const a = await createNote(input({ title: 'A' }));
    const old = await buildBackup();
    await deleteNote(a.id);
    await mergeFrom(old);
    expect(await db.notes.get(a.id)).toBeUndefined();
  });

  it('tags met dezelfde naam komen op beide toestellen op dezelfde tag uit', async () => {
    const mine = await createTag('Vogels');
    const n = await createNote(input({ tagId: mine.id }));
    const theirTag: Tag = { ...mine, id: '00000000-aaaa-4aaa-8aaa-000000000000', name: 'vogels' }; // kleinste id wint
    const theirNote = { ...n, id: 'hun-notitie', tagId: theirTag.id };
    await mergeFrom(otherDevice({ tags: [theirTag], notes: [theirNote] }));
    expect(ids(await db.tags.toArray())).toEqual([theirTag.id]);
    expect((await db.notes.get(n.id))!.tagId).toBe(theirTag.id);
    expect((await db.notes.get('hun-notitie'))!.tagId).toBe(theirTag.id);
    expect((await db.deletions.get(mine.id))!.kind).toBe('tag');
  });

  it('een gewiste tag elders: notities hier verliezen die tag', async () => {
    const tag = await createTag('Strand');
    const n = await createNote(input({ tagId: tag.id }));
    await mergeFrom(otherDevice({ deletions: [{ id: tag.id, kind: 'tag', deletedAt: later(tag.updatedAt) }] }));
    expect(await db.tags.count()).toBe(0);
    expect((await db.notes.get(n.id))!.tagId).toBeNull();
  });

  it('telt bijgewerkte en verwijderde tags in de samenvatting', async () => {
    const a = await createTag('Vogels');
    const b = await createTag('Strand');
    const summary = await mergeFrom(
      otherDevice({
        tags: [{ ...a, template: '<p>Weer:</p>', updatedAt: later(a.updatedAt) }],
        deletions: [{ id: b.id, kind: 'tag', deletedAt: later(b.updatedAt) }],
      }),
    );
    expect(summary).toMatchObject({ tagsAdded: 0, tagsUpdated: 1, tagsDeleted: 1 });
    expect((await db.tags.get(a.id))!.template).toBe('<p>Weer:</p>');
  });

  it('tag verwijderen laat een tombstone achter die meegaat in de export', async () => {
    const tag = await createTag('Strand');
    await deleteTag(tag.id, null);
    expect((await buildBackup()).deletions).toEqual([expect.objectContaining({ id: tag.id, kind: 'tag' })]);
  });

  it('samenvoegen laat de instellingen van dit toestel staan', async () => {
    await mergeFrom(otherDevice({}));
    expect((await db.settings.get('settings'))?.theme ?? 'system').toBe('system');
  });
});

describe('code en versleuteling (doorgeefluik)', () => {
  it('maakt een code die het andere toestel kan lezen, met dezelfde sleutel', async () => {
    const a = await newSession();
    expect(a.code).toMatch(/^PB2\|plekboek-[\w-]{22}\|[\w-]{43}$/);
    const b = await parseCode(a.code);
    expect(b.topic).toBe(a.topic);
    const sealed = await seal(a.key, 'host', 'geheime notities ✓');
    expect(await open(b.key, 'host', sealed)).toBe('geheime notities ✓');
  });

  it('elke sessie heeft een ander kanaal en een andere sleutel', async () => {
    const a = await newSession();
    const b = await newSession();
    expect(a.topic).not.toBe(b.topic);
    await expect(open(b.key, 'host', await seal(a.key, 'host', 'x'))).rejects.toMatchObject({ reason: 'wrongKey' });
  });

  it('een pakketje van de ene rol kan niet voor de andere worden aangezien', async () => {
    const a = await newSession();
    await expect(open(a.key, 'join', await seal(a.key, 'host', 'x'))).rejects.toMatchObject({ reason: 'wrongKey' });
  });

  it('versleutelde data bevat de tekst niet en is gecomprimeerd', async () => {
    const a = await newSession();
    const text = JSON.stringify({ notes: Array(200).fill({ title: 'Vogelhut De Kiekendief', text: 'lepelaars' }) });
    const sealed = await seal(a.key, 'join', text);
    expect(new TextDecoder().decode(sealed).includes('Kiekendief')).toBe(false);
    expect(sealed.length).toBeLessThan(text.length / 5);
    expect(await open(a.key, 'join', sealed)).toBe(text);
  });

  it('gemanipuleerde data wordt geweigerd', async () => {
    const a = await newSession();
    const sealed = await seal(a.key, 'host', 'x');
    sealed[sealed.length - 1] ^= 1;
    await expect(open(a.key, 'host', sealed)).rejects.toMatchObject({ reason: 'wrongKey' });
  });

  it('weigert onzin-codes', async () => {
    for (const bad of ['hallo', 'PB1|o|abc', 'PB2|plekboek-kort|AAAA', 'PB2|ander-kanaal-aaaaaaaaaaaaaaaaaaaaaa|' + 'A'.repeat(43)]) {
      await expect(parseCode(bad)).rejects.toMatchObject({ reason: 'badCode' });
    }
  });
});
