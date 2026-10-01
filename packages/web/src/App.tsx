import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FomoStorageService,
  flattenDigest,
  removeAndAdvance,
  soloUpdate,
  type Update,
  type Status,
  type PreviewPosition,
  type SourceInfo,
  type SasConnection,
  type DigestRow,
} from '@fomo/core';
import {
  consumeConnectLink,
  loadConnection,
  saveConnection,
  clearConnection,
  daysUntilExpiry,
} from './store/connection.js';
import { useFomo, type FilterStatus } from './hooks/useFomo.js';
import { StatusBar } from './components/StatusBar.js';
import { UpdatesTable } from './components/UpdatesTable.js';
import { DigestList } from './components/DigestList.js';
import { DetailPane } from './components/DetailPane.js';
import { TopicPane } from './components/TopicPane.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { HelpOverlay, type HelpContext } from './components/HelpOverlay.js';
import { TodosPane } from './components/TodosPane.js';
import { ConnectScreen } from './components/ConnectScreen.js';

const FILTERS: { label: string; value: FilterStatus }[] = [
  { label: '0 Digest', value: 'digest' },
  { label: '1 All', value: 'all' },
  { label: '2 Unread', value: 'unread' },
  { label: '3 Read', value: 'read' },
  { label: '4 Saved', value: 'saved' },
  { label: '5 Todos', value: 'todos' },
];

const FILTER_KEYS: Record<string, FilterStatus> = {
  '0': 'digest', '1': 'all', '2': 'unread', '3': 'read', '4': 'saved', '5': 'todos', t: 'todos',
};

/** The update a digest row points at (items and single-update topics), if any. */
function rowUpdate(row: DigestRow | undefined): Update | undefined {
  if (!row) return undefined;
  if (row.kind === 'item') return row.update;
  return soloUpdate(row.entry);
}

function openUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function App() {
  const [conn, setConn] = useState<SasConnection | undefined>(() => consumeConnectLink() ?? loadConnection());
  const [error, setError] = useState<string | undefined>();

  // A magic link opened while the app is already running
  useEffect(() => {
    function onHashChange() {
      const next = consumeConnectLink();
      if (next) setConn(next);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const expiresInDays = conn ? daysUntilExpiry(conn) : undefined;
  const expired = expiresInDays !== undefined && expiresInDays < 0;

  if (!conn || expired) {
    return (
      <ConnectScreen
        error={expired ? 'Your access link has expired. Create a new one in fomo on your computer: press c → Link a device.' : error}
        onConnect={(c) => {
          saveConnection(c);
          setError(undefined);
          setConn(c);
        }}
      />
    );
  }

  return (
    <FomoApp
      key={`${conn.tableEndpoint}?${conn.sas}`}
      conn={conn}
      expiresInDays={expiresInDays}
      onDisconnect={() => {
        clearConnection();
        setConn(undefined);
      }}
    />
  );
}

interface FomoAppProps {
  conn: SasConnection;
  expiresInDays?: number;
  onDisconnect(): void;
}

function FomoApp({ conn, expiresInDays, onDisconnect }: FomoAppProps) {
  const service = useMemo(() => new FomoStorageService(conn), [conn]);
  const fomo = useFomo(service);

  const [selected, setSelected] = useState<Update | undefined>();
  const [digestKey, setDigestKey] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [helpContext, setHelpContext] = useState<HelpContext>('list');
  const [sources, setSources] = useState<SourceInfo[]>([]);

  const previewPosition = fomo.settings.previewPosition;
  const isDigest = fomo.filter === 'digest';

  const digestRows = useMemo(() => flattenDigest(fomo.digest, expanded), [fomo.digest, expanded]);
  const digestRow = digestKey ? digestRows.find((r) => r.key === digestKey) : undefined;
  const digestTopic = digestRow?.kind === 'topic' && digestRow.entry.items.length > 1 ? digestRow.entry : undefined;
  const detailUpdate = isDigest ? rowUpdate(digestRow) : fomo.filter === 'todos' ? undefined : selected;
  const hasSelection = isDigest ? !!digestRow : !!selected;

  const swipeBackRef = useRef({ startX: 0, startY: 0 });

  useEffect(() => {
    service.getSources().then(setSources).catch(() => { /* ignore */ });
  }, [service]);

  // Lists are loaded without content; fetch the body of the update being viewed.
  useEffect(() => {
    if (detailUpdate && !detailUpdate.content && !(detailUpdate.id in fomo.content)) {
      void fomo.loadContent(detailUpdate.id);
    }
  }, [detailUpdate, fomo]);

  const withContent = useCallback(
    (u: Update): Update => (u.content ? u : { ...u, content: fomo.content[u.id] ?? '' }),
    [fomo.content],
  );

  const clearSelection = useCallback(() => {
    setSelected(undefined);
    setDigestKey(undefined);
  }, []);

  const setFilter = useCallback((f: FilterStatus) => {
    clearSelection();
    fomo.setFilter(f);
  }, [fomo, clearSelection]);

  // ── Digest actions ──

  const setTopicExpanded = useCallback((topicId: string, open: boolean) => {
    setExpanded((prev) => {
      if (prev.has(topicId) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(topicId);
      else next.delete(topicId);
      return next;
    });
  }, []);

  /** Mark a digest row read (a topic marks all its updates) and advance the selection if it was selected. */
  const digestMarkRead = useCallback((row: DigestRow) => {
    const ids = row.kind === 'item' ? [row.update.id] : row.entry.items.map((u) => u.id);
    const next = removeAndAdvance(fomo.digest, expanded, row.key, new Set(ids));
    if (digestKey === row.key || (row.kind === 'topic' && digestKey?.startsWith(`${row.key}/`))) {
      setDigestKey(next.nextKey);
    }
    void fomo.markRead(ids);
  }, [fomo, expanded, digestKey]);

  const digestNextTopic = useCallback(() => {
    const idx = digestKey ? digestRows.findIndex((r) => r.key === digestKey) : -1;
    const next = digestRows.find((r, i) => i > idx && r.kind === 'topic') ?? digestRows.find((r) => r.kind === 'topic');
    if (next) setDigestKey(next.key);
  }, [digestRows, digestKey]);

  const openTopicItem = useCallback((topicId: string, update: Update) => {
    setTopicExpanded(topicId, true);
    setDigestKey(`${topicId}/${update.id}`);
  }, [setTopicExpanded]);

  /** Mobile back: from an update inside a topic return to the topic, otherwise close. */
  const goBack = useCallback(() => {
    if (isDigest && digestRow?.kind === 'item') {
      setDigestKey(digestRow.entry.topic.id);
      return;
    }
    clearSelection();
  }, [isDigest, digestRow, clearSelection]);

  // ── List actions ──

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
    void fomo.refresh();
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
    setSelected(next);
  }, [selected, fomo, findNextUnread]);

  const handleNextUnread = useCallback(() => {
    const next = findNextUnread(selected?.id);
    if (next) setSelected(next);
  }, [selected, findNextUnread]);

  // ── Swipe-back: right swipe from the left edge ──
  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      const x = e.touches[0].clientX;
      swipeBackRef.current = x < 30 ? { startX: x, startY: e.touches[0].clientY } : { startX: -1, startY: 0 };
    }
    function onTouchEnd(e: TouchEvent) {
      if (swipeBackRef.current.startX < 0) return;
      const dx = e.changedTouches[0].clientX - swipeBackRef.current.startX;
      const dy = e.changedTouches[0].clientY - swipeBackRef.current.startY;
      if (dx > 80 && Math.abs(dx) > Math.abs(dy) * 2) {
        if (showHelp) { setShowHelp(false); return; }
        if (showSettings) { setShowSettings(false); return; }
        if (hasSelection) goBack();
      }
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [showHelp, showSettings, hasSelection, goBack]);

  // ── Keyboard shortcuts (aligned with the TUI) ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (showHelp) {
        if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'h') setShowHelp(false);
        return;
      }

      if (showSettings) {
        if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'c') setShowSettings(false);
        if (e.key === 'h') {
          setHelpContext('settings');
          setShowHelp(true);
        }
        return;
      }

      if (hasSelection && (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'q')) {
        clearSelection();
        return;
      }

      if (e.key === 'h') {
        setHelpContext(isDigest ? 'digest' : selected ? 'detail' : 'list');
        setShowHelp(true);
        return;
      }
      if (e.key === 'c') { setShowSettings(true); return; }
      if (e.key in FILTER_KEYS) { setFilter(FILTER_KEYS[e.key]!); return; }
      if (e.key === '.') {
        const next: PreviewPosition = previewPosition === 'right' ? 'bottom' : 'right';
        void fomo.updateSettings({ previewPosition: next });
        return;
      }

      if (fomo.filter === 'todos') return;

      if (isDigest) {
        const idx = digestKey ? digestRows.findIndex((r) => r.key === digestKey) : -1;
        const row = idx >= 0 ? digestRows[idx] : undefined;
        if (e.key === 'j' || e.key === 'ArrowDown') {
          e.preventDefault();
          const next = digestRows[Math.min(idx + 1, digestRows.length - 1)];
          if (next) setDigestKey(next.key);
          return;
        }
        if (e.key === 'k' || e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = digestRows[idx === -1 ? digestRows.length - 1 : Math.max(idx - 1, 0)];
          if (prev) setDigestKey(prev.key);
          return;
        }
        if (e.key === 'n') { digestNextTopic(); return; }
        if (e.key === 'Enter') {
          if (!row) { if (digestRows[0]) setDigestKey(digestRows[0].key); return; }
          if (row.kind === 'topic' && row.entry.items.length > 1) setTopicExpanded(row.entry.topic.id, !expanded.has(row.entry.topic.id));
          else clearSelection();
          return;
        }
        if (!row) return;
        if (e.key === 'ArrowRight' || e.key === 'l') {
          if (row.kind === 'topic' && row.entry.items.length > 1) setTopicExpanded(row.entry.topic.id, true);
          return;
        }
        if (e.key === 'ArrowLeft') {
          if (row.kind === 'item') setDigestKey(row.entry.topic.id);
          if (row.entry.items.length > 1) setTopicExpanded(row.entry.topic.id, false);
          return;
        }
        if (e.key === 'x' || e.key === 'r') { digestMarkRead(row); return; }
        const update = rowUpdate(row);
        if (e.key === 's' && update) { void fomo.setSaved(update.id, !update.saved); return; }
        if (e.key === 'o') {
          const target = update ?? row.entry.items[0];
          if (target) openUrl(target.url);
          return;
        }
        return;
      }

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (fomo.updates.length === 0) return;
        const idx = selected ? fomo.updates.findIndex((u) => u.id === selected.id) : -1;
        setSelected(fomo.updates[Math.min(idx + 1, fomo.updates.length - 1)]);
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (fomo.updates.length === 0) return;
        const idx = selected ? fomo.updates.findIndex((u) => u.id === selected.id) : fomo.updates.length;
        setSelected(fomo.updates[Math.max(idx - 1, 0)]);
        return;
      }
      if (e.key === 'Enter') {
        if (selected) setSelected(undefined);
        else if (fomo.updates.length > 0) setSelected(fomo.updates[0]);
        return;
      }
      if (e.key === 'n') { handleNextUnread(); return; }

      if (!selected) return;
      if (e.key === 'x') { handleReadAndNext(); return; }
      if (e.key === 'r') { handleSetStatus(selected.id, 'read'); return; }
      if (e.key === 'u') { handleSetStatus(selected.id, 'unread'); return; }
      if (e.key === 's') { handleToggleSaved(selected.id, !selected.saved); return; }
      if (e.key === 'o' && selected.url) { openUrl(selected.url); return; }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    fomo, selected, isDigest, digestKey, digestRows, expanded, hasSelection, showSettings, showHelp, previewPosition,
    setFilter, clearSelection, setTopicExpanded, digestMarkRead, digestNextTopic, handleNextUnread, handleReadAndNext,
    handleSetStatus, handleToggleSaved,
  ]);

  // ── Settings callbacks ──

  const handleToggleSource = useCallback(
    (sourceId: string) => {
      const disabled = new Set(fomo.settings.disabledSources);
      if (disabled.has(sourceId)) disabled.delete(sourceId);
      else disabled.add(sourceId);
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
      if (label && label !== sourceId) newLabels[sourceId] = label;
      else delete newLabels[sourceId];
      void fomo.updateSettings({ sourceLabels: newLabels });
    },
    [fomo],
  );

  const handleSetSourceColor = useCallback(
    (sourceId: string, color: string) => {
      void fomo.updateSettings({ sourceColors: { ...fomo.settings.sourceColors, [sourceId]: color } });
    },
    [fomo],
  );

  // ── Render ──

  const showPreview = hasSelection && fomo.filter !== 'todos' && previewPosition !== 'off';
  const mainClass = `main main--preview-${showPreview ? previewPosition : 'none'}`;

  function renderDetail() {
    if (!showPreview) return null;
    if (isDigest && digestRow) {
      if (digestTopic) {
        return (
          <TopicPane
            entry={digestTopic}
            sourceLabels={fomo.settings.sourceLabels}
            onOpenItem={(u) => openTopicItem(digestTopic.topic.id, u)}
            onMarkRead={() => digestMarkRead(digestRow)}
            onClose={clearSelection}
          />
        );
      }
      const update = rowUpdate(digestRow);
      if (!update) return null;
      return (
        <DetailPane
          update={withContent(update)}
          contentLoading={!update.content && !(update.id in fomo.content)}
          onSetStatus={(id, status) => (status === 'read' ? digestMarkRead(digestRow) : void fomo.setStatus(id, status))}
          onToggleSaved={(id, saved) => void fomo.setSaved(id, saved)}
          onReadAndNext={() => digestMarkRead(digestRow)}
          onNextUnread={digestNextTopic}
          onOpen={() => openUrl(update.url)}
          onClose={goBack}
        />
      );
    }
    if (!selected) return null;
    return (
      <DetailPane
        update={withContent(selected)}
        contentLoading={!selected.content && !(selected.id in fomo.content)}
        onSetStatus={handleSetStatus}
        onToggleSaved={handleToggleSaved}
        onReadAndNext={handleReadAndNext}
        onNextUnread={handleNextUnread}
        onOpen={() => selected.url && openUrl(selected.url)}
        onClose={() => setSelected(undefined)}
      />
    );
  }

  function renderMobileActions() {
    if (isDigest && digestRow) {
      const update = rowUpdate(digestRow);
      return (
        <div className="mobile-actions">
          <button className="mobile-actions__btn" onClick={goBack}>
            <span>←</span><span>Back</span>
          </button>
          <button className="mobile-actions__btn" onClick={() => digestMarkRead(digestRow)}>
            <span>✓</span><span>{digestTopic ? 'Topic read' : 'Read'}</span>
          </button>
          {update ? (
            <button className="mobile-actions__btn" onClick={() => void fomo.setSaved(update.id, !update.saved)}>
              <span>{update.saved ? '★' : '☆'}</span><span>{update.saved ? 'Unsave' : 'Save'}</span>
            </button>
          ) : (
            <button className="mobile-actions__btn" onClick={digestNextTopic}>
              <span>↓</span><span>Next</span>
            </button>
          )}
        </div>
      );
    }
    if (!isDigest && selected) {
      return (
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
          <button className="mobile-actions__btn" onClick={() => handleToggleSaved(selected.id, !selected.saved)}>
            <span>{selected.saved ? '★' : '☆'}</span>
            <span>{selected.saved ? 'Unsave' : 'Save'}</span>
          </button>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="app">
      <StatusBar
        stats={fomo.stats}
        loading={fomo.loading}
        message={fomo.message}
        expiresInDays={expiresInDays}
        onDisconnect={() => {
          if (window.confirm('Disconnect this device? You will need a new link (fomo → c → Link a device) to reconnect.')) onDisconnect();
        }}
        onHelpClick={() => {
          setHelpContext(isDigest ? 'digest' : selected ? 'detail' : 'list');
          setShowHelp(true);
        }}
        onSettingsClick={() => setShowSettings(true)}
      />

      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={['filter-pill', fomo.filter === f.value ? 'filter-pill--active' : ''].join(' ')}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className={mainClass}>
        {fomo.filter === 'todos' ? (
          <TodosPane client={service} />
        ) : isDigest ? (
          <>
            <DigestList
              rows={digestRows}
              expanded={expanded}
              selectedKey={digestRow?.key}
              pending={fomo.pending}
              onSelect={(row) => setDigestKey(row.key)}
              onToggle={(topicId) => setTopicExpanded(topicId, !expanded.has(topicId))}
              onMarkRead={digestMarkRead}
              sourceLabels={fomo.settings.sourceLabels}
              sourceColors={fomo.settings.sourceColors}
              onRefresh={handleRefresh}
            />
            {renderDetail()}
          </>
        ) : (
          <>
            <UpdatesTable
              updates={fomo.updates}
              selectedId={selected?.id}
              onSelect={setSelected}
              sourceLabels={fomo.settings.sourceLabels}
              sourceColors={fomo.settings.sourceColors}
              onSwipeAction={handleSwipeAction}
              onRefresh={handleRefresh}
            />
            {renderDetail()}
          </>
        )}
      </div>

      {renderMobileActions()}

      {showHelp && <HelpOverlay context={helpContext} onClose={() => setShowHelp(false)} />}

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
