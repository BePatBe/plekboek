import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Note, Tag } from '../db/types';
import { distance } from '../geo/distance';
import type { Position } from '../geo/gps';
import { fmtDistance, fmtObserved, t, useLang } from '../i18n';
import { Stars, TagLabel, tagColor } from './common';
import { Icon } from './Icon';

/** Afstand tussen de middelpunten van twee kleine cards (incl. tussenruimte). */
const SLOT = 64;
const SMALL_H = 52;
const BIG_H = 192;
const GROW = BIG_H - SMALL_H;
/** Alleen cards binnen dit aantal posities van de actieve card worden gerenderd. */
const WINDOW = 12;

interface Props {
  notes: Note[];
  tags: Map<string, Tag>;
  activeId: string | null;
  onActive: (id: string, index: number) => void;
  onOpen: (id: string) => void;
  position: Position | null;
  /** Verzoek van buitenaf (bijv. tik op een marker) om naar een card te scrollen. */
  request: { id: string; seq: number } | null;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Het cards-wiel (§4.1): verticaal scrollen met snap per card, de middelste card is groot,
 * de cards eromheen kantelen weg als op een liggende cilinder.
 * Alle slots zijn even hoog, zodat snappen stabiel blijft; de groei van de actieve card
 * gebeurt met transforms (zonder layout), en de buren schuiven evenveel op.
 */
export function CardWheel({ notes, tags, activeId, onActive, onOpen, position, request }: Props) {
  useLang();
  const scroller = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<number, HTMLElement>());
  const [pad, setPad] = useState(0);
  const [active, setActive] = useState(() => Math.max(0, notes.findIndex((n) => n.id === activeId)));
  const activeRef = useRef(active);
  const frame = useRef(0);
  const callbacks = useRef({ onActive, onOpen });
  callbacks.current = { onActive, onOpen };
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const layout = () => {
    frame.current = 0;
    const el = scroller.current;
    if (!el) return;
    const half = el.clientHeight / 2;
    const st = el.scrollTop;
    const flat = reducedMotion();
    for (const [i, card] of cards.current) {
      const s = (i * SLOT - st) / SLOT; // afstand tot het midden in slots
      const e = Math.max(0, 1 - Math.abs(s)); // 1 = volledig open
      const d = clamp((s * SLOT) / half, -1, 1); // genormaliseerd −1…1 over het zichtbare vak
      const shift = clamp(s, -1, 1) * (GROW / 2);
      const tilt = flat ? '' : ` perspective(700px) rotateX(${(d * -55).toFixed(2)}deg)`;
      card.style.height = `${SMALL_H + e * GROW}px`;
      card.style.transform = `translateY(calc(-50% + ${shift.toFixed(1)}px))${tilt} scale(${(1 - Math.abs(d) * 0.18).toFixed(3)})`;
      card.style.opacity = (1 - Math.abs(d) * 0.7).toFixed(3);
      card.style.zIndex = String(100 - Math.round(Math.abs(s) * 10));
      card.style.setProperty('--e', e.toFixed(3));
    }
    const idx = clamp(Math.round(st / SLOT), 0, notesRef.current.length - 1);
    if (idx !== activeRef.current && notesRef.current[idx]) {
      activeRef.current = idx;
      setActive(idx);
      navigator.vibrate?.(5);
      callbacks.current.onActive(notesRef.current[idx].id, idx);
    }
  };

  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(layout);
  };

  const scrollToIndex = (i: number, smooth = true) => {
    const el = scroller.current;
    if (!el) return;
    i = clamp(i, 0, notes.length - 1);
    el.scrollTo({ top: i * SLOT, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  };

  // Opvulling boven en onder, zodat ook de eerste en laatste card in het midden kunnen staan.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return; // lege resultaten: geen wiel
    const ro = new ResizeObserver(() => {
      setPad(Math.max(0, el.clientHeight / 2 - SLOT / 2));
      schedule();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [notes.length === 0]);

  // Nieuwe resultaten: blijf op dezelfde notitie als die er nog in zit, anders bovenaan.
  useLayoutEffect(() => {
    const idx = Math.max(0, notes.findIndex((n) => n.id === activeId));
    activeRef.current = idx;
    setActive(idx);
    if (scroller.current) scroller.current.scrollTop = idx * SLOT;
    if (notes[idx] && notes[idx].id !== activeId) callbacks.current.onActive(notes[idx].id, idx);
    schedule();
  }, [notes, pad]);

  useLayoutEffect(schedule, [active]);

  useEffect(() => {
    if (!request) return;
    const idx = notes.findIndex((n) => n.id === request.id);
    if (idx >= 0) scrollToIndex(idx);
  }, [request?.seq]);

  // Toetsenbord: ↑/↓ naar vorige/volgende card, Enter opent de actieve card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable], .leaflet-container, .modal, .filter-panel')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        scrollToIndex(activeRef.current + (e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'Enter' && notesRef.current[activeRef.current] && (target === document.body || target === scroller.current)) {
        e.preventDefault();
        callbacks.current.onOpen(notesRef.current[activeRef.current].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notes.length]);

  if (!notes.length) {
    return (
      <div class="wheel wheel-empty">
        <div class="note-card empty">{t('search.noResults')}</div>
      </div>
    );
  }

  const lo = active - WINDOW;
  const hi = active + WINDOW;

  return (
    <div class="wheel" ref={scroller} tabIndex={0} onScroll={schedule} aria-label={t('search.resultsLabel')}>
      <div style={{ height: `${pad}px` }} />
      {notes.map((n, i) => (
        <div class="slot" key={n.id} style={{ height: `${SLOT}px` }}>
          {i >= lo && i <= hi && (
            <NoteCard
              note={n}
              tag={n.tagId ? tags.get(n.tagId) : undefined}
              active={i === active}
              position={position}
              cardRef={(el) => {
                if (el) cards.current.set(i, el);
                else cards.current.delete(i);
              }}
              onClick={() => (i === activeRef.current ? onOpen(n.id) : scrollToIndex(i))}
            />
          )}
        </div>
      ))}
      <div style={{ height: `${pad}px` }} />
    </div>
  );
}

interface CardProps {
  note: Note;
  tag: Tag | undefined;
  active: boolean;
  position: Position | null;
  cardRef: (el: HTMLElement | null) => void;
  onClick: () => void;
}

function NoteCard({ note, tag, active, position, cardRef, onClick }: CardProps) {
  const title = note.title || note.textPlain.split('\n')[0] || t('note.untitled');
  const when = `${fmtObserved(note.observedAt, 'medium')} · ${fmtObserved(note.observedAt, 'time')}`;
  return (
    <article
      ref={cardRef}
      class={`note-card wheel-card${active ? ' active' : ''}`}
      style={{ '--c': tagColor(tag) }}
      onClick={onClick}
      aria-current={active}
      aria-label={title}
    >
      <div class="card-compact" aria-hidden={active}>
        <span class="dot" />
        <span class="title">{title}</span>
        <Stars rating={note.rating} />
        <span class="date">{fmtObserved(note.observedAt, 'dayMonth')}</span>
      </div>
      <div class="card-full" aria-hidden={!active}>
        <div class="row between">
          <h3 class="title">{title}</h3>
          <Stars rating={note.rating} size="md" />
        </div>
        <div class="row gap meta">
          {tag && <TagLabel tag={tag} />}
          <span class="muted">{when}</span>
        </div>
        <p class="excerpt">{note.textPlain}</p>
        <div class="row between foot">
          <span class="muted">
            {position && (
              <>
                <Icon name="pin" size={16} /> {t('search.distanceFromYou', { d: fmtDistance(distance(position, note)) })}
              </>
            )}
          </span>
          <span class="open-link">{t('search.open')} ›</span>
        </div>
      </div>
    </article>
  );
}
