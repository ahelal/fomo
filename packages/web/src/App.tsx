import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FomoStorageService,
  addSourcePatch,
  flattenDigest,
  removeSourcePatch,
  forgetSourcePatch,
  userSource,
  restoreSourcesPatch,
  sourceInfos,
  nextRowKey,
  removeAndAdvance,
  soloUpdate,
  shortcutKey,
  jumpStep,
  type Update,
  type Status,
  type PreviewPosition,
  type SourceInfo,
  type UserSourceSpec,
  type SasConnection,
  type DigestRow,
  type Reference,
} from '@fomo/core';
import {
  consumeConnectLink,
  loadConnection,
  saveConnection,
  clearConnection,
  daysUntilExpiry,
} from './store/connection.js';
import { useFomo, canGroup, isGroupedView, isPaneView, type FilterStatus, type GroupableView } from './hooks/useFomo.js';
import { StatusBar } from './components/StatusBar.js';
import { UpdatesTable } from './components/UpdatesTable.js';
import { DigestList } from './components/DigestList.js';
import { DetailPane } from './components/DetailPane.js';
import { TopicPane } from './components/TopicPane.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { HelpOverlay, type HelpContext } from './components/HelpOverlay.js';
import { TodosPane } from './components/TodosPane.js';
import { ReferencesPane } from './components/ReferencesPane.js';
import { ReferenceDialog } from './components/ReferenceDialog.js';
import { ConnectScreen } from './components/ConnectScreen.js';
import { SearchBox } from './components/SearchBox.js';
import { SourcePicker, SourceFilterChip, type SourceOption } from './components/SourcePicker.js';

const FILTERS: { label: string; value: FilterStatus }[] = [
  { label: '1 All', value: 'all' },
  { label: '2 Unread', value: 'unread' },
  { label: '3 Read', value: 'read' },
  { label: '4 Saved', value: 'saved' },
  { label: '5 Todos', value: 'todos' },
  { label: '6 Refs', value: 'refs' },
];

const FILTER_KEYS: Record<string, FilterStatus> = {
  '1': 'all', '2': 'unread', '3': 'read', '4': 'saved', '5': 'todos', t: 'todos', '6': 'refs', b: 'refs',
};

/** Rows of text that fit in the window (≈20px each), for `jumpStep`. */
const screenLines = () => Math.floor(window.innerHeight / 20);

/** The update a digest row points at (items and single-update topics), if any. */
function rowUpdate(row: DigestRow | undefined): Update | undefined {
  if (!row) return undefined;
  if (row.kind === 'item') return row.update;
  return soloUpdate(row.entry);
}

/** The updates a row stands for: one for an item, all of them for a topic. */
function rowItems(row: DigestRow): Update[] {
  return row.kind === 'item' ? [row.update] : row.entry.items;
}

