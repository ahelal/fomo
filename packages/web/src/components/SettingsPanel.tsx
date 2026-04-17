import React, { useState } from 'react';
import type { AppSettings, SourceInfo, PreviewPosition } from '@fomo/core';

interface Props {
  settings: AppSettings;
  sources: SourceInfo[];
  onToggleSource(sourceId: string): void;
  onSetPreviewPosition(pos: PreviewPosition): void;
  onSetSourceLabel(sourceId: string, label: string): void;
  onClose(): void;
}

const PREVIEW_OPTIONS: PreviewPosition[] = ['right', 'bottom', 'off'];

export function SettingsPanel({ settings, sources, onToggleSource, onSetPreviewPosition, onSetSourceLabel, onClose }: Props) {
  const disabledSet = new Set(settings.disabledSources);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel__header">
          <h2>⚙️ Settings</h2>
          <button className="btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-panel__section">
          <h3>Sources</h3>
          <p className="settings-panel__hint">Toggle sources and set custom labels (emoji/shortcut).</p>
          <div className="settings-panel__items">
            {sources.map((s) => {
              const enabled = !disabledSet.has(s.id);
              const customLabel = settings.sourceLabels[s.id];
              const isEditing = editingId === s.id;

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
                  <span className="settings-panel__toggle-label" onClick={() => onToggleSource(s.id)}>
                    {s.displayName}
                    <span className="settings-panel__toggle-id">{s.id}</span>
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
                </div>
              );
            })}
          </div>
        </div>

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
