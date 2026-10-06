import L from './leafletGlobal';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import type { LatLng } from '../../geo/distance';

export { L };

export const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

/** Middelpunt van Nederland als niets beters bekend is. */
export const FALLBACK_VIEW = { lat: 52.2, lng: 5.4, zoom: 7 };

export function createMap(el: HTMLElement, center: LatLng, zoom: number, options: L.MapOptions = {}): L.Map {
  const map = L.map(el, { zoomControl: false, attributionControl: true, ...options }).setView([center.lat, center.lng], zoom);
  map.attributionControl.setPrefix(false);
  L.tileLayer(OSM_URL, {
    maxZoom: 19,
    attribution: ATTRIBUTION,
    // CORS-tegels: de service worker kan ze dan als gewone 200-respons cachen.
    crossOrigin: 'anonymous',
  }).addTo(map);
  // Leaflet moet opnieuw meten als de container van grootte verandert (bijv. layoutwissel op de laptop).
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(el);
  map.on('unload', () => ro.disconnect());
  return map;
}

export function pinIcon(color: string, active = false): L.DivIcon {
  const w = active ? 40 : 30;
  const h = active ? 53 : 40;
  return L.divIcon({
    className: `pin${active ? ' pin-active' : ''}`,
    html:
      `<svg viewBox="0 0 30 40" width="${w}" height="${h}" aria-hidden="true">` +
      `<path d="M15 1.2C7.3 1.2 1.2 7.3 1.2 15c0 10.2 13.8 23.6 13.8 23.6S28.8 25.2 28.8 15C28.8 7.3 22.7 1.2 15 1.2z" fill="${color}" stroke="#fff" stroke-width="2.2"/>` +
      `<circle cx="15" cy="15" r="5.2" fill="#fff"/></svg>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h - 1],
  });
}

export interface ColoredMarkerOptions extends L.MarkerOptions {
  color: string;
  noteId?: string;
}

/** Cluster: ring met de verhouding van de tagkleuren en het aantal in het midden. */
export function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const markers = cluster.getAllChildMarkers();
  const counts = new Map<string, number>();
  for (const m of markers) {
    const c = (m.options as ColoredMarkerOptions).color;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let acc = 0;
  const stops = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => {
      const from = (acc / markers.length) * 360;
      acc += n;
      return `${c} ${from}deg ${(acc / markers.length) * 360}deg`;
    });
  const size = markers.length < 10 ? 40 : markers.length < 100 ? 46 : 52;
  return L.divIcon({
    className: 'cluster-icon',
    html: `<div class="cluster" style="width:${size}px;height:${size}px;background:conic-gradient(${stops.join(',')})"><span>${markers.length}</span></div>`,
    iconSize: [size, size],
  });
}

export function ownLocationLayer(): { layer: L.LayerGroup; set: (p: { lat: number; lng: number; accuracy: number } | null) => void } {
  const layer = L.layerGroup();
  const circle = L.circle([0, 0], { radius: 1, className: 'own-accuracy', interactive: false, pane: 'markerPane' });
  const dot = L.circleMarker([0, 0], { radius: 7, className: 'own-dot', interactive: false, pane: 'markerPane' });
  return {
    layer,
    set(p) {
      if (!p) {
        layer.clearLayers();
        return;
      }
      circle.setLatLng([p.lat, p.lng]).setRadius(p.accuracy);
      dot.setLatLng([p.lat, p.lng]);
      if (!layer.hasLayer(dot)) layer.addLayer(circle).addLayer(dot);
    },
  };
}
