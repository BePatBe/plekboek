import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLiveQuery } from '../db/live';
import { allNotes, EMPTY_CRITERIA, filterNotes, NO_TAG, sortNotes, type Bounds, type Criteria, type SortMode } from '../db/notes';
import { allTags } from '../db/tags';
import type { Note, Rating, Settings, Tag } from '../db/types';
import { getPosition, getPositionIfAllowed, positionStore } from '../geo/gps';
import { searchPlace, type PlaceResult } from '../geo/geocode';
import { fmtNumber, fmtObserved, langStore, t, useLang } from '../i18n';
import { createStore, useStore } from '../lib/store';
import { TIMES_OF_DAY, daysSince, toLocalIso, type TimeOfDay } from '../lib/time';
import { navigate } from '../router';
import { installedStore, installPromptStore, isIOS, lastBackupAt, local, onlineStore, promptInstall, settingsStore, updateSettings } from '../state';
import { CardWheel } from '../components/CardWheel';
import { TagFilter } from '../components/TagFilter';
import { Header, StarInput, Toast } from '../components/common';
import { Icon } from '../components/Icon';
import { IosInstallSteps } from '../components/InstallHelp';
import { SearchMap, type MapView } from '../components/map/SearchMap';
import { FALLBACK_VIEW, type L } from '../components/map/leaflet';

/** Blijft bewaard als je naar een notitie gaat en terugkomt. */
interface SearchState {
  criteria: Criteria;
  inMapArea: boolean;
  sort: SortMode;
  activeId: string | null;
  view: MapView | null;
}

const searchState = createStore<SearchState>({ criteria: EMPTY_CRITERIA, inMapArea: false, sort: 'rating', activeId: null, view: null });
const patch = (p: Partial<SearchState>) => searchState.set({ ...searchState.get(), ...p });

/* Standaardfilters uit de instellingen: bij het opstarten en zodra ze daar veranderen.
   Wat je daarna in het filterpaneel kiest, gaat er voor deze sessie overheen. */
let appliedDefaults = '';
function applySearchDefaults(s: Settings) {
  const d = s.searchDefaults;
  const key = JSON.stringify(d ?? null);
  if (key === appliedDefaults) return;
  appliedDefaults = key;
  if (!d) return;
  // De periode loopt t/m vandaag: alleen een begindatum, geen einddatum.
  patch({ criteria: { ...searchState.get().criteria, tagIds: d.tagIds, from: d.from, to: null }, inMapArea: d.inMapArea });
}
applySearchDefaults(settingsStore.get());
settingsStore.subscribe(applySearchDefaults);

