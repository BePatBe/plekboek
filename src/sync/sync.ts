import { buildBackup } from '../backup/export';
import { applyImport, parseBackup, type ImportSummary, type ParseError } from '../backup/import';
import type { BackupFile } from '../backup/schema';

/** Een opslagplek in de cloud met één sync-bestand. `version` verandert bij elke schrijfactie. */
export interface Remote {
  read(): Promise<{ text: string; version: string } | null>;
  /** Huidige versie zonder te downloaden; null als het bestand (nog) niet bestaat. */
  version(): Promise<string | null>;
  write(text: string): Promise<void>;
}

export class SyncFileError extends Error {
  constructor(public reason: ParseError) {
    super(reason);
  }
}

export interface SyncResult {
  /** wat er van de cloud is binnengekomen (null bij een lege cloud) */
  pulled: ImportSummary | null;
  uploaded: boolean;
}

/** Inhoud die ertoe doet (zonder exportdatum en instellingen), voor de vergelijking "is er iets veranderd?". */
function content(b: Pick<BackupFile, 'tags' | 'notes' | 'deletions'>): string {
  const byId = <T extends { id: string }>(xs: T[] = []) => [...xs].sort((a, c) => (a.id < c.id ? -1 : a.id > c.id ? 1 : 0));
  // Sleutels gesorteerd, zodat de volgorde van velden niet uitmaakt.
  const sortKeys = (_: string, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1))) : v;
  return JSON.stringify([byId(b.tags), byId(b.notes), byId(b.deletions)], sortKeys);
}

/**
 * Eén synchronisatieronde: cloud ophalen → samenvoegen in de lokale database → resultaat terugschrijven.
 * Heeft een ander toestel intussen geschreven, dan begint de ronde opnieuw (max. 3 keer).
 * Instellingen worden niet gesynchroniseerd; die horen bij het toestel.
 */
export async function syncWith(remote: Remote): Promise<SyncResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const file = await remote.read();
    let pulled: ImportSummary | null = null;
    if (file) {
      const parsed = parseBackup(file.text);
      if (!parsed.ok) throw new SyncFileError(parsed.error);
      pulled = await applyImport(parsed.data, 'merge');
    }
    const local = await buildBackup();
    if (file && content(JSON.parse(file.text)) === content(local)) return { pulled, uploaded: false };
    if ((await remote.version()) !== (file?.version ?? null)) continue; // iemand was ons voor
    await remote.write(JSON.stringify(local));
    return { pulled, uploaded: true };
  }
  throw new Error('sync-conflict');
}
