import { NO_TAG } from '../db/notes';
import { UNTAGGED_COLOR, type Tag } from '../db/types';
import { t } from '../i18n';

/** Meerkeuze voor het tagfilter; niets gekozen = alle tags. */
export function TagFilter({ tags, value, onChange }: { tags: Tag[]; value: string[]; onChange: (ids: string[]) => void }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const options = [...tags.map((x) => ({ id: x.id, name: x.name, color: x.color })), { id: NO_TAG, name: t('tag.none'), color: UNTAGGED_COLOR }];
  return (
    <div class="chips wrap">
      {options.map((x) => (
        <button type="button" key={x.id} class={`chip ${value.includes(x.id) ? 'chip-active' : ''}`} aria-pressed={value.includes(x.id)} onClick={() => toggle(x.id)}>
          <span class="dot" style={{ '--c': x.color }} />
          {x.name}
        </button>
      ))}
    </div>
  );
}
