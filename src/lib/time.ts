/**
 * Tijdhulpjes. `observedAt` is ISO 8601 met de offset van het moment van waarnemen,
 * bijv. "2026-09-30T07:15:00+02:00". Analyse en weergave gebruiken de kloktijd zoals
 * die in de string staat (de lokale tijd ter plekke), los van de tijdzone van het toestel.
 */

export interface WallClock {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  /** 0 = maandag … 6 = zondag */
  weekday: number;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

export function wallClock(iso: string): WallClock {
  const m = ISO_RE.exec(iso);
  if (!m) {
    const d = new Date(iso);
    return fromDate(d);
  }
  const [year, month, day, hour, minute] = m.slice(1).map((x) => Number(x ?? 0));
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute, weekday: (jsDay + 6) % 7 };
}

function fromDate(d: Date): WallClock {
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    weekday: (d.getDay() + 6) % 7,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Lokale tijd van het toestel als ISO met offset, bijv. 2026-10-06T14:03:00+02:00 */
export function toLocalIso(d: Date = new Date()): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Waarden voor <input type="date"> en <input type="time"> */
export function toInputs(iso: string): { date: string; time: string } {
  const w = wallClock(iso);
  return { date: `${w.year}-${pad(w.month)}-${pad(w.day)}`, time: `${pad(w.hour)}:${pad(w.minute)}` };
}

export function fromInputs(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  return toLocalIso(new Date(y, mo - 1, d, h, mi, 0));
}

export type TimeOfDay = 'night' | 'morning' | 'afternoon' | 'evening';
export const TIMES_OF_DAY: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];

export function timeOfDay(hour: number): TimeOfDay {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/** Een Date in UTC die de kloktijd bevat; formatteer met timeZone 'UTC'. */
export function wallDate(iso: string): Date {
  const w = wallClock(iso);
  return new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute));
}

export function daysSince(iso: string, now = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

/** Maakt tekst vergelijkbaar: kleine letters, zonder accenten. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
