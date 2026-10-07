import { isStandalone } from '../state';

/**
 * Anonieme gebruikstelling via GoatCounter (geen cookies, geen persoonsgegevens).
 * Er gaan alleen vaste namen mee ("geopend/app", "installatie", …) — nooit het
 * adres na de #, notitie-id's, tekst of locaties.
 */

const ENDPOINT = 'https://plekboek.goatcounter.com/count';
const SCRIPT = 'https://gc.zgo.at/count.js';

interface GoatCounter {
  count?: (v: { path: string; title?: string; event?: boolean }) => void;
}

declare global {
  interface Window {
    goatcounter?: GoatCounter;
  }
}

const queue: { path: string; event: boolean }[] = [];

function flush() {
  const count = window.goatcounter?.count;
  if (!count) return;
  while (queue.length) {
    const { path, event } = queue.shift()!;
    count({ path, title: path, event });
  }
}

function track(path: string, event = true) {
  if (import.meta.env.DEV) return;
  queue.push({ path, event });
  flush();
}

export function initAnalytics() {
  if (import.meta.env.DEV) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = SCRIPT;
  s.dataset.goatcounter = ENDPOINT;
  // Geen automatische paginaweergave: wij bepalen zelf wat er geteld wordt.
  s.dataset.goatcounterSettings = JSON.stringify({ no_onload: true });
  s.onload = flush;
  document.head.appendChild(s);

  // Eén telling per keer openen; zo zie je het verschil tussen bezoekers en gebruikers van de geïnstalleerde app.
  track(isStandalone() ? 'geopend/app' : 'geopend/browser', false);
  window.addEventListener('appinstalled', () => track('installatie'));
}
