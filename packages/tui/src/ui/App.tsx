import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Box, useInput, useApp } from 'ink';
import type { Update, Status, StatsResponse, PreviewPosition, SourceInfo, AppSettings, Todo, TodoStatus, DigestEntry, DigestRow, SourceFetchResult } from '@fomo/core';
import { DEFAULT_SETTINGS, buildConnectLink, flattenDigest, removeAndAdvance, soloUpdate } from '@fomo/core';
import { FomoDirectService } from '@fomo/core/service';
import type { DigestResult } from '@fomo/core/digest';
import { DEFAULT_BACKUP_DIR, DEFAULT_LINK_DAYS, envSource, tildify, type LocalConfig } from '../config.js';
import { buildSettingsRows, editStartValue, findRow, firstFocusable, moveFocus, parseConfigEdit, type SettingsRow } from './settings.js';
import { copyToClipboard } from './clipboard.js';
import { LinkOverlay, type LinkView } from './components/LinkOverlay.js';
import { RestorePicker, type BackupFile } from './components/RestorePicker.js';
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

export interface DigestRunOptions {
  /** Forget all topics and regroup every unread update. */
  reset?: boolean;
}

interface Props {
  service: FomoDirectService;
  /** Effective local config (file + environment). */
  config: LocalConfig;
  /** Save a local config change; returns an error message on failure. */
  onConfigChange(patch: Partial<LocalConfig>): string | undefined;
  /** Group unread updates with Copilot (runs after an `f`/`F` fetch). */
  digest?(onProgress: (message: string) => void, options?: DigestRunOptions): Promise<DigestResult>;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The update a digest row points at (items and single-update topics), if any. */
function rowUpdate(row: DigestRow | undefined): Update | undefined {
  if (!row) return undefined;
  if (row.kind === 'item') return row.update;
  return soloUpdate(row.entry);
}

// Fixed line counts for chrome
const STATUSBAR_H = 2; // content + border line
const FILTERBAR_H = 1;

export function App({ service, config, onConfigChange, digest }: Props) {
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
  const settingsRows = useMemo(() => buildSettingsRows(sources), [sources]);
  /** Key of the config row being edited (source label or local setting). */
  const [editingKey, setEditingKey] = useState<string | undefined>();
  const [editBuffer, setEditBuffer] = useState('');
  /** Key of the action row waiting for a second ↵. */
  const [confirmKey, setConfirmKey] = useState<string | undefined>();
  const [lastFetch, setLastFetch] = useState<Record<string, SourceFetchResult>>({});
  const [linkView, setLinkView] = useState<LinkView | undefined>();
  const [restoreFiles, setRestoreFiles] = useState<BackupFile[] | undefined>();
  const [restoreIndex, setRestoreIndex] = useState(0);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  /** Only show updates from this source (list views). */
  const [sourceFilter, setSourceFilter] = useState<string | undefined>();
  const sourceFilterRef = useRef<string | undefined>();
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
        const source = sourceFilterRef.current;
        const opts = f === 'saved'
          ? { saved: true, source, limit: 200 }
          : { status: f as Status | 'all', source, limit: 200 };
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

  const sourceName = useCallback(
    (id: string) => appSettings.sourceLabels[id] || sources.find((s) => s.id === id)?.displayName || id,
    [appSettings.sourceLabels, sources],
  );

  // One fetch / regroup / restore at a time; a second digest run would plan the same items twice.
  const busyRef = useRef(false);
  const claimBusy = useCallback(() => {
    if (busyRef.current) {
      showMessage('⏳ Still busy — wait for the current run to finish');
      return false;
    }
    busyRef.current = true;
    setLoading(true);
    return true;
  }, [showMessage]);
  const releaseBusy = useCallback(() => {
    busyRef.current = false;
    setLoading(false);
  }, []);

  /** Fetch every enabled source, or only `only` (even if disabled), then group with Copilot. */
  const doFetch = useCallback(async (only?: string[]) => {
    if (!claimBusy()) return;
    showMessage(`Fetching ${only ? only.map(sourceName).join(', ') : 'latest updates'}…`, 600_000);
    try {
      const resp = await service.fetch(only ? { sources: only } : {});
      setLastFetch((prev) => ({ ...prev, ...resp.results }));
      const failed = Object.entries(resp.results).filter(([, r]) => r.error).map(([id]) => sourceName(id));
      const failedNote = failed.length ? ` · ⚠ ${failed.join(', ')} failed` : '';
      const added = `✓ Added ${resp.added} update${resp.added !== 1 ? 's' : ''}${failedNote}`;
      if (digest && config.autoDigest !== false) {
        showMessage(`${added} · summarising with Copilot…`, 600_000);
        await refresh();
        const result = await digest((msg) => showMessage(msg, 600_000));
        const errs = result.errors.length ? ` · ⚠ ${result.errors.length} failed` : '';
        showMessage(`${added} · grouped ${result.processed} into topics${errs}`, 5000);
      } else {
        showMessage(added, failed.length ? 5000 : 2500);
      }
      await refresh();
    } catch (err) {
      showMessage(`Fetch error: ${errorText(err)}`, 5000);
    } finally {
      releaseBusy();
    }
  }, [service, digest, config.autoDigest, refresh, showMessage, sourceName, claimBusy, releaseBusy]);

  /** Forget all topics and regroup every unread update. */
  const doRegroup = useCallback(async () => {
    if (!digest || !claimBusy()) return;
    showMessage('Regrouping all unread updates with Copilot…', 600_000);
    try {
      const result = await digest((msg) => showMessage(msg, 600_000), { reset: true });
      const errs = result.errors.length ? ` · ⚠ ${result.errors.length} failed` : '';
      const left = result.remaining ? ` · ${result.remaining} left for next time` : '';
      showMessage(`✓ Regrouped ${result.processed} update${result.processed !== 1 ? 's' : ''} into ${result.created} topics${left}${errs}`, 6000);
      await refresh();
    } catch (err) {
      showMessage(`Regroup error: ${errorText(err)}`, 6000);
    } finally {
      releaseBusy();
    }
  }, [digest, refresh, showMessage, claimBusy, releaseBusy]);

  const backupDir = config.backupDir ?? DEFAULT_BACKUP_DIR;

  const doBackup = useCallback(async () => {
    showMessage('Backing up updates…', 600_000);
    try {
      const payload = await service.backup();
      await mkdir(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = join(backupDir, `fomo-backup-${stamp}.json`);
      await writeFile(file, JSON.stringify(payload, null, 2));
      showMessage(`✓ Backed up ${payload.count} update${payload.count !== 1 ? 's' : ''} → ${tildify(file)}`, 6000);
    } catch (err) {
      showMessage(`Backup error: ${errorText(err)}`, 6000);
    }
  }, [service, backupDir, showMessage]);

  const openRestore = useCallback(async () => {
    let names: string[];
    try {
      names = (await readdir(backupDir)).filter((n) => n.endsWith('.json'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        showMessage(`Can’t read ${tildify(backupDir)}: ${errorText(err)}`, 6000);
        return;
      }
      names = [];
    }
    const files = await Promise.all(names.map(async (name) => {
      const path = join(backupDir, name);
      const s = await stat(path);
      return { name, path, size: s.size, mtime: s.mtime };
    }));
    if (files.length === 0) {
      showMessage(`No backups in ${tildify(backupDir)} — use “Back up updates” first`, 5000);
      return;
    }
    files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    setRestoreFiles(files);
    setRestoreIndex(0);
    setRestoreConfirm(false);
  }, [backupDir, showMessage]);

  const doRestore = useCallback(async (file: BackupFile) => {
    if (!claimBusy()) return;
    setRestoreFiles(undefined);
    setRestoreConfirm(false);
    showMessage(`Restoring ${file.name}…`, 600_000);
    try {
      const payload = JSON.parse(await readFile(file.path, 'utf-8'));
      if (!payload?.version || !Array.isArray(payload.entities)) throw new Error('not a FOMO backup file');
      const restored = await service.restore(payload);
      showMessage(`✓ Restored ${restored} update${restored !== 1 ? 's' : ''} from ${file.name}`, 6000);
      await refresh();
    } catch (err) {
      showMessage(`Restore error: ${errorText(err)}`, 6000);
    } finally {
      releaseBusy();
    }
  }, [service, refresh, showMessage, claimBusy, releaseBusy]);

  /** Create a magic link (account SAS in the URL fragment) for the web app and show it as a QR code. */
  const doLink = useCallback(async () => {
    if (!config.webUrl) {
      setSettingsFocusIndex(findRow(settingsRows, 'c-webUrl'));
      showMessage('Set “Web app URL” first (deploy.sh prints it), then link again', 6000);
      return;
    }
    try {
      const { createWebSas } = await import('@fomo/core/store/sas');
      const conn = createWebSas(config.connectionString ?? '', { days: config.linkDays ?? DEFAULT_LINK_DAYS });
      const url = buildConnectLink(config.webUrl, conn);
      const { default: qrcode } = await import('qrcode-terminal');
      const qr = await new Promise<string>((resolve) => qrcode.generate(url, { small: true }, resolve));
      setLinkView({ url, expiresOn: conn.expiresOn, qr });
    } catch (err) {
      showMessage(`Can’t create a link: ${errorText(err)}`, 6000);
    }
  }, [config.webUrl, config.connectionString, config.linkDays, settingsRows, showMessage]);

  const applySourceFilter = useCallback((id: string | undefined, f: FilterStatus = filterRef.current) => {
    sourceFilterRef.current = id;
    setSourceFilter(id);
    setFilter(f);
    setSelectedIndex(0);
    setShowDetail(false);
    void refresh(f);
  }, [refresh]);

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

  // ── Settings: save the row being edited ─────────────────────────────────────
  const commitEdit = useCallback((row: SettingsRow, text: string) => {
    const stopEditing = () => { setEditingKey(undefined); setEditBuffer(''); };

    if (row.kind === 'source') {
      const sourceId = row.source.id;
      const label = text.trim();
      const newLabels = { ...appSettings.sourceLabels, [sourceId]: label };
      // An empty label (or the id itself) resets to the default
      if (label === '' || label === sourceId) delete newLabels[sourceId];
      setAppSettings((prev) => ({ ...prev, sourceLabels: newLabels }));
      void service.updateSettings({ sourceLabels: newLabels })
        .then((s) => setAppSettings(s))
        .catch((err) => showMessage(`Error: ${errorText(err)}`));
      stopEditing();
      return;
    }
    if (row.kind !== 'config') return;

    const parsed = parseConfigEdit(row.field, text);
    if ('error' in parsed) { showMessage(`⚠ ${parsed.error}`, 4000); return; }
    stopEditing();

    const save = () => {
      const err = onConfigChange(parsed.patch);
      if (err) { showMessage(`⚠ Could not save: ${err}`, 6000); return; }
      const env = envSource(row.field);
      showMessage(env ? `✓ Saved, but ${env} is set and takes precedence` : `✓ Saved ${row.label.toLowerCase()}`, env ? 6000 : 2500);
    };

    if (row.field === 'connectionString' && parsed.patch.connectionString) {
      // Check the new account before switching to it; the app reloads with the new data.
      const connectionString = parsed.patch.connectionString;
      showMessage('Checking the connection…', 60_000);
      void (async () => {
        try {
          await new FomoDirectService(connectionString).getStats();
        } catch (err) {
          showMessage(`⚠ Can’t connect, not saved: ${errorText(err)}`, 8000);
          return;
        }
        save();
      })();
      return;
    }
    save();
  }, [service, appSettings.sourceLabels, onConfigChange, showMessage]);

  const updateRemoteSettings = useCallback((patch: Partial<AppSettings>) => {
    setAppSettings((prev) => ({ ...prev, ...patch }));
    void service.updateSettings(patch)
      .then((s) => setAppSettings(s))
      .catch((err) => showMessage(`Error: ${errorText(err)}`));
  }, [service, showMessage]);

  // ── Input handler ───────────────────────────────────────────────────────────
  useInput((input, key) => {
    // ── Quit from any screen (but not while typing) ──
    if (input === 'q' && !editingKey && !todosAddMode) { exit(); return; }

    // ── Help overlay — Esc or h to close, consume all other input ──
    if (showHelp) {
      if (key.escape || key.backspace || key.delete || input === 'h') setShowHelp(false);
      return;
    }

    // ── Link a device overlay ──
    if (linkView) {
      if (key.escape || key.backspace || key.delete) {
        setLinkView(undefined);
      } else if (input === 'o') {
        void import('open')
          .then(({ default: open }) => open(linkView.url))
          .catch(() => showMessage('Could not open browser'));
      } else if (input === 'y') {
        copyToClipboard(linkView.url);
        showMessage('✓ Link copied');
      }
      return;
    }

    // ── Restore picker ──
    if (restoreFiles) {
      if (key.escape || key.backspace || key.delete) {
        if (restoreConfirm) setRestoreConfirm(false);
        else setRestoreFiles(undefined);
        return;
      }
      if (key.upArrow || input === 'k') { setRestoreIndex((i) => Math.max(0, i - 1)); setRestoreConfirm(false); return; }
      if (key.downArrow || input === 'j') { setRestoreIndex((i) => Math.min(restoreFiles.length - 1, i + 1)); setRestoreConfirm(false); return; }
      if (key.return) {
        const file = restoreFiles[restoreIndex];
        if (!restoreConfirm) setRestoreConfirm(true);
        else if (file) void doRestore(file);
      }
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
      const row = settingsRows[settingsFocusIndex];

      // Typing into a source label or local setting
      if (editingKey) {
        const editRow = settingsRows.find((r) => r.key === editingKey);
        if (key.escape) { setEditingKey(undefined); setEditBuffer(''); return; }
        if (key.return) { if (editRow) commitEdit(editRow, editBuffer); return; }
        if (key.backspace || key.delete) { setEditBuffer((b) => b.slice(0, -1)); return; }
        // Pasted text arrives in one chunk; drop line breaks
        if (input && !key.ctrl && !key.meta) setEditBuffer((b) => b + input.replace(/[\r\n]/g, ''));
        return;
      }

      if (key.escape && confirmKey) { setConfirmKey(undefined); return; }
      if (key.escape || key.backspace || key.delete || input === 'c') {
        setShowSettings(false);
        setConfirmKey(undefined);
        return;
      }
      if (key.upArrow || input === 'k') { setSettingsFocusIndex((i) => moveFocus(settingsRows, i, -1)); setConfirmKey(undefined); return; }
      if (key.downArrow || input === 'j') { setSettingsFocusIndex((i) => moveFocus(settingsRows, i, 1)); setConfirmKey(undefined); return; }
      if (input === 'h') {
        setHelpContext('settings');
        setShowHelp(true);
        return;
      }
      if (!row) return;

      if (row.kind === 'source') {
        const sourceId = row.source.id;
        if (key.return) {
          const disabled = new Set(appSettings.disabledSources);
          if (disabled.has(sourceId)) disabled.delete(sourceId);
          else disabled.add(sourceId);
          updateRemoteSettings({ disabledSources: [...disabled] });
        } else if (input === 'e') {
          setEditBuffer(appSettings.sourceLabels[sourceId] ?? '');
          setEditingKey(row.key);
        } else if (input === 'd') {
          const currentColor = appSettings.sourceColors?.[sourceId] || COLOR_PALETTE[0];
          const nextColor = COLOR_PALETTE[(COLOR_PALETTE.indexOf(currentColor) + 1) % COLOR_PALETTE.length];
          updateRemoteSettings({ sourceColors: { ...appSettings.sourceColors, [sourceId]: nextColor } });
        } else if (input === 'f' || input === 'F') {
          void doFetch([sourceId]);
        } else if (input === 'v') {
          setShowSettings(false);
          applySourceFilter(sourceId, filterRef.current === 'digest' ? 'all' : filterRef.current);
        }
        return;
      }

      if (row.kind === 'preview') {
        if (key.return) {
          const next = PREVIEW_OPTIONS[(PREVIEW_OPTIONS.indexOf(appSettings.previewPosition) + 1) % PREVIEW_OPTIONS.length]!;
          if (next !== 'off') setPreviewPosition(next);
          updateRemoteSettings({ previewPosition: next });
        }
        return;
      }

      if (row.kind === 'config') {
        if (!key.return && input !== 'e') return;
        if (row.field === 'autoDigest') {
          const err = onConfigChange({ autoDigest: config.autoDigest === false ? undefined : false });
          if (err) showMessage(`⚠ Could not save: ${err}`, 6000);
          return;
        }
        setEditBuffer(editStartValue(row.field));
        setEditingKey(row.key);
        return;
      }

      if (row.kind === 'action' && key.return) {
        switch (row.action) {
          case 'link': void doLink(); break;
          case 'backup': void doBackup(); break;
          case 'restore': void openRestore(); break;
          case 'regroup':
            if (confirmKey !== row.key) { setConfirmKey(row.key); break; }
            setConfirmKey(undefined);
            void doRegroup();
            break;
        }
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

    // Esc clears a source filter (set with v in config)
    if (key.escape && sourceFilter) {
      applySourceFilter(undefined);
      showMessage('Showing all sources');
      return;
    }

    // Open settings
    if (input === 'c') {
      setShowSettings(true);
      setSettingsFocusIndex(firstFocusable(settingsRows));
      setConfirmKey(undefined);
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
      // The digest covers every source, so it drops a source filter
      if (f === 'digest' && sourceFilterRef.current) { applySourceFilter(undefined, f); return; }
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
      const isGroup = entry.items.length > 1;
      const isTopic = row.kind === 'topic' && isGroup;
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
        if (isGroup) setTopicExpanded(entry.topic.id, false);
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
  const filterBar = (
    <FilterBar active={filter} columns={columns} sourceLabel={sourceFilter ? sourceName(sourceFilter) : undefined} />
  );

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
        {filterBar}
        <HelpOverlay context={helpContext} height={availableH} columns={columns} />
      </Box>
    );
  }

  if (linkView) {
    return (
      <Box flexDirection="column" height={rows}>
        <StatusBar stats={stats} loading={loading} message={message} columns={columns} />
        {filterBar}
        <LinkOverlay link={linkView} height={availableH} columns={columns} />
      </Box>
    );
  }

  if (restoreFiles) {
    return (
      <Box flexDirection="column" height={rows}>
        <StatusBar stats={stats} loading={loading} message={message} columns={columns} />
        {filterBar}
        <RestorePicker
          dir={backupDir}
          files={restoreFiles}
          focusIndex={restoreIndex}
          confirming={restoreConfirm}
          height={availableH}
          columns={columns}
        />
      </Box>
    );
  }

  // Todos overlay — replaces main content area
  if (showTodos) {
    return (
      <Box flexDirection="column" height={rows}>
        <StatusBar stats={stats} loading={loading} message={message} columns={columns} />
        {filterBar}
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
        {filterBar}
        <SettingsPane
          rows={settingsRows}
          settings={appSettings}
          config={config}
          stats={stats}
          lastFetch={lastFetch}
          focusIndex={settingsFocusIndex}
          editBuffer={editingKey ? editBuffer : undefined}
          confirmKey={confirmKey}
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
        {filterBar}
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
      {filterBar}
      {renderTable(tableH, columns)}
      {showDetail && renderDetail(detailH, columns, 'bottom')}
    </Box>
  );
}
