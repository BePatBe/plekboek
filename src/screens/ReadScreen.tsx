import { useMemo, useState } from 'preact/hooks';
import { useLiveQuery } from '../db/live';
import { allNotes, deleteNote } from '../db/notes';
import { db } from '../db/db';
import { allTags } from '../db/tags';
import type { Note } from '../db/types';
import { bestTime, nearbyNotes, type Bucket } from '../analysis/bestTime';
import { fmtDistance, fmtNumber, fmtObserved, monthName, t, useLang, weekdayName } from '../i18n';
import { useStore } from '../lib/store';
import { goBack, navigate } from '../router';
import { settingsStore } from '../state';
import { sanitize } from '../text/sanitize';
import { Header, NotFound, Stars, TagLabel, tagColor } from '../components/common';
import { Icon } from '../components/Icon';
import { PinMap } from '../components/map/PinMap';

export function ReadScreen({ id }: { id: string }) {
  useLang();
  const note = useLiveQuery(() => db.notes.get(id).then((n) => n ?? null), [id]);
  const notes = useLiveQuery(allNotes, []);
  const tags = useLiveQuery(allTags, []) ?? [];
  const settings = useStore(settingsStore);

  if (note === null) return <NotFound />;
  if (!note) return <div class="screen" />;

  const tag = tags.find((x) => x.id === note.tagId);
  const remove = async () => {
    if (!confirm(t('note.confirmDelete'))) return;
    await deleteNote(note.id);
    goBack('#/search');
  };

  return (
    <div class="screen read-screen">
      <Header
        title={t('note.heading')}
        left={
          <button type="button" class="icon-btn" aria-label={t('common.back')} onClick={() => goBack('#/search')}>
            <Icon name="back" size={24} />
          </button>
        }
        right={
          <button type="button" class="link strong" onClick={() => navigate(`#/note/${note.id}/edit`)}>
            {t('common.edit')}
          </button>
        }
      />
      <div class="content">
        <h2 class="note-title">{note.title || t('note.untitled')}</h2>
        <div class="row gap wrap">
          {tag && <TagLabel tag={tag} />}
          <Stars rating={note.rating} size="md" />
        </div>
        <p class="muted row gap">
          <Icon name="calendar" size={18} />
          {fmtObserved(note.observedAt, 'long')} · {fmtObserved(note.observedAt, 'time')}
        </p>

        <div class="card map-card">
          <PinMap pos={note} color={tagColor(tag)} class="read-map" />
          <p class="muted small coords">
            <Icon name="pin" size={14} /> {fmtNumber(note.lat, 5)}, {fmtNumber(note.lng, 5)} ·{' '}
            {note.locationSource === 'gps' ? (note.accuracy != null ? `GPS ±${fmtNumber(note.accuracy)} m` : 'GPS') : t('edit.chosenOnMap')}
          </p>
        </div>

        {note.text && <div class="card rich" dangerouslySetInnerHTML={{ __html: sanitize(note.text) }} />}

        <div class="row gap stretch">
          <button type="button" class="btn btn-soft" onClick={() => navigate(`#/note/new?from=${encodeURIComponent(note.id)}`)}>
            <Icon name="plus" size={18} /> {t('note.newHere')}
          </button>
          <button type="button" class="btn btn-danger-outline grow-0" onClick={remove}>
            <Icon name="trash" size={18} /> {t('common.delete')}
          </button>
        </div>

        {notes && <PlaceOverTime note={note} notes={notes} radius={settings.samePlaceRadiusM} />}
      </div>
    </div>
  );
}

type Tab = 'timeOfDay' | 'weekday' | 'month';

function PlaceOverTime({ note, notes, radius }: { note: Note; notes: Note[]; radius: number }) {
  const [tab, setTab] = useState<Tab>('timeOfDay');
  const nearby = useMemo(() => nearbyNotes(note, notes, radius), [note, notes, radius]);
  const best = useMemo(() => bestTime(nearby.map((x) => x.note)), [nearby]);

  const labelOf = (k: string | number): string =>
    tab === 'timeOfDay' ? t(`tod.${k}`) : tab === 'weekday' ? weekdayName(k as number) : monthName(k as number);

  const buckets = (best?.[tab] ?? []) as Bucket<string | number>[];
  const bestKey = best?.best[tab];

  return (
    <section class="section">
      <h2 class="section-title">{t('place.overTime', { r: fmtNumber(radius) })}</h2>
      {best ? (
        <div class="card">
          <div class="best-summary">
            <Icon name="trophy" size={28} class="accent" />
            <div>
              <p
                dangerouslySetInnerHTML={{
                  __html: t('best.summary', {
                    tod: `<strong>${t(`tod.${best.best.timeOfDay}`).toLocaleLowerCase()}</strong>`,
                    day: `<strong>${weekdayName(best.best.weekday!)}</strong>`,
                    month: `<strong>${monthName(best.best.month!)}</strong>`,
                  }),
                }}
              />
              <p class="muted small">{t('best.basedOn', { n: best.rated })}</p>
            </div>
          </div>
          <div class="segmented small" role="tablist">
            {(['timeOfDay', 'weekday', 'month'] as Tab[]).map((x) => (
              <button type="button" key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)}>
                {t(`best.tab.${x}`)}
              </button>
            ))}
          </div>
          <div class="bars" role="tabpanel">
            {buckets.map((b) => (
              <div class={`bar-row ${b.key === bestKey ? 'best' : ''}`} key={b.key}>
                <span class="bar-label">{labelOf(b.key)}</span>
                <span class="bar-track">
                  <span class="bar-fill" style={{ width: `${((b.avg ?? 0) / 5) * 100}%` }} />
                </span>
                <span class="bar-value">{b.avg == null ? '–' : `★ ${fmtNumber(b.avg, 1)} · ${b.count}×`}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p class="muted small">{t('best.notEnough')}</p>
      )}
      <ol class="card timeline">
        {nearby.map(({ note: n, distance }) => (
          <li key={n.id} class={n.id === note.id ? 'current' : ''}>
            <a
              href={`#/note/${n.id}`}
              onClick={(e) => {
                e.preventDefault();
                if (n.id !== note.id) navigate(`#/note/${n.id}`);
              }}
            >
              <span class="tl-dot" />
              <span class="tl-when">
                <strong>{fmtObserved(n.observedAt, 'short')}</strong> · {fmtObserved(n.observedAt, 'time')}
                <span class="muted"> · {n.id === note.id ? t('place.here') : fmtDistance(distance)}</span>
              </span>
              <Stars rating={n.rating} />
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
