import type { Deletion, Note, Rating, Settings, Tag } from '../db/types';
import { cleanNote } from '../db/notes';
import { cleanTemplate } from '../db/tags';

export const APP_ID = 'plekboek';
/** `deletions` is een optionele toevoeging aan versie 1: oudere bestanden zonder dat veld blijven geldig. */
export const SCHEMA_VERSION = 1;

export type BackupSettings = Pick<Settings, 'language' | 'theme' | 'samePlaceRadiusM' | 'backupReminderDays' | 'defaultMapCenter' | 'searchDefaults'>;

export interface BackupFile {
  app: typeof APP_ID;
  schemaVersion: number;
  exportedAt: string;
  tags: Tag[];
  notes: Note[];
  deletions: Deletion[];
  settings: BackupSettings;
}

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isIso = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));
const optStr = (v: unknown) => v === undefined || v === null || isStr(v);
const optRating = (v: unknown) => v === undefined || v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5);

export function validateTag(raw: unknown): Tag | null {
  if (!isObj(raw)) return null;
  const { id, name, color, template, createdAt, updatedAt } = raw;
  if (!isStr(id) || !id || !isStr(name) || !name.trim() || !optStr(template)) return null;
  if (!isStr(color) || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  if (!isIso(createdAt) || !isIso(updatedAt)) return null;
  const tpl = cleanTemplate(template as string | undefined);
  return { id, name: name.trim(), color, ...(tpl && { template: tpl }), createdAt, updatedAt };
}

/** Valideert en schoont een notitie op; `text` gaat door DOMPurify en `textPlain` wordt opnieuw berekend. */
export function validateNote(raw: unknown): Note | null {
  if (!isObj(raw)) return null;
  const { id, lat, lng, accuracy, locationSource, observedAt, title, text, tagId, rating, activityRating, createdAt, updatedAt } = raw;
  if (!isStr(id) || !id) return null;
  if (!isNum(lat) || lat < -90 || lat > 90 || !isNum(lng) || lng < -180 || lng > 180) return null;
  if (accuracy !== undefined && accuracy !== null && (!isNum(accuracy) || accuracy < 0)) return null;
  if (locationSource !== 'gps' && locationSource !== 'map') return null;
  if (!isIso(observedAt) || !isIso(createdAt) || !isIso(updatedAt)) return null;
  if (!optStr(title) || !isStr(text ?? '') || !optStr(tagId)) return null;
  if (!optRating(rating) || !optRating(activityRating)) return null;
  return cleanNote({
    id,
    lat,
    lng,
    ...(isNum(accuracy) && { accuracy }),
    locationSource,
    observedAt,
    ...(isStr(title) && { title }),
    text: (text as string | undefined) ?? '',
    tagId: (tagId as string | null | undefined) || null,
    rating: (rating as Rating | null | undefined) ?? null,
    ...(activityRating != null && { activityRating: activityRating as Rating }),
    createdAt,
    updatedAt,
  });
}

export function validateDeletion(raw: unknown): Deletion | null {
  if (!isObj(raw)) return null;
  const { id, kind, deletedAt } = raw;
  if (!isStr(id) || !id || (kind !== 'note' && kind !== 'tag') || !isIso(deletedAt)) return null;
  return { id, kind, deletedAt };
}

export function validateSettings(raw: unknown): Partial<BackupSettings> {
  if (!isObj(raw)) return {};
  const out: Partial<BackupSettings> = {};
  if (raw.language === 'nl' || raw.language === 'en' || raw.language === 'system') out.language = raw.language;
  if (raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system') out.theme = raw.theme;
  if (isNum(raw.samePlaceRadiusM)) out.samePlaceRadiusM = Math.min(500, Math.max(25, Math.round(raw.samePlaceRadiusM / 25) * 25));
  if (isNum(raw.backupReminderDays) && raw.backupReminderDays >= 0) out.backupReminderDays = Math.round(raw.backupReminderDays);
  const c = raw.defaultMapCenter;
  if (isObj(c) && isNum(c.lat) && isNum(c.lng) && isNum(c.zoom)) out.defaultMapCenter = { lat: c.lat, lng: c.lng, zoom: c.zoom };
  const f = raw.searchDefaults;
  if (isObj(f) && Array.isArray(f.tagIds) && f.tagIds.every(isStr) && optStr(f.from) && (!f.from || /^\d{4}-\d{2}-\d{2}$/.test(f.from as string)))
    out.searchDefaults = { tagIds: f.tagIds.filter(Boolean), from: (f.from as string) || null, inMapArea: f.inMapArea === true };
  return out;
}

/** Migraties van oudere schemaversies naar de huidige; sleutel = versie waar vandaan. */
export const MIGRATIONS: Record<number, (data: Raw) => Raw> = {};
