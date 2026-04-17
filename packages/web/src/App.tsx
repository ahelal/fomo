import React, { useState, useEffect, useCallback } from 'react';
import { FomoClient } from '@fomo/core';
import type { Update, Status, PreviewPosition, SourceInfo } from '@fomo/core';
import { checkAuth, logout, type UserInfo } from './store/auth.js';
import { useFomo } from './hooks/useFomo.js';
import { StatusBar } from './components/StatusBar.js';
import { UpdatesTable } from './components/UpdatesTable.js';
import { DetailPane } from './components/DetailPane.js';
import { SettingsPanel } from './components/SettingsPanel.js';

type FilterStatus = Status | 'all' | 'saved';

const FILTERS: { label: string; value: FilterStatus }[] = [
  { label: '1 All', value: 'all' },
  { label: '2 Unread', value: 'unread' },
  { label: '3 Read', value: 'read' },
  { label: '4 Saved', value: 'saved' },
];

const LIST_KEYS: [string, string][] = [
  ['↵', 'detail'],
  ['r', 'read'],
  ['u', 'unread'],
  ['s', 'save/unsave'],
  ['x', 'read & next'],
  ['o', 'open'],
  ['c', 'settings'],
];

const DETAIL_KEYS: [string, string][] = [
  ['Esc', 'back'],
  ['r', 'read'],
  ['u', 'unread'],
  ['s', 'save/unsave'],
  ['x', 'read & next'],
  ['o', 'open url'],
  ['p', 'fetch content'],
  ['c', 'settings'],
];

// Same-origin client — auth handled by session cookie
const client = new FomoClient({ baseUrl: '' });

