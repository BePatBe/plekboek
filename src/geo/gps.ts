import { createStore } from '../lib/store';

export interface Position {
  lat: number;
  lng: number;
  accuracy: number;
}

export type GpsError = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

/** Laatst bekende positie, gedeeld tussen schermen (voor "1,2 km van je af"). */
export const positionStore = createStore<Position | null>(null);

export function getPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject('unsupported' satisfies GpsError);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) };
        positionStore.set(pos);
        resolve(pos);
      },
      (e) => {
        const code: GpsError = e.code === e.PERMISSION_DENIED ? 'denied' : e.code === e.TIMEOUT ? 'timeout' : 'unavailable';
        reject(code);
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 15_000 },
    );
  });
}

/** Vraagt de positie alleen op als er al toestemming is, zodat er bij het openen geen pop-up verschijnt. */
export async function getPositionIfAllowed(): Promise<Position | null> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    if (status?.state !== 'granted') return null;
    return await getPosition();
  } catch {
    return null;
  }
}
