import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';

/** Preact-variant van Dexie's useLiveQuery: rendert opnieuw zodra de gelezen tabellen wijzigen. */
export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
  }, deps);
  return value;
}
