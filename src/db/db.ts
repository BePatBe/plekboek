import Dexie, { type Table } from 'dexie';
import type { Deletion, Note, Settings, Tag } from './types';

export type SettingsRow = Settings & { key: 'settings' };

export class PlekboekDB extends Dexie {
  notes!: Table<Note, string>;
  tags!: Table<Tag, string>;
  settings!: Table<SettingsRow, string>;
  /** Verwijderde notities en tags ("tombstones"), zodat samenvoegen ze niet terugzet. */
  deletions!: Table<Deletion, string>;

  constructor(name = 'plekboek') {
    super(name);
    this.version(1).stores({
      notes: 'id, observedAt, tagId, rating, updatedAt, [lat+lng]',
      tags: 'id, &name',
      settings: 'key',
    });
    this.version(2).stores({
      deletions: 'id, kind',
    });
  }
}

export const db = new PlekboekDB();
