import type { Note } from '../db/types';
import { distance, type LatLng } from './distance';
import { reverseName } from './geocode';

export type TitleSuggestion =
  | { source: 'nearby'; title: string; note: Note; distance: number }
  | { source: 'geocode'; title: string };

/** Eerst lokaal: de titel van de dichtstbijzijnde eerdere notitie binnen de straal. Werkt offline. */
export function nearbyTitle(at: LatLng, notes: Note[], radiusM: number, excludeId?: string): TitleSuggestion | null {
  let best: { note: Note; d: number } | null = null;
  for (const n of notes) {
    if (n.id === excludeId || !n.title) continue;
    const d = distance(at, n);
    if (d <= radiusM && (!best || d < best.d)) best = { note: n, d };
  }
  return best ? { source: 'nearby', title: best.note.title!, note: best.note, distance: best.d } : null;
}

/** Titelvoorstel: eerst een nabije notitie, anders (online) reverse geocoding. */
export async function suggestTitle(
  at: LatLng,
  notes: Note[],
  radiusM: number,
  lang: string,
  excludeId?: string,
): Promise<TitleSuggestion | null> {
  const local = nearbyTitle(at, notes, radiusM, excludeId);
  if (local) return local;
  if (!navigator.onLine) return null;
  const title = await reverseName(at.lat, at.lng, lang);
  return title ? { source: 'geocode', title } : null;
}
