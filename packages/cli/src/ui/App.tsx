import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Box, useInput, useApp } from 'ink';
import type { Update, Status, StatsResponse, PreviewPosition, SourceInfo, AppSettings, Todo, TodoStatus, DigestEntry, DigestRow } from '@fomo/core';
import { DEFAULT_SETTINGS, flattenDigest, removeAndAdvance } from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import type { DigestResult } from '@fomo/core/digest';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { UpdatesTable } from './components/UpdatesTable.js';
import { DigestTable } from './components/DigestTable.js';
import { StatusBar } from './components/StatusBar.js';
import { DetailPane } from './components/DetailPane.js';
import { TopicPane } from './components/TopicPane.js';
import { HelpOverlay, type HelpContext } from './components/HelpOverlay.js';
import { FilterBar } from './components/FilterBar.js';
import { SettingsPane, PREVIEW_OPTIONS, COLOR_PALETTE } from './components/SettingsPane.js';
import { TodosView, type TodoFormField } from './components/TodosView.js';

type FilterStatus = Status | 'all' | 'saved' | 'digest';

interface Props {
  service: FomoDirectService;
  /** Group unread updates with Copilot (runs after an `f`/`F` fetch). */
  digest?(onProgress: (message: string) => void): Promise<DigestResult>;
}

/** The update a digest row points at (items and single-item entries), if any. */
function rowUpdate(row: DigestRow | undefined): Update | undefined {
  if (!row) return undefined;
  if (row.kind === 'item') return row.update;
  return row.entry.synthetic ? row.entry.items[0] : undefined;
}

// Fixed line counts for chrome
const STATUSBAR_H = 2; // content + border line
const FILTERBAR_H = 1;