export function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const fomo = useFomo(client);
  const [selected, setSelected] = useState<Update | undefined>();
  const [showSettings, setShowSettings] = useState(false);
  const [sources, setSources] = useState<SourceInfo[]>([]);

  // Preview position from remote settings
  const previewPosition = fomo.settings.previewPosition;

  // Check session on mount
  useEffect(() => {
    checkAuth().then((u) => {
      if (!u) {
        window.location.href = '/auth/login';
        return;
      }
      setUser(u);
      setAuthChecked(true);
    });
  }, []);

  // Load sources
  useEffect(() => {
    if (!authChecked) return;
    client.getSources().then(setSources).catch(() => { /* ignore */ });
  }, [authChecked]);

  // Keyboard shortcuts (aligned with CLI TUI)
  useEffect(() => {
    if (!authChecked) return;

    const filterKeys: Record<string, FilterStatus> = {
      '1': 'all', '2': 'unread', '3': 'read', '4': 'saved',
    };

    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      // Settings panel: Escape or c to close
      if (showSettings) {
        if (e.key === 'Escape' || e.key === 'c') {
          setShowSettings(false);
        }
        return; // Consume all keys while settings is open
      }

      if (selected && (e.key === 'Escape' || e.key === 'q')) {
        setSelected(undefined);
        return;
      }

      if (e.key === 'c') {
        setShowSettings(true);
        return;
      }

      if (e.key in filterKeys) {
        fomo.setFilter(filterKeys[e.key]!);
        return;
      }

      if (e.key === 'f') {
        void fomo.triggerFetch();
        return;
      }

      if (e.key === '.') {
        const next: PreviewPosition = previewPosition === 'right' ? 'bottom' : 'right';
        void fomo.updateSettings({ previewPosition: next });
        return;
      }

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (fomo.updates.length === 0) return;
        const idx = selected ? fomo.updates.findIndex((u) => u.id === selected.id) : -1;
        const next = Math.min(idx + 1, fomo.updates.length - 1);
        setSelected(fomo.updates[next]);
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (fomo.updates.length === 0) return;
        const idx = selected ? fomo.updates.findIndex((u) => u.id === selected.id) : fomo.updates.length;
        const prev = Math.max(idx - 1, 0);
        setSelected(fomo.updates[prev]);
        return;
      }

      if (e.key === 'Enter') {
        if (selected) {
          setSelected(undefined);
        } else if (fomo.updates.length > 0) {
          setSelected(fomo.updates[0]);
        }
        return;
      }

      if (!selected) return;

      if (e.key === 'x') {
        const idx = fomo.updates.findIndex((u) => u.id === selected.id);
        let nextUnread: Update | undefined;
        for (let i = idx + 1; i < fomo.updates.length; i++) {
          if (fomo.updates[i].status === 'unread') { nextUnread = fomo.updates[i]; break; }
        }
        if (!nextUnread) {
          for (let i = 0; i < idx; i++) {
            if (fomo.updates[i].status === 'unread') { nextUnread = fomo.updates[i]; break; }
          }
        }
        if (nextUnread) setSelected(nextUnread);
        void fomo.setStatus(selected.id, 'read');
        return;
      }

      if (e.key === 'r') { void fomo.setStatus(selected.id, 'read');   return; }
      if (e.key === 'u') { void fomo.setStatus(selected.id, 'unread'); return; }
      if (e.key === 's') { void fomo.setSaved(selected.id, !selected.saved); return; }

      if (e.key === 'o' && selected.url) {
        window.open(selected.url, '_blank', 'noopener,noreferrer');
        return;
      }

      if (e.key === 'p') {
        void fomo.fetchContent(selected.id).then((updated) => {
          if (updated) setSelected(updated);
        });
        return;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fomo, selected, authChecked, showSettings, previewPosition]);

  const handleSetStatus = useCallback(
    (id: string, status: Status) => {
      void fomo.setStatus(id, status).then(() => {
        setSelected((prev) => (prev?.id === id ? { ...prev, status } : prev));
      });
    },
    [fomo],
  );

  const handleToggleSaved = useCallback(
    (id: string, saved: boolean) => {
      void fomo.setSaved(id, saved).then(() => {
        setSelected((prev) => (prev?.id === id ? { ...prev, saved } : prev));
      });
    },
    [fomo],
  );

  const handleFetchContent = useCallback(
    (id: string) => {
      void fomo.fetchContent(id).then((updated) => {
        if (updated) setSelected(updated);
      });
    },
    [fomo],
  );

  const handleToggleSource = useCallback(
    (sourceId: string) => {
      const disabled = new Set(fomo.settings.disabledSources);
      if (disabled.has(sourceId)) {
        disabled.delete(sourceId);
      } else {
        disabled.add(sourceId);
      }
      void fomo.updateSettings({ disabledSources: [...disabled] });
    },
    [fomo],
  );

  const handleSetPreviewPosition = useCallback(
    (pos: PreviewPosition) => {
      void fomo.updateSettings({ previewPosition: pos });
    },
    [fomo],
  );

  const handleSetSourceLabel = useCallback(
    (sourceId: string, label: string) => {
      const newLabels = { ...fomo.settings.sourceLabels };
      if (label && label !== sourceId) {
        newLabels[sourceId] = label;
      } else {
        delete newLabels[sourceId];
      }
      void fomo.updateSettings({ sourceLabels: newLabels });
    },
    [fomo],
  );

  if (!authChecked) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-dim)' }}>Authenticating…</p>
      </div>
    );
  }

  const isDetailOpen = !!selected;
  const helpKeys = isDetailOpen ? DETAIL_KEYS : LIST_KEYS;

  return (
    <div className="app">
      <StatusBar
        stats={fomo.stats}
        loading={fomo.loading}
        message={fomo.message}
        filter={fomo.filter}
        userEmail={user?.email}
        onLogout={logout}
        onFetchClick={() => void fomo.triggerFetch()}
      />

      {/* Filter pills */}
      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={['filter-pill', fomo.filter === f.value ? 'filter-pill--active' : ''].join(' ')}
            onClick={() => fomo.setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
        <button
          className="btn"
          style={{ marginLeft: 'auto', fontSize: 11 }}
          onClick={() => setShowSettings(true)}
        >
          ⚙️ Settings
        </button>
      </div>

      {/* Main area */}
      <div className={`main main--preview-${isDetailOpen ? (previewPosition === 'off' ? 'none' : previewPosition) : 'none'}`}>
        <UpdatesTable
          updates={fomo.updates}
          selectedId={selected?.id}
          onSelect={setSelected}
          sourceLabels={fomo.settings.sourceLabels}
        />
        {selected && previewPosition !== 'off' && (
          <DetailPane
            update={selected}
            onSetStatus={handleSetStatus}
            onToggleSaved={handleToggleSaved}
            onFetchContent={handleFetchContent}
          />
        )}
      </div>

      {/* Keyboard hint bar */}
      <div className="keyhelp">
        {helpKeys.map(([key, label], i) => (
          <React.Fragment key={key}>
            {i > 0 && <span className="keyhelp__sep">·</span>}
            <span><kbd>{key}</kbd> {label}</span>
          </React.Fragment>
        ))}
      </div>

      {/* Settings overlay */}
      {showSettings && (
        <SettingsPanel
          settings={fomo.settings}
          sources={sources}
          onToggleSource={handleToggleSource}
          onSetPreviewPosition={handleSetPreviewPosition}
          onSetSourceLabel={handleSetSourceLabel}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