export function SearchScreen() {
  useLang();
  const state = useStore(searchState);
  const settings = useStore(settingsStore);
  const position = useStore(positionStore);
  const notes = useLiveQuery(allNotes, []);
  const tagList = useLiveQuery(allTags, []);
  const tags = useMemo(() => new Map((tagList ?? []).map((x) => [x.id, x])), [tagList]);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [request, setRequest] = useState<{ id: string; seq: number } | null>(null);
  const [toast, setToast] = useState('');
  const mapRef = useRef<L.Map | null>(null);

  const { criteria, inMapArea, sort } = state;
  const setCriteria = (c: Partial<Criteria>) => patch({ criteria: { ...criteria, ...c } });

  // Tags die intussen zijn verwijderd, vallen uit het (standaard)filter.
  useEffect(() => {
    if (!tagList) return;
    const kept = criteria.tagIds.filter((id) => id === NO_TAG || tags.has(id));
    if (kept.length !== criteria.tagIds.length) setCriteria({ tagIds: kept });
  }, [tagList, criteria.tagIds]);

  const results = useMemo(() => {
    if (!notes) return null;
    return sortNotes(filterNotes(notes, tags, { ...criteria, bounds: inMapArea ? bounds : null }), sort);
  }, [notes, tags, criteria, inMapArea, inMapArea && bounds, sort]);

  // Eerste kaartbeeld: laatst bekeken gebied, anders alle notities, anders de standaard.
  const [initialView] = useState<MapView>(() => state.view ?? settings.defaultMapCenter ?? FALLBACK_VIEW);
  const [fitNotes, setFitNotes] = useState<Note[] | null>(null);
  const fitted = useRef(!!(state.view ?? settings.defaultMapCenter));
  useEffect(() => {
    if (fitted.current || !notes) return;
    fitted.current = true;
    if (notes.length) setFitNotes(notes);
    else getPositionIfAllowed().then((p) => p && mapRef.current?.setView([p.lat, p.lng], 14));
  }, [notes]);

  useEffect(() => {
    if (!positionStore.get()) getPositionIfAllowed();
    // Bewaar het kaartbeeld als standaard wanneer de app naar de achtergrond gaat.
    const save = () => {
      const v = searchState.get().view;
      if (document.visibilityState === 'hidden' && v) updateSettings({ defaultMapCenter: v });
    };
    document.addEventListener('visibilitychange', save);
    return () => {
      document.removeEventListener('visibilitychange', save);
      const v = searchState.get().view;
      if (v) updateSettings({ defaultMapCenter: v });
    };
  }, []);

  const locate = async () => {
    try {
      const p = await getPosition();
      mapRef.current?.flyTo([p.lat, p.lng], Math.max(mapRef.current.getZoom(), 15));
    } catch (e) {
      setToast(t(`gps.error.${e}`));
    }
  };

  const activeIndex = results ? results.findIndex((n) => n.id === state.activeId) : -1;
  const filterCount =
    (criteria.tagIds.length ? 1 : 0) + (criteria.minRating ? 1 : 0) + (criteria.from || criteria.to ? 1 : 0) + (criteria.timesOfDay.length ? 1 : 0) + (inMapArea ? 1 : 0);

  return (
    <div class="screen search-screen">
      <Header title={t('app.name')} />
      <Banners notes={notes} />
      <div class="search-layout">
        <div class="search-controls">
          <label class="searchbox">
            <Icon name="search" />
            <input
              type="search"
              value={criteria.query}
              placeholder={t('search.placeholder')}
              aria-label={t('search.placeholder')}
              onInput={(e) => setCriteria({ query: e.currentTarget.value })}
            />
            {criteria.query && (
              <button type="button" class="icon-btn" aria-label={t('common.clear')} onClick={() => setCriteria({ query: '' })}>
                <Icon name="close" />
              </button>
            )}
          </label>
          <FilterChips
            criteria={criteria}
            inMapArea={inMapArea}
            count={filterCount}
            tagNames={criteria.tagIds.map((id) => (id === NO_TAG ? t('tag.none') : tags.get(id)?.name)).filter((x): x is string => !!x)}
            open={filtersOpen}
            onToggle={() => setFiltersOpen(!filtersOpen)}
            onClear={(c, area) => (setCriteria(c), area !== undefined && patch({ inMapArea: area }))}
          />
          {filtersOpen && (
            <FilterPanel
              criteria={criteria}
              inMapArea={inMapArea}
              tags={tagList ?? []}
              onChange={setCriteria}
              onMapArea={(v) => patch({ inMapArea: v })}
              onClose={() => setFiltersOpen(false)}
            />
          )}
        </div>
        <div class="search-map">
          <SearchMap
            notes={results ?? []}
            tags={tags}
            activeId={state.activeId}
            position={position}
            initialView={initialView}
            fitNotes={fitNotes}
            mapRef={mapRef}
            onMarker={(id) => setRequest({ id, seq: (request?.seq ?? 0) + 1 })}
            onLongPress={(p) => navigate(`#/note/new?lat=${p.lat.toFixed(6)}&lng=${p.lng.toFixed(6)}`)}
            onView={(view, b) => {
              patch({ view });
              setBounds(b);
            }}
          />
          <PlaceSearch mapRef={mapRef} />
          <button type="button" class="map-btn locate-btn" aria-label={t('search.myLocation')} title={t('search.myLocation')} onClick={locate}>
            <Icon name="locate" size={22} />
          </button>
        </div>
        <div class="results-bar">
          <span>
            {results && results.length > 0 ? (
              <>
                <strong>
                  {fmtNumber(activeIndex + 1)} / {fmtNumber(results.length)}
                </strong>{' '}
                {t(results.length === 1 ? 'search.result' : 'search.results')}
              </>
            ) : (
              <strong>{results ? t('search.zeroResults') : ''}</strong>
            )}
          </span>
          <button type="button" class="link sort-btn" onClick={() => patch({ sort: sort === 'rating' ? 'date' : 'rating' })}>
            ↓ {t(sort === 'rating' ? 'search.sortRating' : 'search.sortDate')}
          </button>
        </div>
        <div class="search-results">
          {results && (
            <CardWheel
              notes={results}
              tags={tags}
              activeId={state.activeId}
              position={position}
              request={request}
              onActive={(id) => patch({ activeId: id })}
              onOpen={(id) => navigate(`#/note/${id}`)}
            />
          )}
        </div>
      </div>
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
    </div>
  );
}

