import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { createNote, deleteNote, EMPTY_CRITERIA, filterNotes, getNote, NO_TAG, sortNotes, updateNote } from '../src/db/notes';
import { createTag, deleteTag, DuplicateTagError, tagCounts, updateTag } from '../src/db/tags';
import { loadSettings, saveSettings } from '../src/db/settings';
import { normalizeText, toPlain } from '../src/text/sanitize';
import { input, resetDb } from './helpers';

beforeEach(resetDb);

describe('opmaak', () => {
  it('laat alleen de whitelist door, zonder attributen', () => {
    const { text } = normalizeText(
      '<p style="color:red">Hoi <strong class="x">vet</strong> <a href="x">link</a><script>alert(1)</script><img src=x onerror=alert(1)><span>!</span></p><h1>kop</h1>',
    );
    expect(text).toBe('<p>Hoi <strong>vet</strong> link!</p>kop');
  });

  it('berekent platte tekst met regelovergangen tussen blokken', () => {
    expect(toPlain('<p>Veel <strong>lepelaars</strong></p><ul><li>12 stuks</li></ul>')).toBe('Veel lepelaars\n12 stuks');
    expect(toPlain('<ul><li><p>a</p></li><li><p>b</p></li></ul><p>c<br>d</p>')).toBe('a\nb\nc\nd');
  });

  it('maakt van een lege editor een lege tekst', () => {
    expect(normalizeText('<p></p>')).toEqual({ text: '', textPlain: '' });
  });
});

describe('notities', () => {
  it('maakt, leest, wijzigt en verwijdert', async () => {
    const n = await createNote(input({ text: '<p>a <em>b</em></p>', accuracy: 8 }));
    expect(n.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(n.textPlain).toBe('a b');
    expect(n.accuracy).toBeUndefined(); // accuracy alleen bij GPS
    expect(await getNote(n.id)).toEqual(n);

    await new Promise((r) => setTimeout(r, 1100));
    const u = await updateNote(n.id, input({ title: '  Nieuwe naam ', locationSource: 'gps', accuracy: 5 }));
    expect(u.title).toBe('Nieuwe naam');
    expect(u.accuracy).toBe(5);
    expect(u.createdAt).toBe(n.createdAt);
    expect(u.updatedAt > n.updatedAt).toBe(true);

    await deleteNote(n.id);
    expect(await getNote(n.id)).toBeUndefined();
  });
});

describe('tags', () => {
  it('weigert dubbele namen (hoofdletterongevoelig)', async () => {
    await createTag('Vogels');
    await expect(createTag('vogels')).rejects.toBeInstanceOf(DuplicateTagError);
    const t = await createTag('Strand');
    await expect(updateTag(t.id, { name: 'VOGELS' })).rejects.toBeInstanceOf(DuplicateTagError);
  });

  it('bewaart een opgeschoond sjabloon en verwijdert een leeg sjabloon', async () => {
    const tag = await createTag('Vogels');
    await updateTag(tag.id, { template: '<p onclick="x">Weer: <script>bad()</script></p><ul><li>Gezien:</li></ul>' });
    expect((await db.tags.get(tag.id))!.template).toBe('<p>Weer: </p><ul><li>Gezien:</li></ul>');
    await updateTag(tag.id, { template: '<p></p>' });
    expect((await db.tags.get(tag.id))!.template).toBeUndefined();
  });

  it('kiest automatisch een andere kleur per tag', async () => {
    const a = await createTag('A');
    const b = await createTag('B');
    expect(a.color).not.toBe(b.color);
  });

  it('verwijderen: notities krijgen geen tag of gaan naar een andere tag', async () => {
    const a = await createTag('A');
    const b = await createTag('B');
    const n1 = await createNote(input({ tagId: a.id }));
    await deleteTag(a.id, b.id);
    expect((await getNote(n1.id))!.tagId).toBe(b.id);
    expect((await tagCounts()).get(b.id)).toBe(1);
    await deleteTag(b.id, null);
    expect((await getNote(n1.id))!.tagId).toBeNull();
    expect(await db.tags.count()).toBe(0);
  });
});

describe('zoeken en sorteren', () => {
  it('filtert op tekst (accentongevoelig), tag, sterren, periode, tijdstip en kaartgebied', async () => {
    const vogels = await createTag('Vogels');
    const a = await createNote(input({ title: 'Café de Brug', text: '<p>Koffie</p>', rating: 2, activityRating: 5, observedAt: '2026-08-01T20:00:00+02:00' }));
    const b = await createNote(input({ title: 'Hut', text: '<p>Lepelaars</p>', tagId: vogels.id, rating: 5 }));
    const c = await createNote(input({ title: 'Ver weg', lat: 40, lng: -3, rating: null, observedAt: '2026-01-01T03:00:00+01:00' }));
    const notes = await db.notes.toArray();
    const tags = new Map([[vogels.id, vogels]]);
    const ids = (crit: Partial<typeof EMPTY_CRITERIA>) =>
      filterNotes(notes, tags, { ...EMPTY_CRITERIA, ...crit }).map((n) => n.title).sort();

    expect(ids({ query: 'cafe' })).toEqual([a.title]);
    expect(ids({ query: 'VOGELS' })).toEqual([b.title]); // tagnaam
    expect(ids({ query: 'lepel hut' })).toEqual([b.title]);
    expect(ids({ tagIds: [vogels.id] })).toEqual([b.title]);
    expect(ids({ tagIds: [NO_TAG] })).toEqual([a.title, c.title].sort());
    expect(ids({ tagIds: [vogels.id, NO_TAG] })).toEqual([a.title, b.title, c.title].sort());
    expect(ids({ minRating: 3 })).toEqual([b.title]);
    expect(ids({ minActivityRating: 4 })).toEqual([a.title]);
    expect(ids({ from: '2026-08-01', to: '2026-08-31' })).toEqual([a.title]);
    expect(ids({ timesOfDay: ['night'] })).toEqual([c.title]);
    expect(ids({ timesOfDay: ['morning', 'evening'] })).toEqual([a.title, b.title].sort());
    expect(ids({ bounds: { south: 50, north: 54, west: 3, east: 8 } })).toEqual([a.title, b.title].sort());
  });

  it('sorteert op beoordeling, dan nieuwste; zonder beoordeling achteraan', async () => {
    const mk = (title: string, rating: 1 | 2 | 3 | 4 | 5 | null, observedAt: string) => ({ ...input({ title, rating, observedAt }) });
    await createNote(mk('oud-5', 5, '2026-01-01T10:00:00+01:00'));
    await createNote(mk('nieuw-5', 5, '2026-09-01T10:00:00+02:00'));
    await createNote(mk('3', 3, '2026-10-01T10:00:00+02:00'));
    await createNote(mk('geen-nieuw', null, '2026-10-02T10:00:00+02:00'));
    await createNote(mk('geen-oud', null, '2025-10-02T10:00:00+02:00'));
    const notes = await db.notes.toArray();
    expect(sortNotes(notes).map((n) => n.title)).toEqual(['nieuw-5', 'oud-5', '3', 'geen-nieuw', 'geen-oud']);
    expect(sortNotes(notes, 'date')[0].title).toBe('geen-nieuw');
  });
});

describe('instellingen', () => {
  it('heeft standaardwaarden en bewaart wijzigingen', async () => {
    const s = await loadSettings();
    expect(s).toEqual({ language: 'system', theme: 'system', samePlaceRadiusM: 100, backupReminderDays: 30 });
    await saveSettings({ ...s, theme: 'dark' });
    expect((await loadSettings()).theme).toBe('dark');
  });
});
