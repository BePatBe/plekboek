import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { L, createMap, FALLBACK_VIEW, pinIcon } from './leaflet';
import type { LatLng } from '../../geo/distance';

interface Props {
  pos: LatLng | null;
  color: string;
  /** Pin slepen en op de kaart tikken verplaatst de pin. */
  editable?: boolean;
  onMove?: (pos: LatLng) => void;
  fallback?: { lat: number; lng: number; zoom: number };
  mapRef?: RefObject<L.Map | null>;
  class?: string;
  hint?: string;
}

/** Minikaart met één pin in de tagkleur (invoer- en leesscherm). */
export function PinMap({ pos, color, editable, onMove, fallback = FALLBACK_VIEW, mapRef, class: cls, hint }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    const start = pos ?? fallback;
    const m = createMap(el.current!, start, pos ? 16 : fallback.zoom, {
      dragging: true,
      scrollWheelZoom: editable ? 'center' : false,
      tapHold: false,
    });
    if (editable) {
      L.control.zoom({ position: 'bottomright' }).addTo(m);
      m.on('click', (e: L.LeafletMouseEvent) => onMoveRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    }
    map.current = m;
    if (mapRef) mapRef.current = m;
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
      if (mapRef) mapRef.current = null;
    };
  }, []);

  // Pin plaatsen, verplaatsen of verkleuren.
  useEffect(() => {
    const m = map.current!;
    if (!pos) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    const ll = L.latLng(pos.lat, pos.lng);
    if (!marker.current) {
      marker.current = L.marker(ll, { icon: pinIcon(color), draggable: editable, keyboard: false }).addTo(m);
      marker.current.on('dragend', () => {
        const p = marker.current!.getLatLng();
        onMoveRef.current?.({ lat: p.lat, lng: p.lng });
      });
      m.setView(ll, Math.max(m.getZoom(), 16));
    } else {
      marker.current.setLatLng(ll);
      if (!m.getBounds().pad(-0.15).contains(ll)) m.panTo(ll);
    }
  }, [pos?.lat, pos?.lng]);

  useEffect(() => {
    marker.current?.setIcon(pinIcon(color));
  }, [color, !!pos]);

  return (
    <div class={`pinmap ${cls ?? ''}`}>
      <div ref={el} class="map" />
      {hint && <div class="map-hint">{hint}</div>}
    </div>
  );
}