/* ---------- filters ---------- */

function FilterChips(props: {
  criteria: Criteria;
  inMapArea: boolean;
  count: number;
  tagNames: string[];
  open: boolean;
  onToggle: () => void;
  onClear: (c: Partial<Criteria>, inMapArea?: boolean) => void;
}) {
  const { criteria: c, inMapArea, count, tagNames, open, onToggle, onClear } = props;
  const chip = (label: string, clear: () => void) => (
    <button type="button" class="chip chip-active" onClick={clear} aria-label={`${label} — ${t('common.remove')}`}>
      {label} <Icon name="close" size={16} />
    </button>
  );
  const period = c.from || c.to ? `${c.from ? fmtObserved(c.from, 'dayMonth') : '…'} – ${c.to ? fmtObserved(c.to, 'dayMonth') : c.from ? t('filter.today') : '…'}` : null;
  return (
    <div class="chips" role="group" aria-label={t('filter.title')}>
      <button type="button" class={`chip ${count ? 'chip-active' : ''}`} aria-expanded={open} onClick={onToggle}>
        <Icon name="filter" size={16} /> {t('filter.title')}
        {count ? ` (${count})` : ''}
      </button>
      {c.minRating ? chip(`★ ${c.minRating}+`, () => onClear({ minRating: null })) : null}
      {tagNames.length ? chip(tagNames.join(', '), () => onClear({ tagIds: [] })) : (
        <button type="button" class="chip" onClick={onToggle}>{t('filter.tag')}</button>
      )}
      {period ? chip(period, () => onClear({ from: null, to: null })) : (
        <button type="button" class="chip" onClick={onToggle}>{t('filter.period')}</button>
      )}
      {c.timesOfDay.length ? (
        chip(c.timesOfDay.map((x) => t(`tod.${x}`)).join(', '), () => onClear({ timesOfDay: [] }))
      ) : (
        <button type="button" class="chip" onClick={onToggle}>{t('filter.timeOfDay')}</button>
      )}
      {inMapArea && chip(t('filter.mapAreaShort'), () => onClear({}, false))}
    </div>
  );
}

function FilterPanel(props: {
  criteria: Criteria;
  inMapArea: boolean;
  tags: Tag[];
  onChange: (c: Partial<Criteria>) => void;
  onMapArea: (v: boolean) => void;
  onClose: () => void;
}) {
  const { criteria: c, inMapArea, tags, onChange, onMapArea, onClose } = props;
  const today = toLocalIso().slice(0, 10);
  const toggleTod = (x: TimeOfDay) =>
    onChange({ timesOfDay: c.timesOfDay.includes(x) ? c.timesOfDay.filter((y) => y !== x) : [...c.timesOfDay, x] });
  return (
    <div class="filter-panel card" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div class="field">
        <span class="label">{t('filter.tags')}</span>
        <TagFilter tags={tags} value={c.tagIds} onChange={(tagIds) => onChange({ tagIds })} />
      </div>
      <div class="field">
        <span class="label">{t('filter.minRating')}</span>
        <StarInput value={c.minRating} onChange={(r: Rating | null) => onChange({ minRating: r })} />
      </div>
      <div class="field">
        <span class="label">{t('filter.period')}</span>
        <div class="row gap">
          <input type="date" class="input" aria-label={t('filter.from')} value={c.from ?? ''} onInput={(e) => onChange({ from: e.currentTarget.value || null })} />
          <span>–</span>
          {/* Leeg = t/m vandaag; daarom staat vandaag erin, en telt die niet als extra filter. */}
          <input type="date" class="input" aria-label={t('filter.to')} value={c.to ?? today} onInput={(e) => onChange({ to: e.currentTarget.value && e.currentTarget.value !== today ? e.currentTarget.value : null })} />
        </div>
      </div>
      <div class="field">
        <span class="label">{t('filter.timeOfDay')}</span>
        <div class="chips wrap">
          {TIMES_OF_DAY.map((x) => (
            <button type="button" key={x} class={`chip ${c.timesOfDay.includes(x) ? 'chip-active' : ''}`} aria-pressed={c.timesOfDay.includes(x)} onClick={() => toggleTod(x)}>
              {t(`tod.${x}`)}
            </button>
          ))}
        </div>
      </div>
      <label class="check">
        <input type="checkbox" checked={inMapArea} onChange={(e) => onMapArea(e.currentTarget.checked)} />
        {t('filter.mapArea')}
      </label>
      <div class="row between">
        <button
          type="button"
          class="btn"
          onClick={() => {
            onChange({ ...EMPTY_CRITERIA, query: c.query });
            onMapArea(false);
          }}
        >
          {t('filter.clear')}
        </button>
        <button type="button" class="btn btn-primary" onClick={onClose}>
          {t('common.done')}
        </button>
      </div>
    </div>
  );
}

