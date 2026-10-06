import { db } from './db';
import type { Note, Rating, Tag } from './types';
import { uuid } from '../lib/uuid';
import { fold, timeOfDay, toLocalIso, wallClock, type TimeOfDay } from '../lib/time';
import { normalizeText } from '../text/sanitize';

export type NoteInput = Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'textPlain'>;

/** Schoont invoer op: HTML door DOMPurify, textPlain opnieuw berekend, lege velden weg. */
export function cleanNote<T extends Omit<Note, 'textPlain'>>(input: T): T & { textPlain: string } {
  const { text, textPlain } = normalizeText(input.text);
  const out: T & { textPlain: string } = { ...input, text, textPlain };
  const title = input.title?.trim();
  if (title) out.title = title;
  else delete out.title;
  if (out.locationSource !== 'gps' || out.accuracy == null) delete out.accuracy;
  return out;
}

export async function createNote(input: NoteInput): Promise<Note> {
  const now = toLocalIso();
  const note = cleanNote({ ...input, id: uuid(), createdAt: now, updatedAt: now });
  await db.notes.add(note);
  return note;
}

export async function updateNote(id: string, input: NoteInput): Promise<Note> {
  const existing = await db.notes.get(id);
  if (!existing) throw new Error(`Note ${id} not found`);
  const note = cleanNote({ ...input, id, createdAt: existing.createdAt, updatedAt: toLocalIso() });
  await db.notes.put(note);
  return note;
}

export const deleteNote = (id: string) => db.notes.delete(id);
export const getNote = (id: string) => db.notes.get(id);
export const allNotes = () => db.notes.toArray();

/* ---------- zoeken, filteren, sorteren (puur, ook gebruikt in tests) ---------- */

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Criteria {
  query: string;
  /** null = alle tags; NO_TAG = alleen notities zonder tag */
  tagId: string | null;
  minRating: Rating | null;
  /** yyyy-mm-dd, inclusief */
  from: string | null;
  to: string | null;
  timesOfDay: TimeOfDay[];
  bounds: Bounds | null;
}

export const NO_TAG = '__none__';

export const EMPTY_CRITERIA: Criteria = {
  query: '',
  tagId: null,
  minRating: null,
  from: null,
  to: null,
  timesOfDay: [],
  bounds: null,
};

export function filterNotes(notes: Note[], tags: Map<string, Tag>, c: Criteria): Note[] {
  const words = fold(c.query.trim()).split(/\s+/).filter(Boolean);
  return notes.filter((n) => {
    if (c.tagId === NO_TAG ? n.tagId !== null : c.tagId && n.tagId !== c.tagId) return false;
    if (c.minRating && (n.rating ?? 0) < c.minRating) return false;
    const date = n.observedAt.slice(0, 10);
    if (c.from && date < c.from) return false;
    if (c.to && date > c.to) return false;
    if (c.timesOfDay.length && !c.timesOfDay.includes(timeOfDay(wallClock(n.observedAt).hour))) return false;
    if (c.bounds) {
      const b = c.bounds;
      if (n.lat < b.south || n.lat > b.north) return false;
      const inLng = b.west <= b.east ? n.lng >= b.west && n.lng <= b.east : n.lng >= b.west || n.lng <= b.east;
      if (!inLng) return false;
    }
    if (words.length) {
      const tagName = n.tagId ? tags.get(n.tagId)?.name ?? '' : '';
      const hay = fold(`${n.title ?? ''}\n${n.textPlain}\n${tagName}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export type SortMode = 'rating' | 'date';

/** Vergelijkt het werkelijke moment (houdt rekening met de offset). */
const instant = (iso: string) => new Date(iso).getTime();

/**
 * 'rating': hoogste beoordeling eerst, bij gelijke beoordeling nieuwste eerst;
 * notities zonder beoordeling achteraan, onderling op datum. 'date': nieuwste eerst.
 */
export function sortNotes(notes: Note[], mode: SortMode = 'rating'): Note[] {
  return [...notes].sort((a, b) => {
    if (mode === 'rating') {
      const diff = (b.rating ?? 0) - (a.rating ?? 0);
      if (diff) return diff;
    }
    return instant(b.observedAt) - instant(a.observedAt);
  });
}
