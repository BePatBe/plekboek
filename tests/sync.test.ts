import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { createNote, deleteNote, updateNote } from '../src/db/notes';
import { createTag, deleteTag } from '../src/db/tags';
import { buildBackup } from '../src/backup/export';
import { applyImport, parseBackup } from '../src/backup/import';
import type { BackupFile } from '../src/backup/schema';
import type { Note, Tag } from '../src/db/types';
import { BadCode, decode, encode, fromSdp, toSdp, type Signal } from '../src/sync/signal';
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

describe('verbindingscode (QR)', () => {
  // Echte SDP van Chrome (afgekort tot wat ertoe doet, plus regels die we moeten negeren)
  const sdp = [
    'v=0',
    'o=- 123 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=candidate:3891245637 1 udp 2113937151 9f3c1a2b-1111-4c2d-9e7f-0123456789ab.local 54321 typ host generation 0 network-cost 999',
    'a=candidate:842163049 1 udp 1677729535 84.85.86.87 61234 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999',
    'a=candidate:1 1 tcp 1518280447 192.168.1.5 9 typ host tcptype active',
    'a=ice-ufrag:AbCd',
    'a=ice-pwd:0123456789abcdefghijklmn',
    'a=ice-options:trickle',
    'a=fingerprint:sha-256 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9',
    'a=setup:actpass',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n');

  it('haalt de nodige onderdelen uit een SDP (UDP-kandidaten, geen TCP)', () => {
    const s = fromSdp('offer', sdp);
    expect(s.ufrag).toBe('AbCd');
    expect(s.pwd).toBe('0123456789abcdefghijklmn');
    expect(s.setup).toBe('actpass');
    expect(s.fingerprint).toHaveLength(32);
    expect(s.candidates).toEqual([
      { kind: 'host', address: '9f3c1a2b-1111-4c2d-9e7f-0123456789ab.local', port: 54321 },
      { kind: 'srflx', address: '84.85.86.87', port: 61234 },
    ]);
  });

  it('code heen en terug levert hetzelfde op, en blijft kort', () => {
    const s = fromSdp('offer', sdp);
    const code = encode(s);
    expect(code.startsWith('PB1|o|')).toBe(true);
    expect(code.length).toBeLessThan(200);
    const back: Signal = decode(code);
    expect(back).toEqual(s);
    // De opgebouwde SDP bevat weer alles wat nodig is.
    expect(fromSdp('offer', toSdp(back))).toEqual(s);
  });

  it('IPv6-adressen blijven heel', () => {
    const s: Signal = { ...fromSdp('answer', sdp), setup: 'active', candidates: [{ kind: 'host', address: '2001:db8::1', port: 5000 }] };
    expect(decode(encode(s)).candidates[0].address).toBe('2001:db8::1');
  });

  it('weigert onzin', () => {
    expect(() => decode('hallo')).toThrow(BadCode);
    expect(() => decode('PB1|x|a|b|c|x')).toThrow(BadCode);
    expect(() => decode('PB1|o|a|b|AAAA|x')).toThrow(BadCode);
  });
});
