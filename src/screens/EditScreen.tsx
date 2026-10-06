import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLiveQuery } from '../db/live';
import { allNotes, createNote, deleteNote, getNote, updateNote, type NoteInput } from '../db/notes';
import { allTags } from '../db/tags';
import type { Note, Rating } from '../db/types';
import { getPosition, type GpsError } from '../geo/gps';
import type { LatLng } from '../geo/distance';
import { suggestTitle, type TitleSuggestion } from '../geo/suggestTitle';
import { fmtDistance, fmtNumber, fmtObserved, langStore, t, useLang } from '../i18n';
import { useStore } from '../lib/store';
import { fromInputs, toInputs, toLocalIso } from '../lib/time';
import { goBack, navigate } from '../router';
import { local, onlineStore, settingsStore } from '../state';
import { Header, NotFound, Section, StarInput, tagColor } from '../components/common';
import { Icon } from '../components/Icon';
import { RichEditor } from '../components/RichEditor';
import { TagPicker } from '../components/TagPicker';
import { PinMap } from '../components/map/PinMap';
import type { L } from '../components/map/leaflet';

interface Form {
  lat: number | null;
  lng: number | null;
  accuracy?: number;
  locationSource: 'gps' | 'map';
  date: string;
  time: string;
  /** observedAt van de bestaande notitie; blijft ongewijzigd (incl. offset) als datum/tijd niet zijn aangepast */
  originalObservedAt?: string;
  title: string;
  /** de gebruiker heeft de titel zelf aangepast: niet meer automatisch overschrijven */
  titleManual: boolean;
  text: string;
  tagId: string | null;
  rating: Rating | null;
}

type GpsState = 'idle' | 'locating' | 'ok' | GpsError;

const draftKey = (id: string | null) => `plekboek-draft:${id ?? 'new'}`;

function freshForm(): Form {
  const { date, time } = toInputs(toLocalIso());
  return { lat: null, lng: null, locationSource: 'gps', date, time, title: '', titleManual: false, text: '', tagId: null, rating: null };
}

function fromNote(n: Note): Form {
  const { date, time } = toInputs(n.observedAt);
  return {
    lat: n.lat,
    lng: n.lng,
    accuracy: n.accuracy,
    locationSource: n.locationSource,
    date,
    time,
    originalObservedAt: n.observedAt,
    title: n.title ?? '',
    titleManual: !!n.title,
    text: n.text,
    tagId: n.tagId,
    rating: n.rating,
  };
}

/** Bepaalt de begintoestand: concept, bestaande notitie, of nieuw (eventueel op een gegeven plek). */
async function initialForm(id: string | null, params: URLSearchParams | null): Promise<{ form: Form; base: Form; restored: boolean; needGps: boolean }> {
  let base: Form;
  let needGps = false;
  if (id) {
    const note = await getNote(id);
    if (!note) throw new Error('not-found');
    base = fromNote(note);
  } else {
    base = freshForm();
    const from = params?.get('from');
    const src = from ? await getNote(from) : null;
    const lat = Number(params?.get('lat'));
    const lng = Number(params?.get('lng'));
    if (src) Object.assign(base, { lat: src.lat, lng: src.lng, accuracy: src.accuracy, locationSource: src.locationSource });
    else if (params?.has('lat') && Number.isFinite(lat) && Number.isFinite(lng)) Object.assign(base, { lat, lng, locationSource: 'map' });
    else needGps = true;
  }
  const hasParams = !!params && [...params.keys()].length > 0;
  const raw = hasParams ? null : local.get(draftKey(id));
  if (raw) {
    try {
      return { form: { ...base, ...JSON.parse(raw) }, base, restored: true, needGps: false };
    } catch {
      /* kapot concept: negeren */
    }
  }
  return { form: base, base, restored: false, needGps };
}

