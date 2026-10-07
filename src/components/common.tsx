import type { ComponentChildren } from 'preact';
import type { Rating, Tag } from '../db/types';
import { UNTAGGED_COLOR } from '../db/types';
import { t, useLang } from '../i18n';
import { navigate, type Route } from '../router';
import { onlineStore } from '../state';
import { useStore } from '../lib/store';
import { Icon } from './Icon';

export function Stars({ rating, size = 'sm', prefix }: { rating: Rating | null; size?: 'sm' | 'md'; prefix?: string }) {
  useLang();
  const value = rating ? t('rating.label', { n: rating }) : t('rating.none');
  const label = prefix ? `${prefix}: ${value}` : value;
  return (
    <span class={`stars stars-${size}`} role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} class={rating && i <= rating ? 'on' : 'off'}>★</span>
      ))}
    </span>
  );
}

/**
 * Plek- en activiteitsbeoordeling samen: naast of onder elkaar (plek eerst), met of zonder naam ervoor.
 * Zonder activiteitsbeoordeling alleen de plek, zoals voorheen.
 */
export function Ratings({
  note,
  size = 'sm',
  labeled = false,
  stacked = false,
}: {
  note: { rating: Rating | null; activityRating?: Rating | null };
  size?: 'sm' | 'md';
  labeled?: boolean;
  stacked?: boolean;
}) {
  useLang();
  const activity = note.activityRating ?? null;
  if (!activity) return <Stars rating={note.rating} size={size} prefix={t('rating.place')} />;
  const item = (name: string, r: Rating | null) =>
    labeled ? (
      <span class="rating-item">
        <span class="muted small">{name}</span>
        <Stars rating={r} size={size} prefix={name} />
      </span>
    ) : (
      <Stars rating={r} size={size} prefix={name} />
    );
  return (
    <span class={stacked ? 'ratings ratings-stacked' : 'ratings'}>
      {item(t('rating.place'), note.rating)}
      {item(t('rating.activity'), activity)}
    </span>
  );
}

export function StarInput({ value, onChange, label }: { value: Rating | null; onChange: (r: Rating | null) => void; label?: string }) {
  useLang();
  return (
    <div class="star-input" role="radiogroup" aria-label={label ?? t('edit.rating')}>
      {([1, 2, 3, 4, 5] as Rating[]).map((i) => (
        <button
          type="button"
          key={i}
          role="radio"
          aria-checked={value === i}
          aria-label={t('rating.label', { n: i })}
          class={value && i <= value ? 'on' : 'off'}
          onClick={() => onChange(value === i ? null : i)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function TagLabel({ tag }: { tag: Tag | null | undefined }) {
  useLang();
  if (!tag) return <span class="tag tag-none">{t('tag.none')}</span>;
  return (
    <span class="tag" style={{ '--c': tag.color }}>
      <span class="dot" />
      {tag.name}
    </span>
  );
}

export const tagColor = (tag: Tag | null | undefined) => tag?.color ?? UNTAGGED_COLOR;

export function OfflineBadge() {
  useLang();
  const online = useStore(onlineStore);
  if (online) return null;
  return (
    <span class="offline-badge" role="status">
      <span class="dot" /> {t('app.offline')}
    </span>
  );
}

export function Header({ title, left, right }: { title: ComponentChildren; left?: ComponentChildren; right?: ComponentChildren }) {
  return (
    <header class="topbar">
      <div class="topbar-left">{left}</div>
      <h1 class="topbar-title">{title}</h1>
      <div class="topbar-right">
        <OfflineBadge />
        {right}
      </div>
    </header>
  );
}

export function Section({ title, children, id }: { title: ComponentChildren; children: ComponentChildren; id?: string }) {
  return (
    <section class="section" id={id}>
      <h2 class="section-title">{title}</h2>
      <div class="card">{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ComponentChildren }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function BottomNav({ route }: { route: Route }) {
  useLang();
  const active = route.name === 'settings' ? 'settings' : route.name === 'search' || route.name === 'read' ? 'search' : 'new';
  return (
    <nav class="bottomnav" aria-label={t('nav.label')}>
      <a href="#/search" class={active === 'search' ? 'active' : ''} onClick={(e) => go(e, '#/search')}>
        <Icon name="search" size={24} />
        <span>{t('nav.search')}</span>
      </a>
      <a href="#/note/new" class="fab" aria-label={t('nav.new')} onClick={(e) => go(e, '#/note/new')}>
        <Icon name="plus" size={30} />
      </a>
      <a href="#/settings" class={active === 'settings' ? 'active' : ''} onClick={(e) => go(e, '#/settings')}>
        <Icon name="settings" size={24} />
        <span>{t('nav.settings')}</span>
      </a>
    </nav>
  );
}

function go(e: MouseEvent, hash: string) {
  e.preventDefault();
  if (location.hash !== hash) navigate(hash);
}

/** Simpele modale dialoog op basis van <dialog>. */
export function Modal({ title, children, onClose }: { title: string; children: ComponentChildren; onClose: () => void }) {
  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Toast({
  message,
  onDone,
  action,
  long = false,
}: {
  message: string;
  onDone: () => void;
  action?: { label: string; onClick: () => void };
  /** langer zichtbaar, bijv. als er een actie in staat */
  long?: boolean;
}) {
  return (
    <div class={`toast${long ? ' toast-long' : ''}`} role="status" onAnimationEnd={(e) => e.target === e.currentTarget && onDone()}>
      {message}
      {action && (
        <button type="button" class="toast-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
export function NotFound() {
  useLang();
  return (
    <div class="screen">
      <Header title={t('note.notFound')} />
      <div class="content">
        <p>{t('note.notFoundText')}</p>
        <a class="btn" href="#/search">
          {t('nav.search')}
        </a>
      </div>
    </div>
  );
}