function rowIds(row: DigestRow): string[] {
  return rowItems(row).map((u) => u.id);
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
  /** Open source picker; options are undefined while the counts load. */
  const [sourcePicker, setSourcePicker] = useState<{ options?: SourceOption[] } | undefined>();
  const sourcePickerSeq = useRef(0);
  /** Filing an update in References (m). */
  const [refDialog, setRefDialog] = useState<{ update: Update; reference?: Reference; note?: string } | undefined>();
  const refDialogSeq = useRef(0);
  /** The view to return to when b leaves References. */
  const backFilter = useRef<FilterStatus>('unread');

  const previewPosition = fomo.settings.previewPosition;
  /** Unread and Saved list topics unless switched to a plain list. */
  const isGrouped = isGroupedView(fomo.filter, fomo.grouped);
  const isSaved = fomo.filter === 'saved';
  const pane = isPaneView(fomo.filter);
  const viewHelp: HelpContext = fomo.filter === 'refs' ? 'references' : isGrouped ? (isSaved ? 'saved' : 'digest') : selected ? 'detail' : 'list';

  const digestRows = useMemo(() => flattenDigest(fomo.digest, expanded), [fomo.digest, expanded]);
  const digestRow = digestKey ? digestRows.find((r) => r.key === digestKey) : undefined;
  const digestTopic = digestRow?.kind === 'topic' && digestRow.entry.items.length > 1 ? digestRow.entry : undefined;
  const detailUpdate = isGrouped ? rowUpdate(digestRow) : pane ? undefined : selected;
  const hasSelection = isGrouped ? !!digestRow : !!selected;

  const swipeBackRef = useRef({ startX: 0, startY: 0 });
  const searchInputRef = useRef<HTMLInputElement>(null);

  const sources = useMemo<SourceInfo[]>(() => sourceInfos(fomo.settings), [fomo.settings]);

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

  /** Selecting the current Unread or Saved view again switches it between topics and a plain list. */
  const setFilter = useCallback((f: FilterStatus) => {
    clearSelection();
    if (f === 'refs' && fomo.filter !== 'refs') backFilter.current = fomo.filter;
    if (f === fomo.filter && canGroup(f)) fomo.toggleGrouped();
    else fomo.setFilter(f);
  }, [fomo, clearSelection]);

  /** Search the current view (the query stays applied across view switches until cleared). */
  const setSearch = useCallback((q: string) => {
    if (q.trim() === fomo.search) return;
    clearSelection();
    fomo.setSearch(q);
  }, [fomo, clearSelection]);

  const sourceName = useCallback(
    (id: string) => fomo.settings.sourceLabels[id] ?? sources.find((s) => s.id === id)?.displayName ?? id,
    [fomo.settings.sourceLabels, sources],
  );

  /** Pick which sources to show; counts are for the current view and search. */
  const openSourcePicker = useCallback(() => {
    const seq = ++sourcePickerSeq.current;
    setSourcePicker({});
    fomo.countSources().then((counts) => {
      if (seq !== sourcePickerSeq.current) return;
      const ids = new Set([...Object.keys(counts), ...(fomo.sourceFilter ?? [])]);
      const options = [...ids]
        .map((id) => ({ id, label: sourceName(id), color: fomo.settings.sourceColors[id], count: counts[id] ?? 0 }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      setSourcePicker({ options });
    }).catch(() => {
      if (seq === sourcePickerSeq.current) setSourcePicker({ options: [] });
    });
  }, [fomo, sourceName]);

  const closeSourcePicker = useCallback(() => {
    sourcePickerSeq.current++;
    setSourcePicker(undefined);
  }, []);

  /** m: file an update in References, or edit it when its link is already there. */
  const fileReference = useCallback(async (update: Update) => {
    const seq = ++refDialogSeq.current;
    let existing: Reference | undefined;
    try {
      const { references } = await service.listReferences();
      existing = references.find((r) => r.url === update.url || r.updateId === update.id);
    } catch {
      // saving reports any storage problem
    }
    if (seq !== refDialogSeq.current) return;
    const note = existing ? `Already in References${existing.folder ? ` → ${existing.folder}` : ''} — editing it` : undefined;
    setRefDialog({ update, reference: existing, note });
  }, [service]);

  const applySourceFilter = useCallback((ids: string[] | undefined) => {
    closeSourcePicker();
    clearSelection();
    fomo.setSourceFilter(ids);
  }, [fomo, clearSelection, closeSourcePicker]);

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

  /** Mark a row read without removing it from the current view, so it can be toggled back. */
  const digestMarkRead = useCallback((row: DigestRow) => {
    void fomo.markRead(rowIds(row));
  }, [fomo]);

  /** Mark a row read and move on, while leaving it visible for undo until the view is reloaded. */
  const digestReadAndNext = useCallback((row: DigestRow) => {
    setDigestKey(nextRowKey(digestRows, row.key));
    void fomo.markRead(rowIds(row));
  }, [fomo, digestRows]);

  /** Saved view: mark a row read and select the next one. */
  const savedReadAndNext = useCallback((row: DigestRow) => {
    setDigestKey(nextRowKey(digestRows, row.key));
    void fomo.setStatusMany(rowIds(row), 'read');
  }, [fomo, digestRows]);

  const toggleDigestRead = useCallback((row: DigestRow) => {
    const status = rowItems(row).some((u) => u.status === 'unread') ? 'read' : 'unread';
    void fomo.setStatusMany(rowIds(row), status);
  }, [fomo]);

  /** Saved view: unsave the selected update, which leaves the list; select the next remaining row. */
  const savedUnsave = useCallback((update: Update) => {
    if (digestKey) setDigestKey(removeAndAdvance(fomo.digest, expanded, digestKey, new Set([update.id])).nextKey);
    void fomo.setSaved(update.id, false);
  }, [fomo, expanded, digestKey]);

  /** Save or unsave from a grouped view (unsaving removes the update from the Saved view). */
  const groupedToggleSaved = useCallback((update: Update) => {
    if (isSaved && update.saved) savedUnsave(update);
    else void fomo.setSaved(update.id, !update.saved);
  }, [fomo, isSaved, savedUnsave]);

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
    if (isGrouped && digestRow?.kind === 'item') {
      setDigestKey(digestRow.entry.topic.id);
      return;
    }
    clearSelection();
  }, [isGrouped, digestRow, clearSelection]);

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
      const key = shortcutKey(e.key);
      // Shift+↑/↓ jumps several rows (more on a tall window).
      const step = e.shiftKey && (key === 'ArrowDown' || key === 'ArrowUp') ? jumpStep(screenLines()) : 1;

      if (sourcePicker || refDialog) return;
      if (showHelp) {
        if (key === 'Escape' || key === 'Backspace' || key === 'h') setShowHelp(false);
        return;
      }

      if (showSettings) {
        if (key === 'Escape' || key === 'Backspace' || key === 'c') setShowSettings(false);
        if (key === 'h') {
          setHelpContext('settings');
          setShowHelp(true);
        }
        return;
      }

      if (hasSelection && (key === 'Escape' || key === 'Backspace' || key === 'q')) {
        clearSelection();
        return;
      }

      if (key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !pane) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (key === 'v' && !e.metaKey && !e.ctrlKey && !e.altKey && !pane) {
        openSourcePicker();
        return;
      }
      // Esc clears the search first, then the source filter.
      if (key === 'Escape' && fomo.search && !pane) {
        setSearch('');
        return;
      }
      if (key === 'Escape' && fomo.sourceFilter && !pane) {
        applySourceFilter(undefined);
        return;
      }

      if (key === 'h') {
        setHelpContext(viewHelp);
        setShowHelp(true);
        return;
      }
      if (key === 'c') { setShowSettings(true); return; }
      if (key === 'b' && fomo.filter === 'refs') { setFilter(backFilter.current); return; }
      if (key in FILTER_KEYS) { setFilter(FILTER_KEYS[key]!); return; }
      if (key === '.') {
        const next: PreviewPosition = previewPosition === 'right' ? 'bottom' : 'right';
        void fomo.updateSettings({ previewPosition: next });
        return;
      }

      if (pane) return;

      if (key === 'm') {
        const update = isGrouped ? rowUpdate(digestRow) : selected;
        if (update) void fileReference(update);
        else fomo.notify(isGrouped && digestRow ? 'Expand the topic to file a single update' : 'Select an update to file it in References');
        return;
      }

      if (isGrouped) {
        const idx = digestKey ? digestRows.findIndex((r) => r.key === digestKey) : -1;
        const row = idx >= 0 ? digestRows[idx] : undefined;
        if (key === 'j' || key === 'ArrowDown') {
          e.preventDefault();
          const next = digestRows[Math.min(idx + step, digestRows.length - 1)];
          if (next) setDigestKey(next.key);
          return;
        }
        if (key === 'k' || key === 'ArrowUp') {
          e.preventDefault();
          const prev = digestRows[idx === -1 ? digestRows.length - 1 : Math.max(idx - step, 0)];
          if (prev) setDigestKey(prev.key);
          return;
        }
        if (key === 'n') { digestNextTopic(); return; }
        if (key === 'Enter') {
          if (!row) { if (digestRows[0]) setDigestKey(digestRows[0].key); return; }
          if (row.kind === 'topic' && row.entry.items.length > 1) setTopicExpanded(row.entry.topic.id, !expanded.has(row.entry.topic.id));
          else clearSelection();
          return;
        }
        if (!row) return;
        if (key === 'ArrowRight' || key === 'l') {
          if (row.kind === 'topic' && row.entry.items.length > 1) setTopicExpanded(row.entry.topic.id, true);
          return;
        }
        if (key === 'ArrowLeft') {
          if (row.kind === 'item') setDigestKey(row.entry.topic.id);
          if (row.entry.items.length > 1) setTopicExpanded(row.entry.topic.id, false);
          return;
        }
        const update = rowUpdate(row);
        if (isSaved) {
          if (key === 'r') { toggleDigestRead(row); return; }
          if (key === 'x') { savedReadAndNext(row); return; }
        } else if (key === 'x') {
          digestReadAndNext(row);
          return;
        } else if (key === 'r') {
          toggleDigestRead(row);
          return;
        }
        if (key === 's' && update) { groupedToggleSaved(update); return; }
        if (key === 'o') {
          const target = update ?? row.entry.items[0];
          if (target) openUrl(target.url);
          return;
        }
        return;
      }

      if (key === 'j' || key === 'ArrowDown') {
        e.preventDefault();
        if (fomo.updates.length === 0) return;
        const idx = selected ? fomo.updates.findIndex((u) => u.id === selected.id) : -1;
        setSelected(fomo.updates[Math.min(idx + step, fomo.updates.length - 1)]);
        return;
      }
      if (key === 'k' || key === 'ArrowUp') {
        e.preventDefault();
        if (fomo.updates.length === 0) return;
        const idx = selected ? fomo.updates.findIndex((u) => u.id === selected.id) : fomo.updates.length;
        setSelected(fomo.updates[Math.max(idx - step, 0)]);
        return;
      }
      if (key === 'Enter') {
        if (selected) setSelected(undefined);
        else if (fomo.updates.length > 0) setSelected(fomo.updates[0]);
        return;
      }
      if (key === 'n') { handleNextUnread(); return; }

      if (!selected) return;
      if (key === 'x') { handleReadAndNext(); return; }
      if (key === 'r') { handleSetStatus(selected.id, selected.status === 'unread' ? 'read' : 'unread'); return; }
      if (key === 's') { handleToggleSaved(selected.id, !selected.saved); return; }
      if (key === 'o' && selected.url) { openUrl(selected.url); return; }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    fomo, selected, isGrouped, isSaved, pane, viewHelp, digestRow, refDialog, fileReference, digestKey, digestRows, expanded, hasSelection, showSettings, showHelp,
    sourcePicker, openSourcePicker, applySourceFilter,
    previewPosition, setFilter, setSearch, clearSelection, setTopicExpanded, digestMarkRead, digestReadAndNext, savedReadAndNext, toggleDigestRead, groupedToggleSaved,
    digestNextTopic, handleNextUnread, handleReadAndNext, handleSetStatus, handleToggleSaved,
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

  const handleAddSource = useCallback(
    (spec: UserSourceSpec) => {
      void fomo.updateSettings(addSourcePatch(fomo.settings, spec));
    },
    [fomo],
  );

  /** Remove a source, keeping its stored updates (it then shows greyed out) or deleting them too. */
  const handleRemoveSource = useCallback(
    (sourceId: string, deleteItems = false) => {
      const items = fomo.stats?.bySource[sourceId] ?? 0;
      const own = !!userSource(fomo.settings, sourceId);
      const patch = removeSourcePatch(fomo.settings, sourceId, { keepName: items > 0 && !deleteItems });
      void fomo.updateSettings(deleteItems && own ? { ...patch, ...forgetSourcePatch(fomo.settings, sourceId) } : patch);
      if (deleteItems && items > 0) void fomo.deleteSourceUpdates(sourceId);
    },
    [fomo],
  );

  /** Delete the stored updates of a source; one that is gone for good also loses its label and color. */
  const handleDeleteSourceItems = useCallback(
    async (sourceId: string) => {
      const gone = !sources.some((s) => s.id === sourceId) && !fomo.settings.removedSources.includes(sourceId);
      const n = await fomo.deleteSourceUpdates(sourceId);
      if (n !== undefined && gone) void fomo.updateSettings(forgetSourcePatch(fomo.settings, sourceId));
    },
    [fomo, sources],
  );

  const handleRestoreSource = useCallback((sourceId: string) => {
    void fomo.updateSettings({ removedSources: fomo.settings.removedSources.filter((s) => s !== sourceId) });
  }, [fomo]);

  const handleRestoreSources = useCallback(() => {
    void fomo.updateSettings(restoreSourcesPatch());
  }, [fomo]);

  // ── Render ──

  const showPreview = hasSelection && !pane && previewPosition !== 'off';
  const mainClass = `main main--preview-${showPreview ? previewPosition : 'none'}`;
  const sourceFilterLabel = fomo.sourceFilter
    ? fomo.sourceFilter.length <= 2 ? fomo.sourceFilter.map(sourceName).join(', ') : `${fomo.sourceFilter.length} sources`
    : undefined;
  const searchMatches = !fomo.search || fomo.loading
    ? undefined
    : isGrouped ? fomo.digest.reduce((n, e) => n + e.items.length, 0) : fomo.total;

  function renderDetail() {
    if (!showPreview) return null;
    if (isGrouped && digestRow) {
      if (digestTopic) {
        return (
          <TopicPane
            entry={digestTopic}
            mode={isSaved ? 'saved' : 'digest'}
            sourceLabels={fomo.settings.sourceLabels}
            onOpenItem={(u) => openTopicItem(digestTopic.topic.id, u)}
            onMarkRead={() => digestMarkRead(digestRow)}
            onToggleRead={() => toggleDigestRead(digestRow)}
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
          onSetStatus={(id, status) => void fomo.setStatus(id, status)}
          onToggleSaved={() => groupedToggleSaved(update)}
          onReadAndNext={() => (isSaved ? savedReadAndNext(digestRow) : digestReadAndNext(digestRow))}
          onNextUnread={digestNextTopic}
          onOpen={() => openUrl(update.url)}
          onFileReference={() => void fileReference(update)}
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
        onFileReference={() => void fileReference(selected)}
        onClose={() => setSelected(undefined)}
      />
    );
  }

  function renderMobileActions() {
    if (isGrouped && digestRow) {
      const update = rowUpdate(digestRow);
      // The Saved view keeps read updates, so its button toggles between read and unread.
      const markUnread = !rowItems(digestRow).some((u) => u.status === 'unread');
      const what = digestTopic ? 'Topic ' : '';
      return (
        <div className="mobile-actions">
          <button className="mobile-actions__btn" onClick={goBack}>
            <span>←</span><span>Back</span>
          </button>
          <button
            className="mobile-actions__btn"
            onClick={() => void fomo.setStatusMany(rowIds(digestRow), markUnread ? 'unread' : 'read')}
          >
            <span>{markUnread ? '●' : '✓'}</span><span>{markUnread ? `${what}unread` : `${what}read`}</span>
          </button>
          {update ? (
            <button className="mobile-actions__btn" onClick={() => groupedToggleSaved(update)}>
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
    if (!isGrouped && selected) {
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
          setHelpContext(viewHelp);
          setShowHelp(true);
        }}
        onSettingsClick={() => setShowSettings(true)}
      />

      <div className="filters">
        <div className="filters__pills">
          {FILTERS.map((f) => {
            const active = fomo.filter === f.value;
            const toggles = canGroup(f.value);
            return (
              <button
                key={f.value}
                className={['filter-pill', active ? 'filter-pill--active' : ''].join(' ')}
                onClick={() => setFilter(f.value)}
                title={active && toggles ? `Show as ${fomo.grouped[f.value as GroupableView] ? 'a list' : 'topics'}` : undefined}
              >
                {f.label}
                {active && toggles && (
                  <span className="filter-pill__mode">{fomo.grouped[f.value as GroupableView] ? ' · topics' : ' · list'}</span>
                )}
              </button>
            );
          })}
        </div>
        {!pane && (
          <SourceFilterChip
            filter={fomo.sourceFilter}
            label={sourceFilterLabel}
            onOpen={openSourcePicker}
            onClear={() => applySourceFilter(undefined)}
          />
        )}
        {!pane && (
          <SearchBox ref={searchInputRef} value={fomo.search} matches={searchMatches} onSearch={setSearch} />
        )}
      </div>

      <div className={mainClass}>
        {fomo.filter === 'todos' ? (
          <TodosPane client={service} />
        ) : fomo.filter === 'refs' ? (
          <ReferencesPane service={service} active={!showHelp && !showSettings && !sourcePicker} />
        ) : isGrouped ? (
          <>
            <DigestList
              mode={isSaved ? 'saved' : 'digest'}
              rows={digestRows}
              expanded={expanded}
              selectedKey={digestRow?.key}
              pending={fomo.pending}
              onSelect={(row) => setDigestKey(row.key)}
              onToggle={(topicId) => setTopicExpanded(topicId, !expanded.has(topicId))}
              onToggleRead={toggleDigestRead}
              sourceLabels={fomo.settings.sourceLabels}
              sourceColors={fomo.settings.sourceColors}
              onRefresh={handleRefresh}
              search={fomo.search}
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
              search={fomo.search}
            />
            {renderDetail()}
          </>
        )}
      </div>

      {renderMobileActions()}

      {sourcePicker && (
        <SourcePicker
          options={sourcePicker.options}
          current={fomo.sourceFilter}
          onApply={applySourceFilter}
          onClose={closeSourcePicker}
        />
      )}

      {refDialog && (
        <ReferenceDialog
          service={service}
          reference={refDialog.reference}
          initial={{
            title: refDialog.update.title,
            url: refDialog.update.url,
            description: refDialog.update.gist?.summary ?? refDialog.update.summary ?? '',
          }}
          updateId={refDialog.update.id}
          note={refDialog.note}
          onSaved={(saved, created) => {
            setRefDialog(undefined);
            fomo.notify(`🔖 ${created ? 'Filed' : 'Updated'} in References → ${saved.folder || 'top level'}`, 4000);
          }}
          onClose={() => setRefDialog(undefined)}
        />
      )}

      {showHelp && <HelpOverlay context={helpContext} onClose={() => setShowHelp(false)} />}

      {showSettings && (
        <SettingsPanel
          settings={fomo.settings}
          sources={sources}
          onToggleSource={handleToggleSource}
          onSetPreviewPosition={handleSetPreviewPosition}
          onSetSourceLabel={handleSetSourceLabel}
          onSetSourceColor={handleSetSourceColor}
          onAddSource={handleAddSource}
          onRemoveSource={handleRemoveSource}
          onRestoreSources={handleRestoreSources}
          onRestoreSource={handleRestoreSource}
          onDeleteSourceItems={(id) => void handleDeleteSourceItems(id)}
          stats={fomo.stats}
          onSaveSource={(patch) => void fomo.updateSettings(patch)}
          onShowSourceUpdates={(id) => { setShowSettings(false); fomo.setSourceFilter([id]); }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
