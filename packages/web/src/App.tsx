import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FomoClient } from '@fomo/core';
import type { Update, Status, PreviewPosition, SourceInfo } from '@fomo/core';
import { checkAuth, logout, type UserInfo } from './store/auth.js';
import { useFomo } from './hooks/useFomo.js';
import { StatusBar } from './components/StatusBar.js';
import { UpdatesTable } from './components/UpdatesTable.js';
import { DetailPane } from './components/DetailPane.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { HelpOverlay } from './components/HelpOverlay.js';

type FilterStatus = Status | 'all' | 'saved';

const FILTERS: { label: string; value: FilterStatus }[] = [
  { label: '1 All', value: 'all' },
  { label: '2 Unread', value: 'unread' },
  { label: '3 Read', value: 'read' },
  { label: '4 Saved', value: 'saved' },
];

// Same-origin client — auth handled by session cookie
const client = new FomoClient({ baseUrl: '' });

export function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const fomo = useFomo(client);
  const [selected, setSelected] = useState<Update | undefined>();
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [helpContext, setHelpContext] = useState<'list' | 'detail' | 'settings'>('list');
  const [sources, setSources] = useState<SourceInfo[]>([]);

  // Preview position from remote settings
  const previewPosition = fomo.settings.previewPosition;

  // Swipe-back gesture tracking
  const swipeBackRef = useRef({ startX: 0, startY: 0 });

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

  // Swipe-back: right swipe from left edge to go back
  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      const x = e.touches[0].clientX;
      if (x < 30) {
        swipeBackRef.current = { startX: x, startY: e.touches[0].clientY };
      } else {
        swipeBackRef.current = { startX: -1, startY: 0 };
      }
    }
    function onTouchEnd(e: TouchEvent) {
      if (swipeBackRef.current.startX < 0) return;
      const dx = e.changedTouches[0].clientX - swipeBackRef.current.startX;
      const dy = e.changedTouches[0].clientY - swipeBackRef.current.startY;
      if (dx > 80 && Math.abs(dx) > Math.abs(dy) * 2) {
        if (showHelp) { setShowHelp(false); return; }
        if (showSettings) { setShowSettings(false); return; }
        if (selected) { setSelected(undefined); return; }
      }
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [showHelp, showSettings, selected]);

  // Keyboard shortcuts (aligned with CLI TUI)
  useEffect(() => {
    if (!authChecked) return;

    const filterKeys: Record<string, FilterStatus> = {
      '1': 'all', '2': 'unread', '3': 'read', '4': 'saved',
    };

    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      // Help overlay: Escape or h to close
      if (showHelp) {
        if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'h') {
          setShowHelp(false);
        }
        return;
      }

      // Settings panel: Escape or c to close, h for help
      if (showSettings) {
        if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'c') {
          setShowSettings(false);
        }
        if (e.key === 'h') {
          setHelpContext('settings');
          setShowHelp(true);
        }
        return; // Consume all keys while settings is open
      }

      if (selected && (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'q')) {
        setSelected(undefined);
        return;
      }

      if (e.key === 'h') {
        setHelpContext(selected ? 'detail' : 'list');
        setShowHelp(true);
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

      if (e.key === 'n') {
        handleNextUnread();
        return;
      }

      if (!selected) return;

      if (e.key === 'x') {
        handleReadAndNext();
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
  }, [fomo, selected, authChecked, showSettings, showHelp, previewPosition]);

  // ── Callbacks ──

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

  const handleSwipeAction = useCallback(
    (id: string, action: 'read' | 'unread' | 'save') => {
      if (action === 'save') {
        const u = fomo.updates.find((x) => x.id === id);
        if (u) void fomo.setSaved(id, !u.saved);
      } else {
        void fomo.setStatus(id, action);
      }
    },
    [fomo],
  );

  const handleRefresh = useCallback(() => {
    void fomo.triggerFetch();
  }, [fomo]);

  const findNextUnread = useCallback(
    (fromId?: string) => {
      const idx = fromId ? fomo.updates.findIndex((u) => u.id === fromId) : -1;
      for (let i = idx + 1; i < fomo.updates.length; i++) {
        if (fomo.updates[i].status === 'unread') return fomo.updates[i];
      }
      for (let i = 0; i < (idx === -1 ? fomo.updates.length : idx); i++) {
        if (fomo.updates[i].status === 'unread') return fomo.updates[i];
      }
      return undefined;
    },
    [fomo.updates],
  );

  const handleReadAndNext = useCallback(() => {
    if (!selected) return;
    const next = findNextUnread(selected.id);
    void fomo.setStatus(selected.id, 'read');
    if (next) {
      setSelected(next);
    } else {
      setSelected(undefined);
    }
  }, [selected, fomo, findNextUnread]);

  const handleNextUnread = useCallback(() => {
    const next = findNextUnread(selected?.id);
    if (next) setSelected(next);
  }, [selected, findNextUnread]);

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

  const handleSetSourceColor = useCallback(
    (sourceId: string, color: string) => {
      const newColors = { ...fomo.settings.sourceColors };
      newColors[sourceId] = color;
      void fomo.updateSettings({ sourceColors: newColors });
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

  return (
    <div className="app">
      <StatusBar
        stats={fomo.stats}
        loading={fomo.loading}
        message={fomo.message}
        userEmail={user?.email}
        onLogout={logout}
        onHelpClick={() => {
          setHelpContext(selected ? 'detail' : 'list');
          setShowHelp(true);
        }}
        onSettingsClick={() => setShowSettings(true)}
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
      </div>

      {/* Main area */}
      <div className={`main main--preview-${isDetailOpen ? (previewPosition === 'off' ? 'none' : previewPosition) : 'none'}`}>
        <UpdatesTable
          updates={fomo.updates}
          selectedId={selected?.id}
          onSelect={setSelected}
          sourceLabels={fomo.settings.sourceLabels}
          sourceColors={fomo.settings.sourceColors}
          onSwipeAction={handleSwipeAction}
          onRefresh={handleRefresh}
        />
        {selected && previewPosition !== 'off' && (
          <DetailPane
            update={selected}
            onSetStatus={handleSetStatus}
            onToggleSaved={handleToggleSaved}
            onFetchContent={handleFetchContent}
            onReadAndNext={handleReadAndNext}
            onNextUnread={handleNextUnread}
            onOpen={() => selected.url && window.open(selected.url, '_blank', 'noopener,noreferrer')}
            onClose={() => setSelected(undefined)}
          />
        )}
      </div>

      {/* Mobile floating action bar */}
      {selected && (
        <div className="mobile-actions">
          <button className="mobile-actions__btn" onClick={() => setSelected(undefined)}>
            <span>←</span><span>Back</span>
          </button>
          <button
            className="mobile-actions__btn"
            onClick={() => handleSetStatus(selected.id, selected.status === 'unread' ? 'read' : 'unread')}
          >
            <span>{selected.status === 'unread' ? '✓' : '●'}</span>
            <span>{selected.status === 'unread' ? 'Read' : 'Unread'}</span>
          </button>
          <button
            className="mobile-actions__btn"
            onClick={() => handleToggleSaved(selected.id, !selected.saved)}
          >
            <span>{selected.saved ? '★' : '☆'}</span>
            <span>{selected.saved ? 'Unsave' : 'Save'}</span>
          </button>
        </div>
      )}

      {/* Help overlay */}
      {showHelp && (
        <HelpOverlay
          context={isDetailOpen ? 'detail' : 'list'}
          onClose={() => setShowHelp(false)}
        />
      )}

      {/* Settings overlay */}
      {showSettings && (
        <SettingsPanel
          settings={fomo.settings}
          sources={sources}
          onToggleSource={handleToggleSource}
          onSetPreviewPosition={handleSetPreviewPosition}
          onSetSourceLabel={handleSetSourceLabel}
          onSetSourceColor={handleSetSourceColor}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
