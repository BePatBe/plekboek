import { useEffect, useRef, useState } from 'preact/hooks';
import { useLiveQuery } from '../db/live';
import { allTags, createTag, deleteTag, DuplicateTagError, tagCounts, updateTag } from '../db/tags';
import type { Settings, Tag } from '../db/types';
import { exportBackup } from '../backup/export';
import { applyImport, parseBackup, type ImportMode, type ParsedBackup } from '../backup/import';
import { db } from '../db/db';
import { fmtBytes, fmtNumber, fmtObserved, t, tn, useLang } from '../i18n';
import { useStore } from '../lib/store';
import { daysSince, toLocalIso } from '../lib/time';
import { installedStore, installPromptStore, isIOS, promptInstall, replaceSettings, settingsStore, updateSettings } from '../state';
import { Header, Modal, Section, Segmented, Toast } from '../components/common';
import { Icon } from '../components/Icon';
import { IosInstallSteps } from '../components/InstallHelp';

export function SettingsScreen() {
  useLang();
  const s = useStore(settingsStore);
  const [toast, setToast] = useState('');

  return (
    <div class="screen settings-screen">
      <Header title={t('settings.title')} />
      <div class="content">
        <Section title={t('settings.language')}>
          <Segmented<Settings['language']>
            label={t('settings.language')}
            value={s.language}
            onChange={(language) => updateSettings({ language })}
            options={[
              { value: 'system', label: t('settings.system') },
              { value: 'nl', label: 'Nederlands' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Section>

        <Section title={t('settings.theme')}>
          <Segmented<Settings['theme']>
            label={t('settings.theme')}
            value={s.theme}
            onChange={(theme) => updateSettings({ theme })}
            options={[
              { value: 'system', label: t('settings.system') },
              { value: 'light', label: <><Icon name="sun" size={16} /> {t('settings.light')}</> },
              { value: 'dark', label: <><Icon name="moon" size={16} /> {t('settings.dark')}</> },
            ]}
          />
          <p class="muted small">{t('settings.themeHint')}</p>
        </Section>

        <Section title={t('settings.tags')}>
          <TagManager />
        </Section>

        <Section title={t('settings.radius')}>
          <div class="row between">
            <label for="radius">{t('settings.radiusHint')}</label>
            <strong class="accent">{fmtNumber(s.samePlaceRadiusM)} m</strong>
          </div>
          <input
            id="radius"
            type="range"
            min={25}
            max={500}
            step={25}
            value={s.samePlaceRadiusM}
            onInput={(e) => updateSettings({ samePlaceRadiusM: Number(e.currentTarget.value) })}
          />
          <div class="row between muted small">
            <span>25 m</span>
            <span>250 m</span>
            <span>500 m</span>
          </div>
        </Section>

        <Section title={t('settings.backup')}>
          <Backup settings={s} onToast={setToast} />
        </Section>

        <Section title={t('settings.offlineMap')}>
          <TileCache onToast={setToast} />
        </Section>

        <InstallSection />

        <Section title={t('settings.about')}>
          <div class="kv">
            <span>{t('settings.version')}</span>
            <span>{__APP_VERSION__}</span>
          </div>
          <div class="kv">
            <span>{t('settings.mapData')}</span>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
              © {t('settings.osmContributors')}
            </a>
          </div>
          <details class="licenses">
            <summary>{t('settings.licenses')}</summary>
            <ul class="small muted">
              <li>OpenStreetMap — kaartdata © OpenStreetMap-bijdragers, ODbL; Nominatim-geocoder</li>
              <li>Leaflet — BSD-2-Clause</li>
              <li>Leaflet.markercluster — MIT</li>
              <li>Preact — MIT</li>
              <li>Dexie.js — Apache-2.0</li>
              <li>Tiptap — MIT</li>
              <li>DOMPurify — Apache-2.0 / MPL-2.0</li>
              <li>Workbox — MIT</li>
            </ul>
          </details>
        </Section>
      </div>
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
    </div>
  );
}

/* ---------- tags beheren ---------- */

function TagManager() {
  const tags = useLiveQuery(allTags, []) ?? [];
  const counts = useLiveQuery(tagCounts, []) ?? new Map<string, number>();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Tag | null>(null);
  const [error, setError] = useState('');

  const handle = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError('');
      return true;
    } catch (e) {
      setError(e instanceof DuplicateTagError ? t('tag.duplicate') : t('tag.emptyName'));
      return false;
    }
  };

  return (
    <>
      <ul class="tag-list">
        {tags.map((tag) => (
          <li key={tag.id}>
            <label class="color-swatch" style={{ '--c': tag.color }} title={t('tag.color')}>
              <input type="color" value={tag.color} aria-label={`${t('tag.color')}: ${tag.name}`} onChange={(e) => updateTag(tag.id, { color: e.currentTarget.value })} />
            </label>
            {editing === tag.id ? (
              <NameForm
                initial={tag.name}
                onCancel={() => (setEditing(null), setError(''))}
                onSubmit={async (name) => (await handle(() => updateTag(tag.id, { name }))) && setEditing(null)}
              />
            ) : (
              <>
                <span class="grow">{tag.name}</span>
                <span class="muted small">{tn('tag.count', counts.get(tag.id) ?? 0)}</span>
                <button type="button" class="icon-btn" aria-label={`${t('tag.rename')}: ${tag.name}`} onClick={() => setEditing(tag.id)}>
                  <Icon name="edit" size={18} />
                </button>
                <button type="button" class="icon-btn" aria-label={`${t('common.delete')}: ${tag.name}`} onClick={() => setRemoving(tag)}>
                  <Icon name="trash" size={18} />
                </button>
              </>
            )}
          </li>
        ))}
        <li>
          {adding ? (
            <NameForm onCancel={() => (setAdding(false), setError(''))} onSubmit={async (name) => (await handle(() => createTag(name))) && setAdding(false)} />
          ) : (
            <button type="button" class="link add-tag" onClick={() => setAdding(true)}>
              <span class="add-circle">+</span> {t('tag.new')}
            </button>
          )}
        </li>
      </ul>
      {error && <p class="error">{error}</p>}
      {removing && <DeleteTagDialog tag={removing} tags={tags} count={counts.get(removing.id) ?? 0} onClose={() => setRemoving(null)} />}
    </>
  );
}

function NameForm({ initial = '', onSubmit, onCancel }: { initial?: string; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  return (
    <form
      class="row gap grow"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(name);
      }}
    >
      <input class="input" value={name} maxLength={40} autoFocus aria-label={t('tag.name')} placeholder={t('tag.namePlaceholder')} onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Escape' && onCancel()} />
      <button class="btn btn-primary" type="submit">
        {t('common.save')}
      </button>
      <button class="btn" type="button" onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </form>
  );
}

