import React, { useState } from 'react';
import type { AppSettings, SourceInfo, PreviewPosition } from '@fomo/core';

interface Props {
  settings: AppSettings;
  sources: SourceInfo[];
  onToggleSource(sourceId: string): void;
  onSetPreviewPosition(pos: PreviewPosition): void;
  onSetSourceLabel(sourceId: string, label: string): void;
  onSetSourceColor(sourceId: string, color: string): void;
  onClose(): void;
}

const PREVIEW_OPTIONS: PreviewPosition[] = ['right', 'bottom', 'off'];

const COLOR_PALETTE = [
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
];

export function SettingsPanel({ settings, sources, onToggleSource, onSetPreviewPosition, onSetSourceLabel, onSetSourceColor, onClose }: Props) {
  const disabledSet = new Set(settings.disabledSources);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel__header">
          <h2>⚙️ Config</h2>
          <button className="btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-panel__section">
          <h3>Sources</h3>
          <p className="settings-panel__hint">Toggle sources and set custom labels (emoji/shortcut).</p>
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
                  <span className="settings-panel__toggle-label" onClick={() => onToggleSource(s.id)}>
                    {s.displayName}
                    <span className="settings-panel__toggle-id">{s.id}</span>
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
