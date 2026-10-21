import React, { useState } from 'react';
import { newUserSource, retiredSources, type AppSettings, type SourceInfo, type PreviewPosition, type StatsResponse, type UserSourceSpec } from '@fomo/core';
import { SourceDetails } from './SourceDetails.js';

interface Props {
  settings: AppSettings;
  sources: SourceInfo[];
  stats?: StatsResponse;
  onToggleSource(sourceId: string): void;
  onSetPreviewPosition(pos: PreviewPosition): void;
  onSetSourceLabel(sourceId: string, label: string): void;
  onSetSourceColor(sourceId: string, color: string): void;
  onAddSource(spec: UserSourceSpec): void;
  /** Remove a source, keeping its stored updates unless `deleteItems`. */
  onRemoveSource(sourceId: string, deleteItems?: boolean): void;
  onRestoreSources(): void;
  /** Bring back one removed built-in. */
  onRestoreSource(sourceId: string): void;
  /** Delete every stored update of a source. */
  onDeleteSourceItems(sourceId: string): void;
  /** Save the changes made in a source's details. */
  onSaveSource(patch: Partial<AppSettings>): void;
  onShowSourceUpdates(sourceId: string): void;
  onClose(): void;
}

const PREVIEW_OPTIONS: PreviewPosition[] = ['right', 'bottom', 'off'];

export const COLOR_PALETTE = [
  '#58a6ff', // cyan (default)
  '#3fb950', // green
  '#e3b341', // yellow
  '#f85149', // red
  '#bc8cff', // purple
  '#f78166', // orange
  '#79c0ff', // light blue
  '#d2a8ff', // lavender
  '#ff7b72', // coral
  '#7ee787', // mint
  '#06b6d4', // teal
  '#f472b6', // pink
  '#fb923c', // amber
  '#a3e635', // lime
  '#34d399', // emerald
  '#e879f9', // fuchsia
  '#fbbf24', // gold
  '#818cf8', // indigo
  '#f87171', // rose
  '#94a3b8', // slate
];

/** Form that adds an RSS/Atom feed, a GitHub repository's releases or a YouTube channel. */
function AddSourceForm({ settings, onAdd }: { settings: AppSettings; onAdd(spec: UserSourceSpec): void }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [include, setInclude] = useState('');
  const [error, setError] = useState<string | undefined>();
  const guess = url.trim() ? newUserSource({ url }, settings) : undefined;
  const isRepo = guess && 'spec' in guess && guess.spec.kind === 'github-releases';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = newUserSource({ url, name, include: isRepo ? undefined : include }, settings);
    if ('error' in result) { setError(result.error); return; }
    onAdd(result.spec);
    setUrl(''); setName(''); setInclude(''); setError(undefined);
  };

  return (
    <form className="settings-panel__add" onSubmit={submit} onKeyDown={(e) => e.stopPropagation()}>
      <input
        className="settings-panel__add-input"
        value={url}
        onChange={(e) => { setUrl(e.target.value); setError(undefined); }}
        placeholder="Feed URL(s), github.com/owner/repo or a YouTube channel"
        aria-label="Feed URL, GitHub repository or YouTube channel"
      />
      <input
        className="settings-panel__add-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={guess && 'spec' in guess ? guess.spec.displayName : 'Name'}
        aria-label="Name"
      />
      {!isRepo && (
        <input
          className="settings-panel__add-input"
          value={include}
          onChange={(e) => { setInclude(e.target.value); setError(undefined); }}
          placeholder="Keywords to keep (regex, optional)"
          aria-label="Keyword filter"
        />
      )}
      <button className="btn" type="submit" disabled={!url.trim()}>+ Add source</button>
      {error && <p className="settings-panel__error">⚠ {error}</p>}
    </form>
  );
}

