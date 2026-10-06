import { db } from './db';
import { TAG_PALETTE, type Tag } from './types';
import { uuid } from '../lib/uuid';
import { toLocalIso } from '../lib/time';

export const allTags = () => db.tags.orderBy('name').toArray();

export class DuplicateTagError extends Error {}

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

async function assertUniqueName(name: string, exceptId?: string) {
  const clash = (await db.tags.toArray()).find((t) => t.id !== exceptId && sameName(t.name, name));
  if (clash) throw new DuplicateTagError(name);
}

/** Eerste paletkleur die nog niet in gebruik is (anders roulerend). */
export function nextColor(existing: Tag[]): string {
  const used = new Set(existing.map((t) => t.color.toLowerCase()));
  return TAG_PALETTE.find((c) => !used.has(c)) ?? TAG_PALETTE[existing.length % TAG_PALETTE.length];
}

export async function createTag(name: string, color?: string): Promise<Tag> {
  name = name.trim();
  if (!name) throw new Error('Empty tag name');
  return db.transaction('rw', db.tags, async () => {
    await assertUniqueName(name);
    const now = toLocalIso();
    const tag: Tag = { id: uuid(), name, color: color ?? nextColor(await db.tags.toArray()), createdAt: now, updatedAt: now };
    await db.tags.add(tag);
    return tag;
  });
}

export async function updateTag(id: string, changes: { name?: string; color?: string }): Promise<void> {
  await db.transaction('rw', db.tags, async () => {
    const patch: Partial<Tag> = { updatedAt: toLocalIso() };
    if (changes.color) patch.color = changes.color;
    if (changes.name !== undefined) {
      const name = changes.name.trim();
      if (!name) throw new Error('Empty tag name');
      await assertUniqueName(name, id);
      patch.name = name;
    }
    await db.tags.update(id, patch);
  });
}

/** Verwijdert een tag; de notities krijgen geen tag (`moveTo` = null) of gaan naar een andere tag. */
export async function deleteTag(id: string, moveTo: string | null): Promise<void> {
  await db.transaction('rw', db.tags, db.notes, async () => {
    await db.notes.where('tagId').equals(id).modify({ tagId: moveTo, updatedAt: toLocalIso() });
    await db.tags.delete(id);
  });
}

export async function tagCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await db.notes.each((n) => {
    if (n.tagId) counts.set(n.tagId, (counts.get(n.tagId) ?? 0) + 1);
  });
  return counts;
}