/* ---------- adres/plaats zoeken (Nominatim, alleen online, alleen op Enter) ---------- */

function PlaceSearch({ mapRef }: { mapRef: { current: L.Map | null } }) {
  const online = useStore(onlineStore);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [error, setError] = useState('');

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await searchPlace(q.trim(), langStore.get());
      setResults(r);
      if (r.length === 1) go(r[0]);
      if (!r.length) setError(t('place.none'));
    } catch {
      setError(t('place.error'));
    } finally {
      setBusy(false);
    }
  };

  const go = (r: PlaceResult) => {
    const map = mapRef.current;
    if (!map) return;
    if (r.bbox) map.fitBounds([[r.bbox[0], r.bbox[2]], [r.bbox[1], r.bbox[3]]], { maxZoom: 16 });
    else map.setView([r.lat, r.lng], 15);
    setResults(null);
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" class="map-btn place-btn" onClick={() => setOpen(true)} aria-label={t('place.search')} title={t('place.search')}>
        <Icon name="map" size={20} />
      </button>
    );
  }
  return (
    <div class="place-search card">
      {online ? (
        <form class="row gap" onSubmit={submit}>
          <input
            class="input"
            type="search"
            enterKeyHint="search"
            value={q}
            autoFocus
            placeholder={t('place.placeholder')}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          />
          <button class="btn btn-primary" type="submit" disabled={busy}>
            {busy ? '…' : t('place.go')}
          </button>
          <button type="button" class="icon-btn" aria-label={t('common.close')} onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </form>
      ) : (
        <div class="row between">
          <span class="muted">{t('place.offline')}</span>
          <button type="button" class="icon-btn" aria-label={t('common.close')} onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </div>
      )}
      {error && <p class="muted small">{error}</p>}
      {results && results.length > 1 && (
        <ul class="place-results">
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => go(r)}>
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- banners: installeren en back-upherinnering ---------- */

function Banners({ notes }: { notes: Note[] | undefined }) {
  const installed = useStore(installedStore);
  const prompt = useStore(installPromptStore);
  const settings = useStore(settingsStore);
  const [dismissed, setDismissed] = useState(() => local.get('install-banner-dismissed') === '1');
  const [backupDismissed, setBackupDismissed] = useState(false);
  const [iosOpen, setIosOpen] = useState(false);

  const showInstall = !installed && !dismissed && (prompt || isIOS());
  const dismiss = () => {
    local.set('install-banner-dismissed', '1');
    setDismissed(true);
  };

  const lastBackup = lastBackupAt(settings);
  let backupDays: number | null = null;
  if (settings.backupReminderDays > 0 && notes?.length && !backupDismissed) {
    const since = lastBackup ?? notes.reduce((min, n) => (n.createdAt < min ? n.createdAt : min), notes[0].createdAt);
    const days = daysSince(since);
    if (days >= settings.backupReminderDays) backupDays = days;
  }

  return (
    <>
      {showInstall && (
        <div class="banner">
          {prompt ? (
            <div class="row between gap">
              <span>{t('install.banner')}</span>
              <button type="button" class="btn btn-primary" onClick={promptInstall}>
                {t('install.button')}
              </button>
            </div>
          ) : iosOpen ? (
            <IosInstallSteps />
          ) : (
            <div class="row between gap">
              <span>{t('install.banner')}</span>
              <button type="button" class="btn" aria-expanded={false} onClick={() => setIosOpen(true)}>
                {t('install.how')}
              </button>
            </div>
          )}
          <button type="button" class="icon-btn banner-close" aria-label={t('common.close')} onClick={dismiss}>
            <Icon name="close" />
          </button>
        </div>
      )}
      {backupDays !== null && (
        <div class="banner banner-warn">
          <div class="row between gap">
            <span>{lastBackup ? t('backup.reminder', { days: backupDays }) : t('backup.reminderNever')}</span>
            <a class="btn" href="#/settings" onClick={(e) => (e.preventDefault(), navigate('#/settings'))}>
              {t('backup.export')}
            </a>
          </div>
          <button type="button" class="icon-btn banner-close" aria-label={t('common.close')} onClick={() => setBackupDismissed(true)}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </>
  );
}