export function EditScreen({ id, params }: { id: string | null; params: URLSearchParams | null }) {
  useLang();
  const [state, setState] = useState<{ form: Form; base: Form; restored: boolean } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [gps, setGps] = useState<GpsState>('idle');
  const [errors, setErrors] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState<TitleSuggestion | null>(null);
  const [titleState, setTitleState] = useState<'idle' | 'loading' | 'offline'>('idle');
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const settings = useStore(settingsStore);
  const online = useStore(onlineStore);
  const notes = useLiveQuery(allNotes, []);
  const tags = useLiveQuery(allTags, []) ?? [];
  const mapRef = useRef<L.Map | null>(null);
  const editorKey = useRef(0);

  const form = state?.form;
  const set = (patch: Partial<Form>) => setState((s) => s && { ...s, form: { ...s.form, ...patch } });
  const dirty = useMemo(() => !!state && JSON.stringify(state.form) !== JSON.stringify(state.base), [state]);

  const locate = async () => {
    setGps('locating');
    try {
      const p = await getPosition();
      set({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, locationSource: 'gps' });
      setGps('ok');
    } catch (e) {
      setGps(e as GpsError);
    }
  };

  useEffect(() => {
    let cancelled = false;
    initialForm(id, params)
      .then((init) => {
        if (cancelled) return;
        setState(init);
        if (init.needGps) locate();
      })
      .catch(() => setNotFound(true));
    return () => {
      cancelled = true;
    };
  }, [id, params?.toString()]);

  // Concept-autosave (alleen bij wijzigingen; wissen gebeurt bij opslaan, annuleren of verwerpen).
  useEffect(() => {
    if (!state || !dirty) return;
    const timer = setTimeout(() => local.set(draftKey(id), JSON.stringify(state.form)), 400);
    return () => clearTimeout(timer);
  }, [state, dirty]);

  // Titelvoorstel bij een (nieuwe) locatie, zolang de titel niet handmatig is aangepast.
  useEffect(() => {
    if (!form || form.lat == null || form.lng == null || form.titleManual || !notes) return;
    const at = { lat: form.lat, lng: form.lng };
    let cancelled = false;
    const timer = setTimeout(async () => {
      setTitleState('loading');
      let s: TitleSuggestion | null = null;
      try {
        s = await suggestTitle(at, notes, settings.samePlaceRadiusM, langStore.get(), id ?? undefined);
      } catch {
        /* netwerkfout: behandelen als geen voorstel */
      }
      if (cancelled) return;
      setSuggestion(s);
      setTitleState(!s && !navigator.onLine ? 'offline' : 'idle');
      setState((st) => (st && !st.form.titleManual ? { ...st, form: { ...st.form, title: s?.title ?? '' } } : st));
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form?.lat, form?.lng, form?.titleManual, !!notes, retry]);

  if (notFound) return <NotFound />;
  if (!form) return <div class="screen" />;

  const pos: LatLng | null = form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : null;
  const color = tagColor(tags.find((x) => x.id === form.tagId));

  const moveTo = (p: LatLng) => {
    set({ lat: p.lat, lng: p.lng, accuracy: undefined, locationSource: 'map' });
    setGps('idle');
  };

  const pickOnMap = () => {
    const c = mapRef.current?.getCenter();
    if (!pos && c) moveTo({ lat: c.lat, lng: c.lng });
    else set({ locationSource: 'map', accuracy: undefined });
    setGps('idle');
  };

  const cancel = () => {
    if (dirty && !confirm(t('edit.confirmDiscard'))) return;
    local.set(draftKey(id), null);
    goBack(id ? `#/note/${id}` : '#/search');
  };

  const remove = async () => {
    if (!id || !confirm(t('note.confirmDelete'))) return;
    await deleteNote(id);
    local.set(draftKey(id), null);
    navigate('#/search', { replace: true });
  };

  const discardDraft = () => {
    local.set(draftKey(id), null);
    editorKey.current++;
    setState((s) => s && { ...s, form: s.base, restored: false });
  };

  const save = async () => {
    const errs: string[] = [];
    if (!pos) errs.push(t('edit.errorLocation'));
    const hasText = form.text.replace(/<[^>]*>/g, '').trim() !== '';
    if (!hasText && !form.title.trim() && !form.rating) errs.push(t('edit.errorContent'));
    setErrors(errs);
    if (errs.length || saving) return;
    setSaving(true);
    const base = state!.base;
    const timeChanged = form.date !== base.date || form.time !== base.time || !form.originalObservedAt;
    const input: NoteInput = {
      lat: pos!.lat,
      lng: pos!.lng,
      accuracy: form.locationSource === 'gps' ? form.accuracy : undefined,
      locationSource: form.locationSource,
      observedAt: timeChanged ? fromInputs(form.date, form.time) : form.originalObservedAt!,
      title: form.title,
      text: form.text,
      tagId: form.tagId,
      rating: form.rating,
    };
    try {
      const note = id ? await updateNote(id, input) : await createNote(input);
      local.set(draftKey(id), null);
      if (id) goBack(`#/note/${id}`);
      else navigate(`#/note/${note.id}`, { replace: true });
    } finally {
      setSaving(false);
    }
  };

  const coords = pos ? `${fmtNumber(pos.lat, 5)}, ${fmtNumber(pos.lng, 5)}` : null;
  const lowAccuracy = form.locationSource === 'gps' && form.accuracy != null && form.accuracy > settings.samePlaceRadiusM;

  return (
    <div class="screen edit-screen">
      <Header
        title={t(id ? 'edit.titleEdit' : 'edit.titleNew')}
        left={
          <button type="button" class="link" onClick={cancel}>
            {t('common.cancel')}
          </button>
        }
        right={
          <button type="button" class="link strong" onClick={save} disabled={saving}>
            {t('common.save')}
          </button>
        }
      />
      <div class="content">
        {state!.restored && (
          <div class="banner">
            <div class="row between gap">
              <span>{t('edit.draftRestored')}</span>
              <button type="button" class="btn" onClick={discardDraft}>
                {t('edit.draftDiscard')}
              </button>
            </div>
          </div>
        )}

        <Section title={`1 · ${t('edit.location')}`}>
          <PinMap pos={pos} color={color} editable onMove={moveTo} mapRef={mapRef} fallback={settings.defaultMapCenter} hint={t('edit.mapHint')} class="edit-map" />
          <div class="row gap stretch">
            <button type="button" class={`btn ${form.locationSource === 'gps' && pos ? 'btn-soft' : ''}`} onClick={locate} disabled={gps === 'locating'}>
              <Icon name="locate" size={18} /> {t('edit.useGps')}
            </button>
            <button type="button" class={`btn ${form.locationSource === 'map' ? 'btn-soft' : ''}`} onClick={pickOnMap}>
              <Icon name="map" size={18} /> {t('edit.pickOnMap')}
            </button>
          </div>
          <p class="muted small coords" aria-live="polite">
            <Icon name="pin" size={14} />{' '}
            {gps === 'locating'
              ? t('gps.locating')
              : coords
                ? form.locationSource === 'gps'
                  ? `${coords} · ${t('edit.gpsAccuracy', { m: fmtNumber(form.accuracy ?? 0) })}`
                  : `${coords} · ${t('edit.chosenOnMap')}`
                : gps !== 'idle' && gps !== 'ok'
                  ? t(`gps.error.${gps}`)
                  : t('edit.noLocation')}
          </p>
          {lowAccuracy && <p class="warn small">{t('edit.lowAccuracy', { m: fmtNumber(form.accuracy!) })}</p>}
        </Section>

        <Section title={`2 · ${t('edit.dateTime')}`}>
          <div class="row gap stretch">
            <input type="date" class="input" aria-label={t('edit.date')} value={form.date} required onInput={(e) => e.currentTarget.value && set({ date: e.currentTarget.value })} />
            <input type="time" class="input" aria-label={t('edit.time')} value={form.time} required onInput={(e) => e.currentTarget.value && set({ time: e.currentTarget.value })} />
          </div>
          <p class="muted small">{t('edit.dateHint')}</p>
        </Section>

        <Section title={`3 · ${t('edit.titleField')}`}>
          <div class="input-wrap">
            <input
              class="input"
              value={form.title}
              maxLength={120}
              placeholder={titleState === 'loading' ? t('edit.titleLoading') : t('edit.titlePlaceholder')}
              aria-label={t('edit.titleField')}
              onInput={(e) => set({ title: e.currentTarget.value, titleManual: true })}
            />
            {online || suggestion ? (
              <button
                type="button"
                class="icon-btn"
                aria-label={t('edit.titleRefresh')}
                title={t('edit.titleRefresh')}
                onClick={() => (set({ titleManual: false }), setRetry((x) => x + 1))}
              >
                <Icon name="refresh" size={18} />
              </button>
            ) : null}
          </div>
          {titleState === 'offline' && online && !form.titleManual && (
            <button type="button" class="link" onClick={() => setRetry((x) => x + 1)}>
              {t('edit.fetchName')}
            </button>
          )}
          {!form.titleManual && suggestion && (
            <p class="muted small">
              <Icon name="sparkle" size={14} class="accent" />{' '}
              {suggestion.source === 'nearby'
                ? t('edit.suggestedNearby', { date: fmtObserved(suggestion.note.observedAt, 'dayMonth'), d: fmtDistance(suggestion.distance) })
                : t('edit.suggestedMap')}
            </p>
          )}
          {titleState === 'offline' && !form.titleManual && <p class="muted small">{t('edit.titleOffline')}</p>}
        </Section>

        <Section title={`4 · ${t('edit.text')}`}>
          <RichEditor key={editorKey.current} value={form.text} onChange={(html) => set({ text: html })} label={t('edit.text')} />
        </Section>

        <Section title={`5 · ${t('edit.tag')}`}>
          <TagPicker tags={tags} value={form.tagId} onChange={(tagId) => set({ tagId })} />
          <p class="muted small">{t('edit.tagHint')}</p>
        </Section>

        <Section title={`6 · ${t('edit.rating')}`}>
          <div class="center">
            <StarInput value={form.rating} onChange={(rating) => set({ rating })} />
            <p class="muted small">{t('edit.ratingHint')}</p>
          </div>
        </Section>

        {errors.length > 0 && (
          <div class="errors" role="alert">
            {errors.map((e) => (
              <p key={e}>{e}</p>
            ))}
          </div>
        )}

        <button type="button" class="btn btn-primary btn-block" onClick={save} disabled={saving}>
          {t('common.save')}
        </button>
        {id && (
          <button type="button" class="btn btn-danger btn-block" onClick={remove}>
            <Icon name="trash" size={18} /> {t('common.delete')}
          </button>
        )}
      </div>
    </div>
  );
}
