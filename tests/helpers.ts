import { db } from '../src/db/db';
import type { NoteInput } from '../src/db/notes';

export async function resetDb() {
  await db.delete();
  await db.open();
}

export function input(overrides: Partial<NoteInput> = {}): NoteInput {
  return {
    lat: 53.3912,
    lng: 6.2134,
    locationSource: 'map',
    observedAt: '2026-09-28T07:15:00+02:00',
    title: 'Vogelhut',
    text: '<p>Veel lepelaars</p>',
    tagId: null,
    rating: 4,
    ...overrides,
  };
}
