import { useEffect, useRef, useState } from 'preact/hooks';
import type { Tag } from '../db/types';
import { createTag, DuplicateTagError } from '../db/tags';
import { t, useLang } from '../i18n';
import { TagLabel } from './common';

interface Props {
  tags: Tag[];
  value: string | null;
  onChange: (id: string | null) => void;
}

export function TagPicker({ tags, value, onChange }: Props) {
  useLang();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const current = tags.find((x) => x.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  const add = async (e: Event) => {
    e.preventDefault();
    try {
      const tag = await createTag(name);
      onChange(tag.id);
      setAdding(false);
      setName('');
      setError('');
    } catch (err) {
      setError(err instanceof DuplicateTagError ? t('tag.duplicate') : t('tag.emptyName'));
    }
  };

  return (
    <div class="tagpicker" ref={root}>
      <button
        type="button"
        class="select"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        <TagLabel tag={current} />
        <span class="caret">▾</span>
      </button>
      {open && (
        <ul class="menu" role="listbox">
          <li role="option" aria-selected={value === null}>
            <button type="button" onClick={() => pick(null)}>
              <TagLabel tag={null} />
            </button>
          </li>
          {tags.map((tag) => (
            <li role="option" key={tag.id} aria-selected={tag.id === value}>
              <button type="button" onClick={() => pick(tag.id)}>
                <TagLabel tag={tag} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form class="row gap" onSubmit={add}>
          <input
            class="input"
            value={name}
            maxLength={40}
            placeholder={t('tag.namePlaceholder')}
            aria-label={t('tag.name')}
            onInput={(e) => setName(e.currentTarget.value)}
            autoFocus
          />
          <button class="btn btn-primary" type="submit">
            {t('common.add')}
          </button>
          <button class="btn" type="button" onClick={() => (setAdding(false), setError(''))}>
            {t('common.cancel')}
          </button>
        </form>
      ) : (
        <button type="button" class="link" onClick={() => setAdding(true)}>
          + {t('tag.new')}
        </button>
      )}
      {error && <p class="error">{error}</p>}
    </div>
  );
}