export function App({ service, digest }: Props) {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();

  const [updates, setUpdates] = useState<Update[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState<FilterStatus>('digest');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [showDetail, setShowDetail] = useState(false);
  const [stats, setStats] = useState<StatsResponse | undefined>();
  const [previewPosition, setPreviewPosition] = useState<PreviewPosition>('bottom');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsFocusIndex, setSettingsFocusIndex] = useState(0);
  const [appSettings, setAppSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS });
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelBuffer, setLabelBuffer] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [helpContext, setHelpContext] = useState<HelpContext>('list');

  // ── Digest state ────────────────────────────────────────────────────────────
  const [digestEntries, setDigestEntries] = useState<DigestEntry[]>([]);
  const [digestPending, setDigestPending] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Digest lists skip `content`; it is loaded on demand for the detail pane.
  const [contentCache, setContentCache] = useState<Record<string, string>>({});
  const digestRows = useMemo(() => flattenDigest(digestEntries, expanded), [digestEntries, expanded]);

  // ── Todos state ─────────────────────────────────────────────────────────────
  const [showTodos, setShowTodos] = useState(false);
  const [todosList, setTodosList] = useState<Todo[]>([]);
  const [todosSelectedIndex, setTodosSelectedIndex] = useState(0);
  const [todosAddMode, setTodosAddMode] = useState(false);
  const [todosFormField, setTodosFormField] = useState<TodoFormField>('subject');
  const [todosFormSubject, setTodosFormSubject] = useState('');
  const [todosFormDue, setTodosFormDue] = useState('');
  const [todosFormDesc, setTodosFormDesc] = useState('');
  const [todosMessage, setTodosMessage] = useState<string | undefined>();

  // Keep refs so async callbacks always see the latest state
  const updatesRef  = useRef(updates);
  const selectedRef = useRef(selectedIndex);
  const filterRef   = useRef(filter);
  const digestEntriesRef = useRef(digestEntries);
  const digestRowsRef    = useRef(digestRows);
  const expandedRef      = useRef(expanded);
  useEffect(() => { updatesRef.current  = updates;      }, [updates]);
  useEffect(() => { selectedRef.current = selectedIndex; }, [selectedIndex]);
  useEffect(() => { filterRef.current   = filter;       }, [filter]);
  useEffect(() => { digestEntriesRef.current = digestEntries; }, [digestEntries]);
  useEffect(() => { digestRowsRef.current    = digestRows;    }, [digestRows]);
  useEffect(() => { expandedRef.current      = expanded;      }, [expanded]);

  const listLength = filter === 'digest' ? digestRows.length : updates.length;
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, listLength - 1)));
  }, [listLength]);

  // Load remote settings and sources on mount
  useEffect(() => {
    service.getSettings().then((s) => {
      setAppSettings(s);
      const pos = s.previewPosition === 'off' ? 'bottom' : s.previewPosition;
      setPreviewPosition(pos as 'right' | 'bottom');
    }).catch(() => { /* use default */ });
    service.getSources().then(setSources).catch(() => { /* ignore */ });
  }, [service]);

  const messageTimer = useRef<ReturnType<typeof setTimeout>>();
  const showMessage = useCallback((msg: string, ms = 2500) => {
    setMessage(msg);
    clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(undefined), ms);
  }, []);

  const loadUpdates = useCallback(
    async (f: FilterStatus) => {
      setLoading(true);
      try {
        if (f === 'digest') {
          const resp = await service.getDigest();
          setDigestEntries(resp.entries);
          setDigestPending(resp.pending);
          return;
        }
        const opts = f === 'saved'
          ? { saved: true, limit: 200 }
          : { status: f as Status | 'all', limit: 200 };
        const resp = await service.listUpdates(opts);
        setUpdates(resp.updates);
        setSelectedIndex((i) => Math.min(i, Math.max(0, resp.updates.length - 1)));
      } catch (err) {
        showMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    },
    [service, showMessage],
  );

  const loadStats = useCallback(async () => {
    try {
      const s = await service.getStats();
      setStats(s);
    } catch {
      // non-critical
    }
  }, [service]);

  const loadTodos = useCallback(async () => {
    try {
      const resp = await service.listTodos();
      setTodosList(resp.todos);
      setTodosSelectedIndex((i) => Math.min(i, Math.max(0, resp.todos.length - 1)));
    } catch {
      // non-critical
    }
  }, [service]);

  const showTodosMessage = useCallback((msg: string, ms = 2000) => {
    setTodosMessage(msg);
    setTimeout(() => setTodosMessage(undefined), ms);
  }, []);

  const refresh = useCallback(
    async (f?: FilterStatus) => {
      await Promise.all([loadUpdates(f ?? filterRef.current), loadStats()]);
    },
    [loadUpdates, loadStats],
  );

  // Initial load
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Async action handlers ───────────────────────────────────────────────────
  const currentUpdate = useCallback((): Update | undefined => {
    if (filterRef.current === 'digest') return rowUpdate(digestRowsRef.current[selectedRef.current]);
    return updatesRef.current[selectedRef.current];
  }, []);

  // One fetch + digest at a time; a second run would plan the same items twice.
  const fetchingRef = useRef(false);
  const doFetch = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    showMessage('Fetching latest updates…', 600_000);
    try {
      const resp = await service.fetch();
      const added = `✓ Added ${resp.added} update${resp.added !== 1 ? 's' : ''}`;
      if (digest) {
        showMessage(`${added} · summarising with Copilot…`, 600_000);
        await refresh();
        const result = await digest((msg) => showMessage(msg, 600_000));
        const errs = result.errors.length ? ` · ⚠ ${result.errors.length} failed` : '';
        showMessage(`${added} · grouped ${result.processed} into topics${errs}`, 5000);
      } else {
        showMessage(added);
      }
      await refresh();
    } catch (err) {
      showMessage(`Fetch error: ${err instanceof Error ? err.message : String(err)}`, 5000);
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, [service, digest, refresh, showMessage]);

  const doFetchContent = useCallback(async () => {
    const selected = currentUpdate();
    if (!selected) return;
    setLoading(true);
    showMessage('Fetching content…');
    try {
      const updated = await service.fetchContent(selected.id);
      setUpdates((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      setContentCache((prev) => ({ ...prev, [updated.id]: updated.content }));
      showMessage('✓ Content fetched');
    } catch (err) {
      showMessage(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [service, currentUpdate, showMessage]);

  // ── Digest actions ──────────────────────────────────────────────────────────
  /** Mark updates read, drop them from the digest and keep the cursor on the next remaining row. */
  const doDigestRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const selectedKey = digestRowsRef.current[selectedRef.current]?.key;
    const next = removeAndAdvance(digestEntriesRef.current, expandedRef.current, selectedKey, new Set(ids));
    setDigestEntries(next.entries);
    setSelectedIndex(Math.max(0, next.rows.findIndex((r) => r.key === next.nextKey)));
    showMessage(ids.length > 1 ? `✓ ${ids.length} marked read` : '✓ Marked read');

    try {
      await service.setStatusMany(ids, 'read');
      void loadStats();
    } catch (err) {
      showMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
      await refresh();
    }
  }, [service, refresh, loadStats, showMessage]);

  const doDigestToggleSaved = useCallback(async (update: Update) => {
    const saved = !update.saved;
    setDigestEntries((prev) => prev.map((e) => (
      e.items.some((u) => u.id === update.id)
        ? { ...e, items: e.items.map((u) => (u.id === update.id ? { ...u, saved } : u)) }
        : e
    )));
    showMessage(saved ? '⭐ Saved' : 'Unsaved');
    try {
      await service.setSaved(update.id, saved);
      void loadStats();
    } catch (err) {
      showMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
      await refresh();
    }
  }, [service, refresh, loadStats, showMessage]);

  const setTopicExpanded = useCallback((topicId: string, open: boolean) => {
    setExpanded((prev) => {
      if (prev.has(topicId) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(topicId);
      else next.delete(topicId);
      return next;
    });
  }, []);

  const doMark = useCallback(async (status: Status) => {
    const selected = updatesRef.current[selectedRef.current];
    if (!selected) return;

    setUpdates((prev) =>
      prev.map((u) => (u.id === selected.id ? { ...u, status } : u)),
    );
    showMessage(`Marked ${status}`);

    try {
      await service.setStatus(selected.id, status);
      void loadStats();
    } catch (err) {
      showMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
      await refresh();
    }
  }, [service, refresh, loadStats, showMessage]);

  const doToggleSaved = useCallback(async () => {
    const selected = updatesRef.current[selectedRef.current];
    if (!selected) return;

    const newSaved = !selected.saved;
    setUpdates((prev) =>
      prev.map((u) => (u.id === selected.id ? { ...u, saved: newSaved } : u)),
    );
    showMessage(newSaved ? '⭐ Saved' : 'Unsaved');

    try {
      await service.setSaved(selected.id, newSaved);
      void loadStats();
    } catch (err) {
      showMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
      await refresh();
    }
  }, [service, refresh, loadStats, showMessage]);

  const doOpen = useCallback(async () => {
    const selected = updatesRef.current[selectedRef.current];
    if (!selected) return;
    try {
      const { default: open } = await import('open');
      await open(selected.url);
    } catch {
      showMessage('Could not open browser');
    }
  }, [showMessage]);

  const doReadAndNext = useCallback(async () => {
    const items = updatesRef.current;
    const idx = selectedRef.current;
    const selected = items[idx];
    if (!selected) return;

    // Find next unread before mutating (skip current item)
    let nextIdx = -1;
    for (let i = idx + 1; i < items.length; i++) {
      if (items[i].status === 'unread') { nextIdx = i; break; }
    }
    if (nextIdx === -1) {
      for (let i = 0; i < idx; i++) {
        if (items[i].status === 'unread') { nextIdx = i; break; }
      }
    }

    // Optimistic update
    setUpdates((prev) =>
      prev.map((u) => (u.id === selected.id ? { ...u, status: 'read' as Status } : u)),
    );

    if (nextIdx !== -1) {
      setSelectedIndex(nextIdx);
      showMessage('Marked read → next unread');
    } else {
      showMessage('Marked read (no more unread)');
    }

    try {
      await service.setStatus(selected.id, 'read');
      void loadStats();
    } catch (err) {
      showMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
      await refresh();
    }
  }, [service, refresh, loadStats, showMessage]);

  // Lazily load content for the update shown in the digest detail pane
  const digestSelectedUpdate = filter === 'digest' ? rowUpdate(digestRows[selectedIndex]) : undefined;
  useEffect(() => {
    const u = digestSelectedUpdate;
    if (!showDetail || !u || u.content || u.id in contentCache) return;
    let cancelled = false;
    service.getUpdate(u.id)
      .then((full) => { if (!cancelled) setContentCache((prev) => ({ ...prev, [u.id]: full.content })); })
      .catch(() => { if (!cancelled) setContentCache((prev) => ({ ...prev, [u.id]: '' })); });
    return () => { cancelled = true; };
  }, [service, showDetail, digestSelectedUpdate, contentCache]);

  // ── Input handler ───────────────────────────────────────────────────────────
  useInput((input, key) => {
    // ── Quit from any screen (but not while editing a label or adding a todo) ──
    if (input === 'q' && !editingLabel && !todosAddMode) { exit(); return; }

    // ── Help overlay — Esc or h to close, consume all other input ──
    if (showHelp) {
      if (key.escape || key.backspace || key.delete || input === 'h') setShowHelp(false);
      return;
    }

    // ── Todos view input handling ──
    if (showTodos) {
      if (todosAddMode) {
        // Form input handling
        if (key.escape) {
          setTodosAddMode(false);
          setTodosFormSubject('');
          setTodosFormDue('');
          setTodosFormDesc('');
          setTodosFormField('subject');
          return;
        }
        if (key.tab) {
          setTodosFormField((f) =>
            f === 'subject' ? 'due' : f === 'due' ? 'description' : 'subject',
          );
          return;
        }
        if (key.return) {
          if (!todosFormSubject.trim()) {
            showTodosMessage('⚠ Subject is required');
            return;
          }
          void (async () => {
            try {
              await service.createTodo({
                subject: todosFormSubject.trim(),
                description: todosFormDesc.trim() || undefined,
                dueDate: todosFormDue || undefined,
              });
              setTodosAddMode(false);
              setTodosFormSubject('');
              setTodosFormDue('');
              setTodosFormDesc('');
              setTodosFormField('subject');
              await loadTodos();
              showTodosMessage('✓ Todo added');
            } catch (err) {
              showTodosMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
            }
          })();
          return;
        }
        if (key.backspace || key.delete) {
          if (todosFormField === 'subject')      setTodosFormSubject((b) => b.slice(0, -1));
          else if (todosFormField === 'due')     setTodosFormDue((b) => b.slice(0, -1));
          else if (todosFormField === 'description') setTodosFormDesc((b) => b.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          if (todosFormField === 'subject')      setTodosFormSubject((b) => b + input);
          else if (todosFormField === 'due')     setTodosFormDue((b) => b + input);
          else if (todosFormField === 'description') setTodosFormDesc((b) => b + input);
        }
        return;
      }

      // List mode inside todos view
      if (key.escape || key.backspace || input === 't') {
        setShowTodos(false);
        return;
      }
      if (key.upArrow || input === 'k') {
        setTodosSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setTodosSelectedIndex((i) => Math.min(todosList.length - 1, i + 1));
        return;
      }
      if (input === 'a') {
        setTodosAddMode(true);
        setTodosFormField('subject');
        return;
      }
      if (key.return && todosList[todosSelectedIndex]) {
        const todo = todosList[todosSelectedIndex];
        const nextStatus: Record<string, string> = {
          pending: 'in_progress', in_progress: 'done', done: 'pending',
        };
        const next = nextStatus[todo.status] as TodoStatus;
        setTodosList((prev) => prev.map((t) => (t.id === todo.id ? { ...t, status: next } : t)));
        void service.updateTodo(todo.id, { status: next })
          .then(() => loadTodos())
          .catch(() => loadTodos());
        return;
      }
      if (input === 'd' && todosList[todosSelectedIndex]) {
        const id = todosList[todosSelectedIndex].id;
        setTodosList((prev) => prev.filter((t) => t.id !== id));
        setTodosSelectedIndex((i) => Math.max(0, i - 1));
        void service.deleteTodo(id)
          .then(() => loadTodos())
          .catch(() => loadTodos());
        return;
      }
      return; // consume remaining input while in todos view
    }

    // ── Settings view input handling ──
    if (showSettings) {
      // Label edit mode — character input
      if (editingLabel) {
        if (key.escape) {
          setEditingLabel(false);
          setLabelBuffer('');
          return;
        }
        if (key.return) {
          // Save label
          const sourceId = sources[settingsFocusIndex]?.id;
          if (sourceId) {
            const newLabels = { ...appSettings.sourceLabels, [sourceId]: labelBuffer || sourceId };
            // Remove entry if it matches the source id (reset to default)
            if (labelBuffer === '' || labelBuffer === sourceId) delete newLabels[sourceId];
            setAppSettings((prev) => ({ ...prev, sourceLabels: newLabels }));
            void service.updateSettings({ sourceLabels: newLabels })
              .then((s) => setAppSettings(s))
              .catch(() => { /* silent */ });
          }
          setEditingLabel(false);
          setLabelBuffer('');
          return;
        }
        if (key.backspace || key.delete) {
          setLabelBuffer((b) => b.slice(0, -1));
          return;
        }
        // Append printable characters
        if (input && !key.ctrl && !key.meta) {
          setLabelBuffer((b) => b + input);
        }
        return;
      }

      if (key.escape || key.backspace || key.delete || input === 'c') {
        setShowSettings(false);
        return;
      }

      // Total items: sources.length + 1 (preview position)
      const totalItems = sources.length + 1;

      if (key.upArrow || input === 'k') {
        setSettingsFocusIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setSettingsFocusIndex((i) => Math.min(totalItems - 1, i + 1));
        return;
      }

      // 'e' to edit label on a source row
      if (input === 'e' && settingsFocusIndex < sources.length) {
        const sourceId = sources[settingsFocusIndex].id;
        setLabelBuffer(appSettings.sourceLabels[sourceId] ?? '');
        setEditingLabel(true);
        return;
      }

      // 'd' to cycle color on a source row
      if (input === 'd' && settingsFocusIndex < sources.length) {
        const sourceId = sources[settingsFocusIndex].id;
        const currentColor = appSettings.sourceColors?.[sourceId] || COLOR_PALETTE[0];
        const curIdx = COLOR_PALETTE.indexOf(currentColor);
        const nextColor = COLOR_PALETTE[(curIdx + 1) % COLOR_PALETTE.length];
        const newColors = { ...appSettings.sourceColors, [sourceId]: nextColor };
        setAppSettings((prev) => ({ ...prev, sourceColors: newColors }));
        void service.updateSettings({ sourceColors: newColors })
          .then((s) => setAppSettings(s))
          .catch(() => { /* silent */ });
        return;
      }

      if (key.return) {
        if (settingsFocusIndex < sources.length) {
          // Toggle source enabled/disabled
          const sourceId = sources[settingsFocusIndex].id;
          const disabled = new Set(appSettings.disabledSources);
          if (disabled.has(sourceId)) {
            disabled.delete(sourceId);
          } else {
            disabled.add(sourceId);
          }
          const newDisabled = [...disabled];
          setAppSettings((prev) => ({ ...prev, disabledSources: newDisabled }));
          void service.updateSettings({ disabledSources: newDisabled })
            .then((s) => setAppSettings(s))
            .catch(() => { /* silent */ });
        } else {
          // Cycle preview position
          const curIdx = PREVIEW_OPTIONS.indexOf(appSettings.previewPosition);
          const next = PREVIEW_OPTIONS[(curIdx + 1) % PREVIEW_OPTIONS.length];
          setAppSettings((prev) => ({ ...prev, previewPosition: next }));
          if (next !== 'off') setPreviewPosition(next as 'right' | 'bottom');
          void service.updateSettings({ previewPosition: next })
            .then((s) => setAppSettings(s))
            .catch(() => { /* silent */ });
        }
        return;
      }
      if (input === 'h') {
        setHelpContext('settings');
        setShowHelp(true);
        return;
      }
      return; // Consume all other input while in settings
    }

    // Help
    if (input === 'h') {
      setHelpContext(filter === 'digest' ? 'digest' : showDetail ? 'detail' : 'list');
      setShowHelp(true);
      return;
    }

    // Detail-specific: Esc or q to close
    if (showDetail && (key.escape || key.backspace || key.delete)) {
      setShowDetail(false);
      return;
    }

    // Open settings
    if (input === 'c') {
      setShowSettings(true);
      setSettingsFocusIndex(0);
      return;
    }

    // Open todos view
    if (input === 't') {
      setShowTodos(true);
      void loadTodos();
      return;
    }

    // Navigation
    if (key.upArrow   || input === 'k') { setSelectedIndex((i) => Math.max(0, i - 1));                return; }
    if (key.downArrow || input === 'j') { setSelectedIndex((i) => Math.min(listLength - 1, i + 1));    return; }

    // Filters
    const filterMap: Record<string, FilterStatus> = { '0': 'digest', '1': 'all', '2': 'unread', '3': 'read', '4': 'saved' };
    if (input in filterMap) {
      const f = filterMap[input]!;
      setFilter(f);
      setSelectedIndex(0);
      void refresh(f);
      return;
    }

    // Toggle preview position
    if (input === '.') {
      setPreviewPosition((prev) => prev === 'bottom' ? 'right' : 'bottom');
      return;
    }

    if (input === 'f' || input === 'F') { void doFetch(); return; }
    if (input === 'p' && showDetail) {
      const sel = currentUpdate();
      if (sel && !sel.content && !contentCache[sel.id]) void doFetchContent();
      return;
    }

    // ── Digest view ──
    if (filter === 'digest') {
      const row = digestRows[selectedIndex];
      if (!row) return;
      const entry = row.entry;
      const isTopic = row.kind === 'topic' && !entry.synthetic;
      const update = rowUpdate(row);

      if (key.return) {
        if (isTopic) {
          setTopicExpanded(entry.topic.id, !expanded.has(entry.topic.id));
          setShowDetail(true);
        } else {
          setShowDetail((prev) => !prev);
        }
        return;
      }
      if (key.rightArrow || input === 'l') {
        if (isTopic) setTopicExpanded(entry.topic.id, true);
        return;
      }
      if (key.leftArrow) {
        if (row.kind === 'item') {
          const parent = digestRows.findIndex((r) => r.kind === 'topic' && r.entry.topic.id === entry.topic.id);
          if (parent >= 0) setSelectedIndex(parent);
        }
        if (!entry.synthetic) setTopicExpanded(entry.topic.id, false);
        return;
      }
      if (input === 'x' || input === 'r') {
        void doDigestRead(row.kind === 'item' ? [row.update.id] : entry.items.map((u) => u.id));
        return;
      }
      if (input === 's') {
        if (update) void doDigestToggleSaved(update);
        else showMessage('Expand the topic to save a single update');
        return;
      }
      if (input === 'o') {
        const target = update ?? entry.items[0];
        if (target) {
          void import('open')
            .then(({ default: open }) => open(target.url))
            .catch(() => showMessage('Could not open browser'));
        }
        return;
      }
      if (input === 'n') {
        let next = -1;
        for (let i = selectedIndex + 1; i < digestRows.length && next === -1; i++) {
          if (digestRows[i]!.kind === 'topic') next = i;
        }
        if (next === -1 && digestRows.length > 0) next = 0;
        if (next >= 0) setSelectedIndex(next);
        return;
      }
      if (input === 'u') { showMessage('Digest only shows unread updates'); return; }
      return;
    }

    if (key.return) { setShowDetail((prev) => !prev); return; }

    // Actions (work in both list and detail)
    if (input === 'r') { void doMark('read');     return; }
    if (input === 'u') { void doMark('unread');   return; }
    if (input === 's') { void doToggleSaved();    return; }
    if (input === 'x') { void doReadAndNext();    return; }
    if (input === 'n') {
      // Next unread (navigate only, don't mark current)
      const items = updatesRef.current;
      const idx = selectedRef.current;
      let nextIdx = -1;
      for (let i = idx + 1; i < items.length; i++) {
        if (items[i].status === 'unread') { nextIdx = i; break; }
      }
      if (nextIdx === -1) {
        for (let i = 0; i < idx; i++) {
          if (items[i].status === 'unread') { nextIdx = i; break; }
        }
      }
      if (nextIdx !== -1) {
        setSelectedIndex(nextIdx);
        if (!showDetail) setShowDetail(true);
      } else {
        showMessage('No unread items');
      }
      return;
    }
    if (input === 'o') { void doOpen();         return; }
  });

  // ── Layout calculations ─────────────────────────────────────────────────────
  const chrome = STATUSBAR_H + FILTERBAR_H;
  const availableH = rows - chrome;
  const selectedUpdate = updates[selectedIndex];

  const renderTable = (height: number, width: number) =>
    filter === 'digest' ? (
      <DigestTable
        rows={digestRows}
        expanded={expanded}
        pending={digestPending}
        selectedIndex={selectedIndex}
        height={height}
        columns={width}
        sourceLabels={appSettings.sourceLabels}
        sourceColors={appSettings.sourceColors}
      />
    ) : (
      <UpdatesTable
        updates={updates}
        selectedIndex={selectedIndex}
        height={height}
        columns={width}
        sourceLabels={appSettings.sourceLabels}
        sourceColors={appSettings.sourceColors}
      />
    );

  const renderDetail = (height: number, width: number, position: 'bottom' | 'right') => {
    if (filter === 'digest') {
      const row = digestRows[selectedIndex];
      if (!row) return null;
      if (digestSelectedUpdate) {
        const content = digestSelectedUpdate.content || contentCache[digestSelectedUpdate.id] || '';
        const loading = !digestSelectedUpdate.content && !(digestSelectedUpdate.id in contentCache);
        return <DetailPane update={{ ...digestSelectedUpdate, content }} loading={loading} height={height} columns={width} position={position} />;
      }
      return (
        <TopicPane entry={row.entry} height={height} columns={width} position={position} sourceLabels={appSettings.sourceLabels} />
      );
    }
    return selectedUpdate ? <DetailPane update={selectedUpdate} height={height} columns={width} position={position} /> : null;
  };

  // Help overlay — replaces main content area
  if (showHelp) {
    return (
      <Box flexDirection="column" height={rows}>
        <StatusBar stats={stats} loading={loading} message={message} columns={columns} />
        <FilterBar active={filter} columns={columns} />
        <HelpOverlay context={helpContext} height={availableH} columns={columns} />
      </Box>
    );
  }

  // Todos overlay — replaces main content area
  if (showTodos) {
    return (
      <Box flexDirection="column" height={rows}>
        <StatusBar stats={stats} loading={loading} message={message} columns={columns} />
        <FilterBar active={filter} columns={columns} />
        <TodosView
          todos={todosList}
          selectedIndex={todosSelectedIndex}
          height={availableH}
          columns={columns}
          addMode={todosAddMode}
          formField={todosFormField}
          formSubject={todosFormSubject}
          formDue={todosFormDue}
          formDesc={todosFormDesc}
          message={todosMessage}
        />
      </Box>
    );
  }

  // Settings overlay — replaces main content area
  if (showSettings) {
    return (
      <Box flexDirection="column" height={rows}>
        <StatusBar stats={stats} loading={loading} message={message} columns={columns} />
        <FilterBar active={filter} columns={columns} />
        <SettingsPane
          settings={appSettings}
          sources={sources}
          focusIndex={settingsFocusIndex}
          editingLabel={editingLabel}
          labelBuffer={labelBuffer}
          height={availableH}
          columns={columns}
        />
      </Box>
    );
  }

  if (showDetail && previewPosition === 'right') {
    // Horizontal split: table on left, detail on right
    const detailW = Math.max(30, Math.floor(columns * 0.4));
    const tableW = columns - detailW - 1; // -1 for border

    return (
      <Box flexDirection="column" height={rows}>
        <StatusBar stats={stats} loading={loading} message={message} columns={columns} />
        <FilterBar active={filter} columns={columns} />
        <Box flexGrow={1} height={availableH}>
          <Box width={tableW}>
            {renderTable(availableH, tableW)}
          </Box>
          <Box borderStyle="single" borderLeft borderTop={false} borderRight={false} borderBottom={false} borderColor="gray">
            <Box width={detailW - 2}>
              {renderDetail(availableH, detailW - 2, 'right')}
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  // Default: bottom layout (original)
  const detailH = showDetail ? Math.max(6, Math.floor(availableH * 0.4)) : 0;
  const tableH = availableH - detailH;

  return (
    <Box flexDirection="column" height={rows}>
      <StatusBar stats={stats} loading={loading} message={message} columns={columns} />
      <FilterBar active={filter} columns={columns} />
      {renderTable(tableH, columns)}
      {showDetail && renderDetail(detailH, columns, 'bottom')}
    </Box>
  );
}
