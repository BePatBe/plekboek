import nl from './nl.json';
import en from './en.json';
import { createStore, useStore } from '../lib/store';
import { wallDate } from '../lib/time';

export type Lang = 'nl' | 'en';
type Dict = Record<string, string>;
const dicts: Record<Lang, Dict> = { nl, en };

export function systemLang(): Lang {
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  for (const l of langs) {
    const base = l.slice(0, 2).toLowerCase();
    if (base === 'nl' || base === 'en') return base;
  }
  return 'en';
}

export const langStore = createStore<Lang>(systemLang());

export function setLang(lang: Lang) {
  document.documentElement.lang = lang;
  langStore.set(lang);
}

export function t(key: string, params?: Record<string, string | number>): string {
  const lang = langStore.get();
  let s = dicts[lang][key] ?? dicts.nl[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/** Enkelvoud/meervoud: zoekt `key_one` of `key_other`. */
export function tn(key: string, count: number, params?: Record<string, string | number>): string {
  return t(`${key}_${count === 1 ? 'one' : 'other'}`, { count: fmtNumber(count), ...params });
}

/** Hook die het component opnieuw rendert bij een taalwissel. */
export function useLang(): Lang {
  return useStore(langStore);
}

export function locale(): string {
  return langStore.get() === 'nl' ? 'nl-NL' : 'en-GB';
}

export function fmtNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

type DateStyle = 'long' | 'medium' | 'short' | 'dayMonth' | 'time' | 'weekdayShort';

/** Formatteert de kloktijd van een `observedAt`-string in de taal van de app. */
export function fmtObserved(iso: string, style: DateStyle): string {
  const d = wallDate(iso);
  const opts: Record<DateStyle, Intl.DateTimeFormatOptions> = {
    long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
    medium: { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
    short: { day: 'numeric', month: 'short', year: 'numeric' },
    dayMonth: { day: 'numeric', month: 'short' },
    time: { hour: '2-digit', minute: '2-digit', hour12: false },
    weekdayShort: { weekday: 'short' },
  };
  return new Intl.DateTimeFormat(locale(), { ...opts[style], timeZone: 'UTC' }).format(d).replace(/\.$/, '');
}

export function fmtDistance(m: number): string {
  if (m < 1000) return `${fmtNumber(Math.round(m))} m`;
  return `${fmtNumber(m / 1000, m < 10_000 ? 1 : 0)} km`;
}

export function fmtBytes(b: number): string {
  if (b < 1024 * 1024) return `${fmtNumber(b / 1024)} kB`;
  return `${fmtNumber(b / 1024 / 1024, 1)} MB`;
}

export function weekdayName(i: number, width: 'long' | 'short' = 'long'): string {
  // 5 jan 2026 is een maandag
  return new Intl.DateTimeFormat(locale(), { weekday: width, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 5 + i)));
}

export function monthName(m: number, width: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(locale(), { month: width, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m - 1, 1)));
}
