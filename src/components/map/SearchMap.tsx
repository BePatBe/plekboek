import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import type { Note, Tag } from '../../db/types';
import { UNTAGGED_COLOR } from '../../db/types';
import type { Bounds } from '../../db/notes';
import type { Position } from '../../geo/gps';
import type { LatLng } from '../../geo/distance';
import { L, clusterIcon, createMap, ownLocationLayer, pinIcon, type ColoredMarkerOptions } from './leaflet';

export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

interface Props {
  notes: Note[];
  tags: Map<string, Tag>;
  activeId: string | null;
  position: Position | null;
  initialView: MapView;
  /** Bij de eerste keer: zoom uit tot alle notities zichtbaar zijn. */
  fitNotes: Note[] | null;
  onMarker: (id: string) => void;
  onLongPress: (pos: LatLng) => void;
  onView: (view: MapView, bounds: Bounds) => void;
  mapRef: RefObject<L.Map | null>;
}

const toBounds = (b: L.LatLngBounds): Bounds => ({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });

/** Kaart van het zoekscherm: markers in tagkleur, clusters met kleurring, actieve marker los en groter. */
export function SearchMap({ notes, tags, activeId, position, initialView, fitNotes, onMarker, onLongPress, onView, mapRef }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const cluster = useRef<L.MarkerClusterGroup | null>(null);
  const activeLayer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const shownActive = useRef<string | null>(null);
  const own = useRef<ReturnType<typeof ownLocationLayer> | null>(null);
  const cb = useRef({ onMarker, onLongPress, onView });
  cb.current = { onMarker, onLongPress, onView };

  useEffect(() => {
    const map = createMap(el.current!, initialView, initialView.zoom);
    L.control.zoom({ position: 'topright' }).addTo(map);
    cluster.current = L.markerClusterGroup({
      iconCreateFunction: clusterIcon,
      showCoverageOnHover: false,
      maxClusterRadius: 50,
    }).addTo(map);
    activeLayer.current = L.layerGroup().addTo(map);
    own.current = ownLocationLayer();
    own.current.layer.addTo(map);
    // Lang drukken (touch) en rechtsklik (muis): nieuwe notitie op die plek.
    map.on('contextmenu', (e: L.LeafletMouseEvent) => cb.current.onLongPress({ lat: e.latlng.lat, lng: e.latlng.lng }));
    const report = () => {
      const c = map.getCenter();
      cb.current.onView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }, toBounds(map.getBounds()));
    };
    map.on('moveend', report);
    mapRef.current = map;
    report();
    return () => {
      map.remove();
      mapRef.current = null;
      markers.current.clear();
      shownActive.current = null;
    };
  }, []);

  useEffect(() => {
    if (!fitNotes?.length || !mapRef.current) return;
    const b = L.latLngBounds(fitNotes.map((n) => [n.lat, n.lng] as [number, number]));
    mapRef.current.fitBounds(b, { padding: [30, 30], maxZoom: 14 });
  }, [fitNotes]);

  // Markers opnieuw opbouwen als de resultaten of tagkleuren veranderen.
  useEffect(() => {
    const group = cluster.current!;
    group.clearLayers();
    activeLayer.current!.clearLayers();
    markers.current.clear();
    shownActive.current = null;
    const list: L.Marker[] = [];
    for (const n of notes) {
      const color = n.tagId ? tags.get(n.tagId)?.color ?? UNTAGGED_COLOR : UNTAGGED_COLOR;
      const m = L.marker([n.lat, n.lng], { icon: pinIcon(color), color, noteId: n.id, keyboard: false } as ColoredMarkerOptions);
      m.on('click', () => cb.current.onMarker(n.id));
      markers.current.set(n.id, m);
      if (n.id !== activeId) list.push(m);
    }
    group.addLayers(list);
    showActive(activeId, false);
  }, [notes, tags]);

  /** De actieve marker staat buiten het cluster, groter en bovenop. */
  function showActive(id: string | null, pan: boolean) {
    const prev = shownActive.current;
    if (prev && prev !== id) {
      const m = markers.current.get(prev);
      if (m) {
        activeLayer.current!.removeLayer(m);
        m.setIcon(pinIcon((m.options as ColoredMarkerOptions).color)).setZIndexOffset(0);
        cluster.current!.addLayer(m);
      }
    }
    shownActive.current = null;
    const m = id ? markers.current.get(id) : undefined;
    if (!m) return;
    if (prev !== id) {
      cluster.current!.removeLayer(m);
      m.setIcon(pinIcon((m.options as ColoredMarkerOptions).color, true)).setZIndexOffset(1000);
      activeLayer.current!.addLayer(m);
    }
    shownActive.current = id;
    const map = mapRef.current!;
    if (pan && !map.getBounds().pad(-0.1).contains(m.getLatLng())) map.panTo(m.getLatLng());
  }

  useEffect(() => showActive(activeId, true), [activeId]);

  useEffect(() => own.current?.set(position), [position]);

  return <div ref={el} class="map" />;
}
