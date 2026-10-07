import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { createNote } from '../src/db/notes';
import { createTag } from '../src/db/tags';
import { loadSettings, saveSettings } from '../src/db/settings';
import { buildBackup, backupFileName } from '../src/backup/export';
import { applyImport, parseBackup } from '../src/backup/import';
import { validateSettings } from '../src/backup/schema';
import { input, resetDb } from './helpers';

beforeEach(resetDb);

const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

async function seed() {
  const vogels = await createTag('Vogels');
  const strand = await createTag('Strand');
  await createNote(input({ tagId: vogels.id, text: '<p>Veel <strong>lepelaars</strong></p><ul><li>12 stuks</li></ul>' }));
  await createNote(input({ tagId: strand.id, locationSource: 'gps', accuracy: 8, rating: null, title: undefined }));
  await createNote(input({ text: '', lat: -33.9, lng: 151.2 }));
  await saveSettings({ ...(await loadSettings()), theme: 'dark', samePlaceRadiusM: 150 });
  return { vogels, strand };
}

describe('export', () => {
  it('heeft het afgesproken formaat en bestandsnaam', async () => {
    await seed();
    const data = await buildBackup();
    expect(data.app).toBe('plekboek');
    expect(data.schemaVersion).toBe(1);
    expect(data.notes).toHaveLength(3);
    expect(data.tags).toHaveLength(2);
    expect(data.settings).toEqual({ language: 'system', theme: 'dark', samePlaceRadiusM: 150, backupReminderDays: 30 });
    expect(backupFileName(new Date(2026, 9, 2))).toBe('plekboek-backup-2026-10-02.json');
  });
});

describe('round-trip', () => {
  it('export → wissen → import levert identieke data op', async () => {
    await seed();
    const notes = byId(await db.notes.toArray());
    const tags = byId(await db.tags.toArray());
    const settings = await loadSettings();
    const json = JSON.stringify(await buildBackup());

    await resetDb();
    const parsed = parseBackup(json);
    if (!parsed.ok) throw new Error(parsed.error);
    const summary = await applyImport(parsed.data, 'replace');

    expect(summary).toMatchObject({ added: 3, updated: 0, skipped: 0, tagsAdded: 2 });
    expect(byId(await db.notes.toArray())).toEqual(notes);
    expect(byId(await db.tags.toArray())).toEqual(tags);
    expect(await loadSettings()).toEqual(settings);
  });
});

describe('import', () => {
  it('neemt geldige standaardfilters over en negeert ongeldige', () => {
    const ok = { tagIds: ['t1', '__none__'], from: '2026-03-01', inMapArea: true };
    expect(validateSettings({ searchDefaults: ok }).searchDefaults).toEqual(ok);
    expect(validateSettings({ searchDefaults: { tagIds: [], from: '1 maart' } }).searchDefaults).toBeUndefined();
    expect(validateSettings({ searchDefaults: { tagIds: [5] } }).searchDefaults).toBeUndefined();
  });

  it('weigert andere bestanden en nieuwere versies netjes', () => {
    expect(parseBackup('{niet json')).toEqual({ ok: false, error: 'invalidJson' });
    expect(parseBackup('{"app":"iets"}')).toEqual({ ok: false, error: 'notPlekboek' });
    expect(parseBackup('{"app":"plekboek","schemaVersion":2}')).toEqual({ ok: false, error: 'newerVersion' });
  });

  it('slaat ongeldige records over en schoont tekst op', async () => {
    await seed();
    const data = await buildBackup();
    const good = data.notes[0];
    const raw = {
      ...data,
      notes: [
        { ...good, text: '<p onclick="x">ok<script>bad()</script><img src=x></p>', textPlain: 'gelogen' },
        { ...good, id: 'b', lat: 91 },
        { ...good, id: 'c', lng: -181 },
        { ...good, id: 'd', rating: 6 },
        { ...good, id: 'd2', activityRating: 0 },
        { ...good, id: 'e', observedAt: 'gisteren' },
        { ...good, id: 'f', locationSource: 'wifi' },
        'onzin',
      ],
      tags: [...data.tags, { id: 'x', name: '', color: '#000000' }],
    };
    const parsed = parseBackup(JSON.stringify(raw));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.data.notes).toHaveLength(1);
    expect(parsed.data.notes[0].text).toBe('<p>ok</p>');
    expect(parsed.data.notes[0].textPlain).toBe('ok');
    expect(parsed.data.invalid).toBe(8);
  });

  it('samenvoegen: nieuwste updatedAt wint en tags met dezelfde naam worden samengevoegd', async () => {
    const { vogels } = await seed();
    const local = await db.notes.toArray();
    const backup = await buildBackup();

    // Ander toestel: dezelfde tagnaam met een ander id, één nieuwere en één oudere wijziging, één nieuwe notitie.
    const otherVogels = { ...vogels, id: 'zzz-ander-id', name: 'vogels' };
    const [n0, n1] = backup.notes;
    const file = {
      ...backup,
      tags: [otherVogels, { ...vogels, id: 'nieuw-tag', name: 'Bos', color: '#4f8a2b' }],
      notes: [
        { ...n0, title: 'Nieuwer', updatedAt: '2099-01-01T00:00:00+00:00', tagId: 'zzz-ander-id' },
        { ...n1, title: 'Ouder', updatedAt: '2000-01-01T00:00:00+00:00' },
        { ...n0, id: 'nieuwe-notitie', tagId: 'zzz-ander-id' },
      ],
      settings: { ...backup.settings, theme: 'light' },
    };
    const parsed = parseBackup(JSON.stringify(file));
    if (!parsed.ok) throw new Error(parsed.error);
    const summary = await applyImport(parsed.data, 'merge');

    expect(summary).toMatchObject({ added: 1, updated: 1, unchanged: 1, skipped: 0, tagsAdded: 1, settings: null });
    expect((await db.notes.get(n0.id))!.title).toBe('Nieuwer');
    expect((await db.notes.get(n0.id))!.tagId).toBe(vogels.id);
    expect((await db.notes.get(n1.id))!.title).toBe(local.find((n) => n.id === n1.id)!.title);
    expect((await db.notes.get('nieuwe-notitie'))!.tagId).toBe(vogels.id);
    expect(await db.tags.count()).toBe(3);
    expect((await loadSettings()).theme).toBe('dark'); // samenvoegen laat instellingen staan
  });

  it('vervangen is alles of niets', async () => {
    await seed();
    const notesBefore = byId(await db.notes.toArray());
    const parsed = parseBackup(JSON.stringify(await buildBackup()));
    if (!parsed.ok) throw new Error(parsed.error);
    // Een record zonder sleutel laat de transactie halverwege (na het wissen) mislukken.
    const broken = { ...parsed.data, tags: [], notes: [{ ...parsed.data.notes[0], id: undefined as unknown as string }] };
    await expect(applyImport(broken, 'replace')).rejects.toBeTruthy();
    expect(byId(await db.notes.toArray())).toEqual(notesBefore);
    expect(await db.tags.count()).toBe(2);
  });
});
