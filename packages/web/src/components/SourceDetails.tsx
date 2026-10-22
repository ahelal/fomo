import React, { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_COLOR,
  isGithubRepoUrl,
  isYoutubeChannelUrl,
  sourceDraft,
  sourceDraftPatch,
  timeAgo,
  userSource,
  type AppSettings,
  type SourceDraft,
  type SourceInfo,
  type StatsResponse,
} from '@fomo/core';
import { ColorButton, useColorPicker } from './ColorPicker.js';

interface Props {
  source: SourceInfo;
  settings: AppSettings;
  stats?: StatsResponse;
  onSave(patch: Partial<AppSettings>): void;
  /** Remove the source, keeping its stored updates unless `deleteItems`. */
  onRemove(deleteItems: boolean): void;
  /** Delete every stored update of the source. */
  onDeleteItems(): void;
  /** Bring back a removed built-in. */
  onRestore(): void;
  onShowUpdates(): void;
  onClose(): void;
}

const KIND_LABEL: Record<SourceInfo['kind'], string> = {
  feed: 'RSS/Atom feed',
  'github-releases': 'GitHub releases',
  youtube: 'YouTube',
  custom: 'Custom code',
};

/** Everything about one source, and the place to change or remove it. */
export function SourceDetails({ source, settings, stats, onSave, onRemove, onDeleteItems, onRestore, onShowUpdates, onClose }: Props) {
  const own = userSource(settings, source.id);
  const [draft, setDraft] = useState<SourceDraft>(() => {
    const d = sourceDraft(settings, source.id);
    return { ...d, url: d.url.split(' ').join('\n') };
  });
  const set = (patch: Partial<SourceDraft>) => { setDraft((d) => ({ ...d, ...patch })); setError(undefined); };
  const colorPicker = useColorPicker();
  const [error, setError] = useState<string | undefined>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const removed = !!source.removed;
  const items = stats?.bySource[source.id] ?? 0;
  const saved = stats?.savedBySource?.[source.id] ?? 0;

  const formRef = useRef<HTMLFormElement>(null);
  // Take the focus so Esc closes this popup, not the config behind it
  useEffect(() => formRef.current?.focus(), []);

  const history = stats?.sourceStatus?.[source.id];
  const isRepo = isGithubRepoUrl(draft.url);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (removed) return;
    const result = sourceDraftPatch(settings, source.id, draft);
    if ('error' in result) { setError(result.error); return; }
    onSave(result.patch);
    onClose();
  };

  return (
    <div className="settings-overlay source-details__overlay" onClick={onClose}>
      <form
        ref={formRef}
        tabIndex={-1}
        className="settings-panel source-details"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}
        onSubmit={save}
        aria-label={`${source.displayName} details`}
      >
        <div className="settings-panel__header">
          <h2>{source.displayName}</h2>
          <button className="btn" type="button" onClick={onClose}>✕</button>
        </div>
        <p className="source-details__badges">
          {removed ? <span className="source-details__badge">Removed</span> : <>
            <span className="source-details__badge">{KIND_LABEL[source.kind]}</span>
            <span className="source-details__badge">{source.builtin ? 'Built-in' : 'Yours'}</span>
          </>}
          <span className="source-details__id">{source.id}</span>
        </p>

        <div className="settings-panel__section">
          <h3>Status</h3>
          <dl className="source-details__facts">
            <dt>Items</dt><dd>{items}{saved > 0 ? ` (${saved} pending)` : ''}</dd>
            <dt>Last fetched</dt><dd>{history?.lastFetchAt ? timeAgo(history.lastFetchAt) : 'never'}</dd>
            <dt>Last new item</dt><dd>{history?.lastAddedAt ? timeAgo(history.lastAddedAt) : '—'}</dd>
            {history?.lastError && <><dt>Last error</dt><dd className="source-details__error">⚠ {history.lastError}</dd></>}
          </dl>
          {removed ? (
            <p className="settings-panel__hint">
              Removed — no longer fetched. Its {items} items still show in your lists; delete them to remove it for good{source.builtin ? ', or restore it' : ''}.
            </p>
          ) : (
            <label className="source-details__check">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled
            </label>
          )}
        </div>

        {!removed && <>

        <div className="settings-panel__section">
          <h3>Look</h3>
          <label className="source-details__field">
            <span>Label</span>
            <input className="settings-panel__add-input" value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder={source.displayName} />
          </label>
          <div className="source-details__color">
            <span>Color</span>
            <ColorButton
              color={draft.color}
              fallback={DEFAULT_COLOR}
              onClick={() => colorPicker.open({
                title: source.displayName,
                color: draft.color,
                fallback: DEFAULT_COLOR,
                fallbackLabel: 'default',
                sample: draft.label || source.displayName,
                onPick: (color) => set({ color }),
              })}
            />
          </div>
          {colorPicker.element}
        </div>

        <div className="settings-panel__section">
          <h3>Source</h3>
          {own ? (
            <>
              <label className="source-details__field">
                <span>Name</span>
                <input className="settings-panel__add-input" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              </label>
              <label className="source-details__field">
                <span>{own.kind === 'feed' ? 'Feed URLs (one per line) or GitHub repo URL' : own.kind === 'youtube' ? 'YouTube channel or playlist URL' : 'GitHub repo URL'}</span>
                <textarea className="settings-panel__add-input" rows={3} value={draft.url} onChange={(e) => set({ url: e.target.value })} />
              </label>
              {!isRepo && (
                <label className="source-details__field">
                  <span>Keywords to keep (regex, optional)</span>
                  <input className="settings-panel__add-input" value={draft.include} onChange={(e) => set({ include: e.target.value })} />
                </label>
              )}
              {isYoutubeChannelUrl(draft.url) && (
                <label className="source-details__check">
                  <input type="checkbox" checked={draft.shorts} onChange={(e) => set({ shorts: e.target.checked })} /> Include Shorts
                </label>
              )}
              {error && <p className="settings-panel__error">⚠ {error}</p>}
            </>
          ) : (
            <dl className="source-details__facts">
              <dt>Fetches</dt><dd className="source-details__location">{source.location ?? 'custom code in the app'}</dd>
              {source.filter && <><dt>Keeps</dt><dd>{source.filter}</dd></>}
              <dt /><dd className="settings-panel__hint">Built-in: its address is maintained with the app.</dd>
            </dl>
          )}
        </div>
        </>}

        <div className="source-details__actions">
          {!removed && (confirmRemove && items > 0 ? (
            <>
              <button type="button" className="btn" onClick={() => { onRemove(false); onClose(); }}>Remove, keep its {items} items</button>
              <button type="button" className="btn settings-panel__remove settings-panel__remove--confirm" onClick={() => { onRemove(true); onClose(); }}>
                Remove + delete its items
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`btn settings-panel__remove${confirmRemove ? ' settings-panel__remove--confirm' : ''}`}
              onClick={() => {
                if (!confirmRemove) { setConfirmRemove(true); setConfirmDelete(false); return; }
                onRemove(false);
                onClose();
              }}
            >
              {confirmRemove ? (source.builtin ? 'Remove? (can be restored)' : 'Remove for good?') : 'Remove'}
            </button>
          ))}
          {items > 0 && !confirmRemove && (
            <button
              type="button"
              className={`btn settings-panel__remove${confirmDelete ? ' settings-panel__remove--confirm' : ''}`}
              title={removed ? 'Removes it for good' : 'The next fetch adds them back as new'}
              onClick={() => {
                if (!confirmDelete) { setConfirmDelete(true); return; }
                setConfirmDelete(false);
                onDeleteItems();
                if (removed) onClose();
              }}
            >
              {confirmDelete ? `Delete ${items} items${saved ? ` (${saved} pending)` : ''}?` : `Delete its ${items} items`}
            </button>
          )}
          <span className="source-details__spacer" />
          {removed && source.builtin && <button type="button" className="btn" onClick={() => { onRestore(); onClose(); }}>Restore</button>}
          <button type="button" className="btn" onClick={onShowUpdates}>Show its updates</button>
          <button type="button" className="btn" onClick={onClose}>{removed ? 'Close' : 'Cancel'}</button>
          {!removed && <button type="submit" className="btn btn--primary">Save</button>}
        </div>
      </form>
    </div>
  );
}
