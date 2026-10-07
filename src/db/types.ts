export type Rating = 1 | 2 | 3 | 4 | 5;

export interface Note {
  id: string;
  lat: number;
  lng: number;
  accuracy?: number;
  locationSource: 'gps' | 'map';
  observedAt: string;
  title?: string;
  text: string;
  textPlain: string;
  tagId: string | null;
  /** beoordeling van de plek */
  rating: Rating | null;
  /** beoordeling van de activiteit; ontbreekt bij oudere notities */
  activityRating?: Rating | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  language: 'nl' | 'en' | 'system';
  theme: 'light' | 'dark' | 'system';
  samePlaceRadiusM: number;
  defaultMapCenter?: { lat: number; lng: number; zoom: number };
  lastExportAt?: string;
  backupReminderDays: number;
  /** Laatste geslaagde synchronisatie met een ander toestel (telt ook als back-up). */
  lastSyncAt?: string;
  /** Filters waarmee het zoekscherm opent; het filterpaneel gaat er per sessie overheen. */
  searchDefaults?: SearchDefaults;
}

export interface SearchDefaults {
  /** leeg = alle tags; '__none__' staat voor notities zonder tag */
  tagIds: string[];
  /** yyyy-mm-dd; de periode loopt dan t/m vandaag */
  from: string | null;
  inMapArea: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'system',
  theme: 'system',
  samePlaceRadiusM: 100,
  backupReminderDays: 30,
};

export interface Deletion {
  /** id van de verwijderde notitie of tag */
  id: string;
  kind: 'note' | 'tag';
  deletedAt: string;
}

/** Vast palet voor nieuwe tags; elke kleur werkt als marker op lichte én donkere kaart. */
export const TAG_PALETTE = ['#2a7d6b', '#b8651d', '#7b4fc9', '#2266c4', '#c0392b', '#c99a06', '#4f8a2b', '#c2477e', '#5d6d7e', '#0e8fa3'];

export const UNTAGGED_COLOR = '#8a9490';