export function SettingsPanel({ settings, sources, stats, onToggleSource, onSetPreviewPosition, onSetSourceLabel, onSetSourceColor, onAddSource, onRemoveSource, onRestoreSources, onRestoreSource, onDeleteSourceItems, onSaveSource, onShowSourceUpdates, onClose }: Props) {
  const disabledSet = new Set(settings.disabledSources);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  /** Source waiting for a second click on its remove button. */
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removed = settings.removedSources?.length ?? 0;
  /** Source whose details popup is open. */
  const [detailsId, setDetailsId] = useState<string | null>(null);
  /** Removed sources whose updates are still stored, shown greyed out. */
  const retired = retiredSources(settings, stats?.bySource);
  const details = sources.find((s) => s.id === detailsId) ?? retired.find((s) => s.id === detailsId);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel__header">
          <h2>⚙️ Config</h2>
          <button className="btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-panel__section">
          <h3>Sources</h3>
          <p className="settings-panel__hint">Click a source for its details and to edit it; the dot turns it on or off. New sources are fetched by the terminal app.</p>
          <div className="settings-panel__items">
            {sources.map((s) => {
              const enabled = !disabledSet.has(s.id);
              const customLabel = settings.sourceLabels[s.id];
              const sourceColor = settings.sourceColors?.[s.id] || COLOR_PALETTE[0];
              const isEditing = editingId === s.id;
              const isPickingColor = colorPickerId === s.id;

              return (
                <div key={s.id} className="settings-panel__toggle">
                  <span
                    className="settings-panel__toggle-check"
                    onClick={() => onToggleSource(s.id)}
                  >
                    <span className={`settings-panel__dot ${enabled ? 'settings-panel__dot--on' : 'settings-panel__dot--off'}`}>
                      {enabled ? '●' : '○'}
                    </span>
                  </span>
                  <span className="settings-panel__toggle-label" onClick={() => setDetailsId(s.id)} title="Details">
                    {s.displayName}
                    <span className="settings-panel__toggle-id" title={s.location}>{s.builtin ? s.id : `${s.id} · yours`}</span>
                  </span>
                  <span className="settings-panel__color-area">
                    <button
                      className="settings-panel__color-btn"
                      style={{ backgroundColor: sourceColor }}
                      onClick={() => setColorPickerId(isPickingColor ? null : s.id)}
                      title="Pick color"
                    />
                    {isPickingColor && (
                      <div className="settings-panel__color-picker">
                        {COLOR_PALETTE.map((c) => (
                          <button
                            key={c}
                            className={`settings-panel__color-swatch${c === sourceColor ? ' settings-panel__color-swatch--active' : ''}`}
                            style={{ backgroundColor: c }}
                            onClick={() => {
                              onSetSourceColor(s.id, c);
                              setColorPickerId(null);
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </span>
                  <span className="settings-panel__label-area">
                    {isEditing ? (
                      <input
                        className="settings-panel__label-input"
                        value={editBuffer}
                        onChange={(e) => setEditBuffer(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onSetSourceLabel(s.id, editBuffer);
                            setEditingId(null);
                          }
                          if (e.key === 'Escape') {
                            setEditingId(null);
                          }
                          e.stopPropagation();
                        }}
                        onBlur={() => {
                          onSetSourceLabel(s.id, editBuffer);
                          setEditingId(null);
                        }}
                        placeholder="emoji / label"
                        autoFocus
                      />
                    ) : (
                      <button
                        className="settings-panel__label-btn"
                        onClick={() => {
                          setEditBuffer(customLabel ?? '');
                          setEditingId(s.id);
                        }}
                      >
                        {customLabel || '✏️ label'}
                      </button>
                    )}
                  </span>
                  <button
                    className={`settings-panel__remove${removingId === s.id ? ' settings-panel__remove--confirm' : ''}`}
                    onClick={() => {
                      if (removingId !== s.id) { setRemovingId(s.id); return; }
                      setRemovingId(null);
                      onRemoveSource(s.id);
                    }}
                    onBlur={() => setRemovingId((id) => (id === s.id ? null : id))}
                    title={(stats?.bySource[s.id] ?? 0) > 0 ? 'Remove (keeps its items; open it to delete them too)' : s.builtin ? 'Remove (can be restored)' : 'Remove'}
                  >
                    {removingId === s.id ? 'Remove?' : '✕'}
                  </button>
                </div>
              );
            })}
            {retired.map((s) => (
              <div key={s.id} className="settings-panel__toggle settings-panel__toggle--removed">
                <span className="settings-panel__toggle-check"><span className="settings-panel__dot">○</span></span>
                <span className="settings-panel__toggle-label" onClick={() => setDetailsId(s.id)} title="Details">
                  {s.displayName}
                  <span className="settings-panel__toggle-id">removed · {stats?.bySource[s.id] ?? 0} items still stored</span>
                </span>
              </div>
            ))}
          </div>
          {removed > 0 && (
            <button className="btn settings-panel__restore" onClick={onRestoreSources}>
              ↺ Restore {removed} removed source{removed === 1 ? '' : 's'}
            </button>
          )}
          <AddSourceForm settings={settings} onAdd={onAddSource} />
        </div>

        {details && (
          <SourceDetails
            key={details.id}
            source={details}
            settings={settings}
            stats={stats}
            onSave={onSaveSource}
            onRemove={(deleteItems) => onRemoveSource(details.id, deleteItems)}
            onDeleteItems={() => onDeleteSourceItems(details.id)}
            onRestore={() => onRestoreSource(details.id)}
            onShowUpdates={() => onShowSourceUpdates(details.id)}
            onClose={() => setDetailsId(null)}
          />
        )}

        <div className="settings-panel__section">
          <h3>Preview Position</h3>
          <div className="settings-panel__options">
            {PREVIEW_OPTIONS.map((pos) => (
              <button
                key={pos}
                className={`filter-pill ${settings.previewPosition === pos ? 'filter-pill--active' : ''}`}
                onClick={() => onSetPreviewPosition(pos)}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
