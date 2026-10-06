import Dexie, { type Table } from 'dexie';
import type { Note, Settings, Tag } from './types';

export type SettingsRow = Settings & { key: 'settings' };

export class PlekboekDB extends Dexie {
  notes!: Table<Note, string>;
  tags!: Table<Tag, string>;
  settings!: Table<SettingsRow, string>;

  constructor(name = 'plekboek') {
    super(name);
    this.version(1).stores({
      notes: 'id, observedAt, tagId, rating, updatedAt, [lat+lng]',
      tags: 'id, &name',
      settings: 'key',
    });
  }
}

export const db = new PlekboekDB();