function DeleteTagDialog({ tag, tags, count, onClose }: { tag: Tag; tags: Tag[]; count: number; onClose: () => void }) {
  const others = tags.filter((x) => x.id !== tag.id);
  const [target, setTarget] = useState<string>('');
  return (
    <Modal title={t('tag.deleteTitle', { name: tag.name })} onClose={onClose}>
      {count > 0 ? (
        <>
          <p>{tn('tag.deleteQuestion', count)}</p>
          <label class="field">
            <select class="input" value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
              <option value="">{t('tag.deleteToNone')}</option>
              {others.map((x) => (
                <option key={x.id} value={x.id}>
                  {t('tag.deleteMoveTo', { name: x.name })}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <p>{t('tag.deleteEmpty')}</p>
      )}
      <div class="row gap end">
        <button type="button" class="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          class="btn btn-danger"
          onClick={async () => {
            await deleteTag(tag.id, target || null);
            onClose();
          }}
        >
          {t('common.delete')}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- back-up ---------- */

const REMINDER_OPTIONS = [0, 7, 14, 30, 60, 90];

function Backup({ settings, onToast }: { settings: Settings; onToast: (m: string) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [parseError, setParseError] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteCount = useLiveQuery(() => db.notes.count(), []) ?? 0;

  const overdue =
    settings.backupReminderDays > 0 &&
    noteCount > 0 &&
    (!settings.lastExportAt || daysSince(settings.lastExportAt) >= settings.backupReminderDays);

  const doExport = async () => {
    setBusy(true);
    try {
      const r = await exportBackup();
      if (r) {
        await updateSettings({ lastExportAt: toLocalIso() });
        onToast(t('backup.exported', { file: r.fileName }));
      }
    } catch {
      onToast(t('backup.exportFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      setParseError(t(`backup.error.${parsed.error}`));
      return;
    }
    setParseError('');
    setPending(parsed.data);
  };

  const doImport = async (mode: ImportMode) => {
    if (!pending) return;
    if (mode === 'replace' && !confirm(t('backup.confirmReplace'))) return;
    setBusy(true);
    try {
      const r = await applyImport(pending, mode);
      if (r.settings) replaceSettings(r.settings);
      setPending(null);
      setSummary(
        [
          tn('backup.sumAdded', r.added),
          tn('backup.sumUpdated', r.updated),
          r.unchanged ? tn('backup.sumUnchanged', r.unchanged) : null,
          tn('backup.sumSkipped', r.skipped),
        ]
          .filter(Boolean)
          .join(', ') + (r.tagsAdded ? `; ${tn('backup.sumTags', r.tagsAdded)}` : ''),
      );
    } catch {
      onToast(t('backup.importFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {overdue && (
        <p class="banner banner-warn">
          {settings.lastExportAt ? t('backup.reminder', { days: daysSince(settings.lastExportAt) }) : t('backup.reminderNever')}
        </p>
      )}
      <div class="row gap stretch">
        <button type="button" class="btn btn-primary" onClick={doExport} disabled={busy}>
          <Icon name="upload" size={18} /> {t('backup.export')}
        </button>
        <button type="button" class="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
          <Icon name="download" size={18} /> {t('backup.import')}
        </button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={onFile} />
      </div>
      {parseError && <p class="error">{parseError}</p>}
      <label class="row between">
        <span>{t('backup.reminderAfter')}</span>
        <select class="input input-inline" value={settings.backupReminderDays} onChange={(e) => updateSettings({ backupReminderDays: Number(e.currentTarget.value) })}>
          {REMINDER_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d === 0 ? t('backup.reminderOff') : tn('backup.days', d)}
            </option>
          ))}
        </select>
      </label>
      <p class="muted small">
        {settings.lastExportAt
          ? t('backup.last', { date: fmtObserved(settings.lastExportAt, 'short'), days: tn('backup.daysAgo', daysSince(settings.lastExportAt)) })
          : t('backup.never')}
      </p>

      {pending && (
        <Modal title={t('backup.importTitle')} onClose={() => setPending(null)}>
          <p>
            {t('backup.importContains', { notes: tn('backup.notes', pending.notes.length), tags: tn('backup.tags', pending.tags.length) })}
            {pending.invalid > 0 && ` ${tn('backup.invalid', pending.invalid)}`}
          </p>
          <div class="stack">
            <button type="button" class="btn btn-primary" disabled={busy} onClick={() => doImport('merge')}>
              {t('backup.merge')}
            </button>
            <p class="muted small">{t('backup.mergeHint')}</p>
            <button type="button" class="btn btn-danger-outline" disabled={busy} onClick={() => doImport('replace')}>
              {t('backup.replace')}
            </button>
            <p class="muted small">{t('backup.replaceHint')}</p>
            <button type="button" class="btn" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </Modal>
      )}
      {summary && (
        <Modal title={t('backup.importDone')} onClose={() => setSummary(null)}>
          <p>{summary}</p>
          <div class="row end">
            <button type="button" class="btn btn-primary" onClick={() => setSummary(null)}>
              {t('common.ok')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------- tegelcache ---------- */

const TILE_CACHE = 'osm-tiles';

function TileCache({ onToast }: { onToast: (m: string) => void }) {
  const [info, setInfo] = useState<{ count: number; bytes: number } | null>(null);

  const measure = async () => {
    if (!('caches' in window)) return setInfo({ count: 0, bytes: 0 });
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    let bytes = 0;
    for (const req of keys) {
      const res = await cache.match(req);
      const len = Number(res?.headers.get('content-length'));
      bytes += len > 0 ? len : (await res?.blob())?.size ?? 0;
    }
    setInfo({ count: keys.length, bytes });
  };

  useEffect(() => {
    measure();
  }, []);

  return (
    <>
      <div class="row between">
        <span>{t('settings.tilesStored')}</span>
        <span class="muted">{info ? `${fmtNumber(info.count)} · ${fmtBytes(info.bytes)}` : '…'}</span>
      </div>
      <p class="muted small">{t('settings.tilesTip')}</p>
      <button
        type="button"
        class="btn btn-block"
        onClick={async () => {
          if ('caches' in window) await caches.delete(TILE_CACHE);
          await measure();
          onToast(t('settings.tilesCleared'));
        }}
      >
        {t('settings.clearCache')}
      </button>
    </>
  );
}

/* ---------- installeren ---------- */

function InstallSection() {
  const installed = useStore(installedStore);
  const prompt = useStore(installPromptStore);
  if (installed || (!prompt && !isIOS())) return null;
  return (
    <Section title={t('install.title')}>
      {prompt ? (
        <>
          <p class="muted small">{t('install.hint')}</p>
          <button type="button" class="btn btn-primary btn-block" onClick={promptInstall}>
            {t('install.button')}
          </button>
        </>
      ) : (
        <IosInstallSteps />
      )}
    </Section>
  );
}
