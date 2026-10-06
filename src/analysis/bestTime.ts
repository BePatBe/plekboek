import type { Note } from '../db/types';
import { distance, type LatLng } from '../geo/distance';
import { TIMES_OF_DAY, timeOfDay, wallClock, type TimeOfDay } from '../lib/time';

export interface Nearby {
  note: Note;
  distance: number;
}

/** Alle notities binnen de straal (inclusief de notitie zelf), nieuwste eerst. */
export function nearbyNotes(at: LatLng, notes: Note[], radiusM: number): Nearby[] {
  return notes
    .map((note) => ({ note, distance: distance(at, note) }))
    .filter((x) => x.distance <= radiusM)
    .sort((a, b) => new Date(b.note.observedAt).getTime() - new Date(a.note.observedAt).getTime());
}

export interface Bucket<K> {
  key: K;
  avg: number | null;
  count: number;
}

export interface BestTime {
  rated: number;
  timeOfDay: Bucket<TimeOfDay>[];
  /** 0 = maandag … 6 = zondag */
  weekday: Bucket<number>[];
  /** alleen maanden met beoordeelde notities, 1–12 */
  month: Bucket<number>[];
  best: { timeOfDay: TimeOfDay | null; weekday: number | null; month: number | null };
}

export const MIN_RATED = 2;

function group<K>(keys: K[], notes: Note[], keyOf: (n: Note) => K): Bucket<K>[] {
  return keys.map((key) => {
    const ratings = notes.filter((n) => keyOf(n) === key).map((n) => n.rating!);
    const count = ratings.length;
    return { key, count, avg: count ? ratings.reduce((s, r) => s + r, 0) / count : null };
  });
}

/** Hoogste gemiddelde; bij gelijkspel telt het groepje met meer notities. */
function bestOf<K>(buckets: Bucket<K>[]): K | null {
  let best: Bucket<K> | null = null;
  for (const b of buckets) {
    if (b.avg == null) continue;
    if (!best || b.avg > best.avg! || (b.avg === best.avg && b.count > best.count)) best = b;
  }
  return best?.key ?? null;
}

/** Gemiddelde beoordeling per tijdvak, weekdag en maand. Null bij minder dan 2 beoordeelde notities. */
export function bestTime(notes: Note[]): BestTime | null {
  const rated = notes.filter((n) => n.rating != null);
  if (rated.length < MIN_RATED) return null;
  const tod = group(TIMES_OF_DAY, rated, (n) => timeOfDay(wallClock(n.observedAt).hour));
  const weekday = group([0, 1, 2, 3, 4, 5, 6], rated, (n) => wallClock(n.observedAt).weekday);
  const month = group([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], rated, (n) => wallClock(n.observedAt).month).filter(
    (b) => b.count > 0,
  );
  return {
    rated: rated.length,
    timeOfDay: tod,
    weekday,
    month,
    best: { timeOfDay: bestOf(tod), weekday: bestOf(weekday), month: bestOf(month) },
  };
}
