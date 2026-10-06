import { describe, expect, it } from 'vitest';
import { bestTime, nearbyNotes } from '../src/analysis/bestTime';
import { distance } from '../src/geo/distance';
import { pickName } from '../src/geo/geocode';
import { nearbyTitle } from '../src/geo/suggestTitle';
import { fromInputs, timeOfDay, toInputs, wallClock } from '../src/lib/time';
import type { Note, Rating } from '../src/db/types';

let seq = 0;
function note(observedAt: string, rating: Rating | null, lat = 53.3912, lng = 6.2134, title?: string): Note {
  return {
    id: `n${seq++}`,
    lat,
    lng,
    locationSource: 'map',
    observedAt,
    title,
    text: '',
    textPlain: '',
    tagId: null,
    rating,
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

describe('tijd', () => {
  it('gebruikt de kloktijd uit de string, los van de tijdzone van het toestel', () => {
    const w = wallClock('2026-09-28T07:15:00+02:00');
    expect(w).toEqual({ year: 2026, month: 9, day: 28, hour: 7, minute: 15, weekday: 0 });
    expect(wallClock('2026-10-04T23:59:00-05:00').weekday).toBe(6); // zondag
  });

  it('deelt het etmaal in vier tijdvakken', () => {
    expect([0, 5, 6, 11, 12, 17, 18, 23].map(timeOfDay)).toEqual([
      'night', 'night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening',
    ]);
  });

  it('zet datum/tijd-invoer heen en terug om', () => {
    const iso = fromInputs('2026-03-29', '07:15');
    expect(iso).toMatch(/^2026-03-29T07:15:00[+-]\d{2}:\d{2}$/);
    expect(toInputs(iso)).toEqual({ date: '2026-03-29', time: '07:15' });
  });
});

describe('afstand', () => {
  it('berekent afstanden met haversine', () => {
    expect(distance({ lat: 52.3731, lng: 4.8922 }, { lat: 51.9225, lng: 4.4792 })).toBeGreaterThan(57_000);
    expect(distance({ lat: 52.3731, lng: 4.8922 }, { lat: 51.9225, lng: 4.4792 })).toBeLessThan(58_500);
    expect(distance({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
  });
});

describe('titelvoorstel', () => {
  it('neemt de titel van de dichtstbijzijnde notitie binnen de straal over', () => {
    const near = note('2026-09-14T07:40:00+02:00', 4, 53.3913, 6.2134, 'Vogelhut De Kiekendief');
    const nearer = note('2026-09-14T07:40:00+02:00', 4, 53.3912, 6.21345, 'Dichtbij');
    const far = note('2026-09-14T07:40:00+02:00', 4, 53.4, 6.2134, 'Ver');
    const s = nearbyTitle({ lat: 53.3912, lng: 6.2134 }, [far, near, nearer], 100);
    expect(s?.title).toBe('Dichtbij');
    expect(nearbyTitle({ lat: 53.3912, lng: 6.2134 }, [far], 100)).toBeNull();
    expect(nearbyTitle({ lat: 53.3912, lng: 6.2134 }, [nearer], 100, nearer.id)).toBeNull();
  });

  it('kiest de meest specifieke naam uit reverse geocoding', () => {
    expect(pickName({ name: 'Vogelhut De Kiekendief', address: { road: 'Dijk' } })).toBe('Vogelhut De Kiekendief');
    expect(pickName({ name: '', address: { road: 'Dorpsstraat', town: 'Ootmarsum' } })).toBe('Dorpsstraat, Ootmarsum');
    expect(pickName({ address: { suburb: 'Centrum', city: 'Utrecht' } })).toBe('Centrum, Utrecht');
    expect(pickName({ address: { village: 'Paesens' } })).toBe('Paesens');
    expect(pickName({ error: 'Unable to geocode' })).toBeNull();
  });
});

describe('beste moment', () => {
  it('zoekt notities binnen de straal, nieuwste eerst', () => {
    const a = note('2026-09-28T07:15:00+02:00', 5);
    const b = note('2026-09-14T07:40:00+02:00', 4, 53.3913, 6.2135);
    const c = note('2026-09-20T07:40:00+02:00', 4, 53.5, 6.2);
    const res = nearbyNotes(a, [b, c, a], 100);
    expect(res.map((x) => x.note.id)).toEqual([a.id, b.id]);
    expect(res[1].distance).toBeGreaterThan(5);
  });

  it('toont pas iets vanaf 2 beoordeelde notities', () => {
    expect(bestTime([note('2026-09-28T07:15:00+02:00', 5), note('2026-09-27T07:15:00+02:00', null)])).toBeNull();
  });

  it('berekent gemiddelden per tijdvak, weekdag en maand en markeert de beste', () => {
    const notes = [
      note('2026-09-28T07:15:00+02:00', 5), // ma, ochtend, sep
      note('2026-09-14T07:40:00+02:00', 4), // ma, ochtend, sep
      note('2026-09-03T18:05:00+02:00', 3), // do, avond, sep
      note('2026-08-24T19:30:00+02:00', 4), // ma, avond, aug
      note('2026-08-10T13:20:00+02:00', 2), // ma, middag, aug
      note('2026-08-11T13:20:00+02:00', null),
    ];
    const r = bestTime(notes)!;
    expect(r.rated).toBe(5);
    expect(r.timeOfDay).toEqual([
      { key: 'morning', avg: 4.5, count: 2 },
      { key: 'afternoon', avg: 2, count: 1 },
      { key: 'evening', avg: 3.5, count: 2 },
      { key: 'night', avg: null, count: 0 },
    ]);
    expect(r.weekday[0]).toEqual({ key: 0, avg: 3.75, count: 4 });
    expect(r.month).toEqual([
      { key: 8, avg: 3, count: 2 },
      { key: 9, avg: 4, count: 3 },
    ]);
    expect(r.best).toEqual({ timeOfDay: 'morning', weekday: 0, month: 9 });
  });
});
