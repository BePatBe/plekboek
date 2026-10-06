import L from 'leaflet';

// leaflet.markercluster breidt de globale `L` uit; die moet bestaan vóór die module laadt.
(window as unknown as { L: typeof L }).L = L;

export default L;
