/**
 * Nominatim (OpenStreetMap). Gebruiksbeleid: max. 1 request per seconde, geen bulk.
 * Alle aanroepen gaan daarom door één wachtrij met minimaal 1,1 s tussenruimte.
 */
const BASE = 'https://nominatim.openstreetmap.org';
const MIN_GAP_MS = 1100;

let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${BASE}${path}?${new URLSearchParams({ format: 'jsonv2', ...params })}`;
  const res = await throttled(() => fetch(url, { headers: { Accept: 'application/json' } }));
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json() as Promise<T>;
}

export interface PlaceResult {
  label: string;
  lat: number;
  lng: number;
  /** [south, north, west, east] */
  bbox?: [number, number, number, number];
}

interface SearchRow {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
}

export async function searchPlace(query: string, lang: string): Promise<PlaceResult[]> {
  const rows = await getJson<SearchRow[]>('/search', { q: query, limit: '5', 'accept-language': lang });
  return rows.map((r) => ({
    label: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
    bbox: r.boundingbox?.map(Number) as PlaceResult['bbox'],
  }));
}

interface ReverseRow {
  name?: string;
  address?: Record<string, string>;
  error?: string;
}

const LOCALITY = ['neighbourhood', 'suburb', 'quarter', 'hamlet', 'village', 'town', 'city_district'];
const PLACE = ['village', 'town', 'city', 'municipality', 'county'];

/**
 * Meest specifieke naam: plek/POI, dan straat (+ plaats), dan wijk/dorp, dan plaats.
 * Bijv. "Vogelhut De Kiekendief" of "Dorpsstraat, Ootmarsum".
 */
export function pickName(row: ReverseRow): string | null {
  if (row.error) return null;
  const a = row.address ?? {};
  if (row.name?.trim()) return row.name.trim();
  const place = PLACE.map((k) => a[k]).find(Boolean);
  const street = a.road ?? a.pedestrian ?? a.footway ?? a.path ?? a.cycleway;
  if (street) return place && place !== street ? `${street}, ${place}` : street;
  const locality = LOCALITY.map((k) => a[k]).find(Boolean);
  if (locality) return place && place !== locality ? `${locality}, ${place}` : locality;
  return place ?? null;
}

export async function reverseName(lat: number, lng: number, lang: string): Promise<string | null> {
  const row = await getJson<ReverseRow>('/reverse', {
    lat: lat.toFixed(6),
    lon: lng.toFixed(6),
    zoom: '18',
    addressdetails: '1',
    'accept-language': lang,
  });
  return pickName(row);
}
