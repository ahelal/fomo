import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Box, useInput, useApp } from 'ink';
import type { Update, Status, StatsResponse, PreviewPosition, SourceInfo, AppSettings, Todo, TodoStatus, DigestEntry, DigestRow, SourceFetchResult, ReferenceSuggestion, TodoSort, TopicSort, UpdateSort } from '@fomo/core';
import { DEFAULT_SETTINGS, addSourcePatch, buildConnectLink, newUserSource, removeSourcePatch, restoreSourcesPatch, retiredSources, forgetSourcePatch, sourceDraft, sourceDraftPatch, sourceInfos, userSource, flattenDigest, isDefaultSort, jumpStep, nextRowKey, nextSort, sortDigestEntries, sortLabel, sortTodos, TODO_SORTS, TOPIC_SORTS, updateSorts, patchDigest, removeAndAdvance, searchTerms, shortcutKey, soloUpdate } from '@fomo/core';
import { FomoDirectService, type PostGistResult, type SuggestReferenceRequest } from '@fomo/core/service';
import type { DigestResult } from '@fomo/core/digest';
import { AUDIT_FILE, autoFetchInterval, DEFAULT_BACKUP_DIR, DEFAULT_LINK_DAYS, envSource, maskConnectionString, tildify, type LocalConfig } from '../config.js';
import { createMemoryAuditLog, type AuditLog } from '../audit.js';
import { listGhAccounts, type GhAccount } from '../ghAccounts.js';
import { AuditView } from './components/AuditView.js';
import { automaticAccount, buildSettingsRows, editStartValue, findRow, firstFocusable, isPickerField, isToggleField, moveFocus, parseConfigEdit, sectionHeaderIndex, sectionOf, settingsRowText, type AddSourceDraft, type SettingsRow } from './settings.js';
import { copyToClipboard } from './clipboard.js';
import { AccountPicker, accountOptions } from './components/AccountPicker.js';
import { SourceDetailsPane, detailsFields, type SourceDetailsState } from './components/SourceDetailsPane.js';
import { LinkOverlay, type LinkView } from './components/LinkOverlay.js';
import { RestorePicker, type BackupFile } from './components/RestorePicker.js';
import { SourcePicker, type SourceOption } from './components/SourcePicker.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { useAutoFetch } from './hooks/useAutoFetch.js';
import { UpdatesTable, DEFAULT_SOURCE_COLOR } from './components/UpdatesTable.js';
import { DigestTable } from './components/DigestTable.js';
import { StatusBar, type Activity } from './components/StatusBar.js';
import { DetailPane } from './components/DetailPane.js';
import { TopicPane } from './components/TopicPane.js';
import { HelpOverlay, type HelpContext } from './components/HelpOverlay.js';
import { FilterBar } from './components/FilterBar.js';
import { SettingsPane, PREVIEW_OPTIONS, COLOR_PALETTE } from './components/SettingsPane.js';
import { TodosView, type TodoFormField } from './components/TodosView.js';
import { ReferencesView } from './components/ReferencesView.js';
import { editText, useReferences } from './hooks/useReferences.js';

type FilterStatus = Status | 'all' | 'saved';
/** Views that can be listed as topics; pressing the view's key again toggles it. */
type GroupableView = 'unread' | 'saved';
type GroupedViews = Record<GroupableView, boolean>;
const canGroup = (f: FilterStatus): f is GroupableView => f === 'unread' || f === 'saved';
const isGrouped = (f: FilterStatus, g: GroupedViews) => canGroup(f) && g[f];
const VIEW_ORDER = ['all', 'unread', 'read', 'saved', 'refs', 'todos'] as const;

/** Sort of each view (cycled with s); kept for the session only. */
interface ViewSorts {
  list: Partial<Record<FilterStatus, UpdateSort>>;
  topics: Partial<Record<GroupableView, TopicSort>>;
  todos?: TodoSort;
}

export interface DigestRunOptions {
  /** Forget all topics and regroup every unread and saved update. */
  reset?: boolean;
}

interface Props {
  service: FomoDirectService;
  /** Effective local config (file + environment). */
  config: LocalConfig;
  /** Save a local config change; returns an error message on failure. */
  onConfigChange(patch: Partial<LocalConfig>): string | undefined;
  /** Group unread and saved updates with Copilot (runs after an `f` fetch). */
  digest?(onProgress: (message: string) => void, options?: DigestRunOptions): Promise<DigestResult>;
  /** Summarise a post with Copilot and save it (`g`); `force` regenerates a saved one (`g` again). */
  summarize?(id: string, force?: boolean): Promise<PostGistResult>;
  /** Ask Copilot where to file a link in References and how to describe it. */
  suggestReference?(req: SuggestReferenceRequest): Promise<ReferenceSuggestion>;
  /** Audit trail of actions and errors (viewed with `a`); in-memory when omitted. */
  audit?: AuditLog;
  /** Where `audit` is stored (shown in the audit view). */
  auditFile?: string;
  /** gh CLI accounts offered for Config → Copilot account. */
  listAccounts?(): Promise<GhAccount[]>;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** Audit text for a local config change; the connection string's secret is masked. */
const describeConfig = (patch: Partial<LocalConfig>) =>
  Object.entries(patch)
    .map(([field, value]) => `${field} = ${
      value === undefined ? '(default)'
        : field === 'connectionString' ? maskConnectionString(String(value))
          : typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value)}`)
    .join(', ');
const BUSY_MESSAGE = '⏳ Still busy — wait for the current run to finish';
/** How long the first `z` waits for the second one before the regroup prompt expires. */
export const REGROUP_CONFIRM_MS = 5000;

/** The update a digest row points at (items and single-update topics), if any. */
function rowUpdate(row: DigestRow | undefined): Update | undefined {
  if (!row) return undefined;
  if (row.kind === 'item') return row.update;
  return soloUpdate(row.entry);
}

// Fixed line counts for chrome
const STATUSBAR_H = 2; // content + border line
const FILTERBAR_H = 1;

export function App({ service, config, onConfigChange, digest, summarize, suggestReference, audit: auditProp, auditFile = AUDIT_FILE, listAccounts = listGhAccounts }: Props) {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const audit = useMemo(() => auditProp ?? createMemoryAuditLog(), [auditProp]);

  const [updates, setUpdates] = useState<Update[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState<FilterStatus>('unread');
  /** Unread and Saved start grouped by topic. */
  const [groupedViews, setGroupedViews] = useState<GroupedViews>({ unread: true, saved: true });
  const groupedViewsRef = useRef(groupedViews);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  /** Background job (fetch / Copilot digest / restore) shown with a spinner until it ends. */
  const [activity, setActivity] = useState<Activity | undefined>();
  const [digesting, setDigesting] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [stats, setStats] = useState<StatsResponse | undefined>();
  const [previewPosition, setPreviewPosition] = useState<PreviewPosition>('bottom');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsFocusIndex, setSettingsFocusIndex] = useState(0);
  const [appSettings, setAppSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS });
  const sources = useMemo<SourceInfo[]>(() => sourceInfos(appSettings), [appSettings]);
  const removedCount = appSettings.removedSources?.length ?? 0;
  /** Removed sources whose updates are still stored. */
  const retired = useMemo<SourceInfo[]>(() => retiredSources(appSettings, stats?.bySource), [appSettings, stats?.bySource]);
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<string>>(() => new Set());
  /** `/` filter of the config screen (and whether it is being typed). */
  const [settingsSearch, setSettingsSearch] = useState('');
  const [settingsSearchTyping, setSettingsSearchTyping] = useState(false);
  /** `/` filter of the help screen (and whether it is being typed). */
  const [helpSearch, setHelpSearch] = useState('');
  const [helpSearchTyping, setHelpSearchTyping] = useState(false);
  const settingsRows = useMemo(() => {
    const terms = searchTerms(settingsSearch);
    const matches = terms.length === 0 ? undefined : (row: SettingsRow) => {
      const text = settingsRowText(row, config, (id) => appSettings.sourceLabels[id] ?? '').toLowerCase();
      return terms.every((t) => text.includes(t));
    };
    return buildSettingsRows(sources, collapsedSections, matches, removedCount, retired);
  }, [sources, collapsedSections, settingsSearch, config, appSettings.sourceLabels, removedCount, retired]);

  /** Collapse or expand a config section; the focus stays on its header. */
  const setSectionCollapsed = useCallback((header: string, collapsed: boolean) => {
    setCollapsedSections((prev) => {
      if (prev.has(header) === collapsed) return prev;
      const next = new Set(prev);
      if (collapsed) next.add(header);
      else next.delete(header);
      return next;
    });
  }, []);

  /** Focus a config row, clearing the search and expanding its section first. */
  const focusSettingsRow = useCallback((key: string) => {
    const section = sectionOf(sources, key);
    const collapsed = new Set(collapsedSections);
    if (section) collapsed.delete(section);
    setSettingsSearch('');
    setSettingsSearchTyping(false);
    setCollapsedSections(collapsed);
    setSettingsFocusIndex(Math.max(0, findRow(buildSettingsRows(sources, collapsed, undefined, removedCount, retired), key)));
  }, [sources, collapsedSections, removedCount, retired]);
  /** Key of the config row being edited (source label or local setting). */
  const [editingKey, setEditingKey] = useState<string | undefined>();
  const [editBuffer, setEditBuffer] = useState('');
  /** Key of the action row waiting for a second ↵. */
  const [confirmKey, setConfirmKey] = useState<string | undefined>();
  /** Answers so far while adding a source (the current step is typed into `editBuffer`). */
  const [addDraft, setAddDraft] = useState<AddSourceDraft | undefined>();
  /** Details popup of a source (↵ on a source in the config). */
  const [sourceDetails, setSourceDetails] = useState<SourceDetailsState | undefined>();
  const detailsSource = sourceDetails && (sources.find((s) => s.id === sourceDetails.id) ?? retired.find((s) => s.id === sourceDetails.id));
  const detailsChanged = !!sourceDetails && JSON.stringify(sourceDetails.draft) !== JSON.stringify(sourceDraft(appSettings, sourceDetails.id));
  const [lastFetch, setLastFetch] = useState<Record<string, SourceFetchResult>>({});
  /** When the last fetch (manual or automatic) finished. */
  const [lastFetchAt, setLastFetchAt] = useState<number | undefined>();
  const [linkView, setLinkView] = useState<LinkView | undefined>();
  const [restoreFiles, setRestoreFiles] = useState<BackupFile[] | undefined>();
  const [restoreIndex, setRestoreIndex] = useState(0);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  /** Config → Copilot account picker; `accounts` is undefined while gh lists them. */
  const [accountPicker, setAccountPicker] = useState<{ accounts?: GhAccount[]; error?: string; focus: number } | undefined>();
  const accountPickerSeq = useRef(0);
  /** Only show updates from these sources (every view); undefined shows all. */
  const [sourceFilter, setSourceFilter] = useState<string[] | undefined>();
  const sourceFilterRef = useRef<string[] | undefined>();
  /** Source picker opened with v. */
  const [sourcePicker, setSourcePicker] = useState<{
    options?: SourceOption[];
    checked: ReadonlySet<string>;
    focus: number;
    warning?: string;
  } | undefined>();
  const sourcePickerSeq = useRef(0);
  /** Applied search; it narrows whichever view is shown. */
  const [search, setSearch] = useState('');
  const searchRef = useRef('');
  /** Search prompt being typed (opened with /). */
  const [searchDraft, setSearchDraft] = useState<string | undefined>();
  /** Updates in the current list view, before the 200-row limit. */
  const [listTotal, setListTotal] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [helpContext, setHelpContext] = useState<HelpContext>('list');

  const [sorts, setSorts] = useState<ViewSorts>({ list: {}, topics: {} });
  const sortsRef = useRef(sorts);
  /** Update to keep selected when the list reloads in a new order. */
  const keepSelectedId = useRef<string | undefined>();

  // ── Digest state ────────────────────────────────────────────────────────────
  const [digestEntries, setDigestEntries] = useState<DigestEntry[]>([]);
  const [digestPending, setDigestPending] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Digest lists skip `content`; it is loaded on demand for the detail pane.
  const [contentCache, setContentCache] = useState<Record<string, string>>({});
  /** Posts being summarised with Copilot (g, and g again to regenerate). */
  const [summarizing, setSummarizing] = useState<ReadonlySet<string>>(new Set());
  const summarizingRef = useRef(new Set<string>());
  /** The update whose saved summary g just showed: g again on it regenerates the summary. */
  const regenArmed = useRef<{ id: string; at: number } | undefined>();
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

  // ── Audit trail view (a) ────────────────────────────────────────────────────
  const [showAudit, setShowAudit] = useState(false);
  const [auditIndex, setAuditIndex] = useState(0);
  const [auditErrorsOnly, setAuditErrorsOnly] = useState(false);
  const [auditVersion, setAuditVersion] = useState(0);
  useEffect(() => {
    if (!showAudit) return;
    return audit.subscribe(() => setAuditVersion((v) => v + 1));
  }, [audit, showAudit]);
  const auditEntries = useMemo(
    () => (showAudit ? audit.recent(1000).filter((e) => !auditErrorsOnly || e.level === 'error') : []),
    [audit, showAudit, auditErrorsOnly, auditVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    setAuditIndex((i) => Math.min(i, Math.max(0, auditEntries.length - 1)));
  }, [auditEntries.length]);

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

  /** Audit text for updates: the title of one, or a count and the first title. */
  const describeIds = useCallback((ids: string[]) => {
    const titleOf = (id: string) =>
      (updatesRef.current.find((u) => u.id === id)
        ?? digestEntriesRef.current.flatMap((e) => e.items).find((u) => u.id === id))?.title ?? id;
    if (ids.length === 0) return 'nothing';
    return ids.length === 1 ? `“${titleOf(ids[0]!)}”` : `${ids.length} updates (“${titleOf(ids[0]!)}”, …)`;
  }, []);

  const grouped = isGrouped(filter, groupedViews);
  const listLength = grouped ? digestRows.length : updates.length;
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, listLength - 1)));
  }, [listLength]);

  // Load remote settings and sources on mount
  useEffect(() => {
    service.getSettings().then((s) => {
      setAppSettings(s);
      const pos = s.previewPosition === 'off' ? 'bottom' : s.previewPosition;
      setPreviewPosition(pos as 'right' | 'bottom');
    }).catch((err) => audit.error('settings', `load: ${errorText(err)}`));
  }, [service, audit]);

  const messageTimer = useRef<ReturnType<typeof setTimeout>>();
  const showMessage = useCallback((msg: string, ms = 2500) => {
    setMessage(msg);
    clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(undefined), ms);
  }, []);

  const refs = useReferences({
    service,
    audit,
    suggest: suggestReference,
    notify: showMessage,
    openUrl: async (url) => { const { default: open } = await import('open'); await open(url); },
    copy: copyToClipboard,
    jump: jumpStep(rows),
  });

  const loadSeq = useRef(0);
  const loadUpdates = useCallback(
    async (f: FilterStatus) => {
      // Searches are slower full scans; drop responses superseded by a newer load.
      const seq = ++loadSeq.current;
      setLoading(true);
      try {
        const search = searchRef.current || undefined;
        const sources = sourceFilterRef.current;
        if (isGrouped(f, groupedViewsRef.current)) {
          const resp = await service.getDigest({ search, sources, saved: f === 'saved' });
          if (seq !== loadSeq.current) return;
          setDigestEntries(sortDigestEntries(resp.entries, sortsRef.current.topics[f as GroupableView]));
          setDigestPending(resp.pending);
          return;
        }
        const sort = sortsRef.current.list[f];
        const resp = await service.listUpdates(f === 'saved'
          ? { saved: true, sources, search, sort, limit: 200 }
          : { status: f, sources, search, sort, limit: 200 });
        if (seq !== loadSeq.current) return;
        setUpdates(resp.updates);
        setListTotal(resp.total);
        const keep = keepSelectedId.current;
        keepSelectedId.current = undefined;
        const kept = keep ? resp.updates.findIndex((u) => u.id === keep) : -1;
        setSelectedIndex((i) => (kept >= 0 ? kept : Math.min(i, Math.max(0, resp.updates.length - 1))));
      } catch (err) {
        if (seq !== loadSeq.current) return;
        audit.error('load', `${f} view: ${errorText(err)}`);
        showMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [service, showMessage, audit],
  );

  const loadStats = useCallback(async () => {
    try {
      const s = await service.getStats();
      setStats(s);
    } catch (err) {
      // non-critical
      audit.error('stats', errorText(err));
    }
  }, [service, audit]);

  const loadTodos = useCallback(async () => {
    try {
      const resp = await service.listTodos();
      setTodosList(sortTodos(resp.todos, sortsRef.current.todos));
      setTodosSelectedIndex((i) => Math.min(i, Math.max(0, resp.todos.length - 1)));
    } catch (err) {
      // non-critical
      audit.error('todo', `load: ${errorText(err)}`);
    }
  }, [service, audit]);

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
    if (isGrouped(filterRef.current, groupedViewsRef.current)) return rowUpdate(digestRowsRef.current[selectedRef.current]);
    return updatesRef.current[selectedRef.current];
  }, []);

  const sourceName = useCallback(
    (id: string) => appSettings.sourceLabels[id] || sources.find((s) => s.id === id)?.displayName || id,
    [appSettings.sourceLabels, sources],
  );

  // One fetch / regroup / restore at a time; a second digest run would plan the same items twice.
  // The job shows in the status bar (spinner, label, elapsed time) until it is released, so
  // transient messages and list reloads in the meantime can't hide that it's still running.
  const busyRef = useRef(false);
  const claimBusy = useCallback((label: string) => {
    if (busyRef.current) {
      showMessage(BUSY_MESSAGE);
      return false;
    }
    busyRef.current = true;
    setActivity({ label, startedAt: Date.now() });
    return true;
  }, [showMessage]);
  /** Starts a new phase of the current job (restarts its timer). */
  const startPhase = useCallback((label: string) => setActivity({ label, startedAt: Date.now() }), []);
  /** Updates the current phase's label (keeps its timer). */
  const updatePhase = useCallback((label: string) => {
    setActivity((a) => ({ label, startedAt: a?.startedAt ?? Date.now() }));
  }, []);
  const releaseBusy = useCallback(() => {
    busyRef.current = false;
    setActivity(undefined);
    setDigesting(false);
  }, []);

  /** Record a digest run and each of its errors. */
  const logDigest = useCallback((action: string, result: DigestResult) => {
    audit.log(action, `grouped ${result.processed} update(s): ${result.created} new topic(s), ${result.updated} updated, ${result.remaining} left${result.errors.length ? `, ${result.errors.length} error(s)` : ''}`);
    for (const e of result.errors) audit.error(action, e);
  }, [audit]);

  /** Fetch every enabled source, or only `only` (even if disabled), then group with Copilot. */
  const doFetch = useCallback(async (only?: string[], auto = false) => {
    const what = only ? only.map(sourceName).join(', ') : 'latest updates';
    const action = auto ? 'auto-fetch' : 'fetch';
    if (!claimBusy(`${auto ? 'Auto-fetching' : 'Fetching'} ${what}…`)) {
      return;
    }
    try {
      let resp: Awaited<ReturnType<typeof service.fetch>>;
      try {
        resp = await service.fetch(only ? { sources: only } : {});
      } catch (err) {
        audit.error(action, `${what}: ${errorText(err)}`);
        showMessage(`${auto ? 'Auto-fetch' : 'Fetch'} error: ${errorText(err)}`, 8000);
        return;
      }
      setLastFetchAt(Date.now());
      setLastFetch((prev) => ({ ...prev, ...resp.results }));
      const failedResults = Object.entries(resp.results).filter(([, r]) => r.error);
      const failed = failedResults.map(([id]) => sourceName(id));
      const dupCount = Object.values(resp.results).reduce((n, r) => n + (r.duplicates ?? 0), 0);
      const dupNote = dupCount ? ` · ${dupCount} duplicate${dupCount !== 1 ? 's' : ''} skipped` : '';
      audit.log(action, `${what}: added ${resp.added} from ${Object.keys(resp.results).length} source(s)${dupNote}${failed.length ? `, ${failed.length} failed` : ''}`);
      for (const [id, r] of failedResults) audit.error(action, `${sourceName(id)}: ${r.error}`);
      const failedNote = failed.length ? ` · ⚠ ${failed.join(', ')} failed` : '';
      const added = `✓ ${auto ? 'Auto-fetch: added' : 'Added'} ${resp.added} update${resp.added !== 1 ? 's' : ''}${dupNote}${failedNote}`;
      if (!digest || config.autoDigest === false) {
        showMessage(added, failed.length ? 6000 : 3000);
        await refresh();
        return;
      }

      // Show the new updates (ungrouped) right away, then group them in the background.
      showMessage(added, 6000);
      startPhase('Copilot: grouping new updates…');
      setDigesting(true);
      await refresh();
      try {
        const result = await digest((msg) => updatePhase(`Copilot: ${msg}`));
        logDigest('digest', result);
        const grouped = result.processed
          ? `grouped ${result.processed} into topics`
          : 'nothing new to group';
        const left = result.remaining ? ` · ${result.remaining} left for next run` : '';
        const errs = result.errors.length ? ` · ⚠ ${result.errors.length} Copilot call${result.errors.length !== 1 ? 's' : ''} failed` : '';
        showMessage(`${added} · ${grouped}${left}${errs}`, 8000);
      } catch (err) {
        audit.error('digest', err);
        showMessage(`⚠ Copilot grouping failed: ${errorText(err)}`, 10_000);
      }
      await refresh();
    } finally {
      releaseBusy();
    }
  }, [service, digest, config.autoDigest, refresh, showMessage, sourceName, claimBusy, startPhase, updatePhase, releaseBusy, audit, logDigest]);

  const nextAutoFetchAt = useAutoFetch(() => {
    if (busyRef.current) {
      return;
    }
    void doFetch(undefined, true).catch((err) => {
      audit.error('auto-fetch', err);
      showMessage(`Auto-fetch error: ${errorText(err)}`, 8000);
    });
  }, autoFetchInterval(config));
  const fetchInfo = useMemo(() => {
    const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5);
    const last = lastFetchAt ? `fetched ${hhmm(lastFetchAt)}` : '';
    const next = nextAutoFetchAt ? `next ${hhmm(nextAutoFetchAt)}` : 'auto-fetch off';
    return [last, next].filter(Boolean).join(' · ');
  }, [lastFetchAt, nextAutoFetchAt]);

  /** Forget all topics and regroup every unread and saved update. */
  const doRegroup = useCallback(async () => {
    if (!digest || !claimBusy('Copilot: regrouping all unread and saved updates…')) return;
    setDigesting(true);
    try {
      const result = await digest((msg) => updatePhase(`Copilot: ${msg}`), { reset: true });
      logDigest('regroup', result);
      const left = result.remaining ? ` · ${result.remaining} left for next time` : '';
      const summary = `Regrouped ${result.processed} update${result.processed !== 1 ? 's' : ''} into ${result.created} topics${left}`;
      const message = result.errors.length
        ? `⚠ ${result.errors.length} failed: ${result.errors[0]} · ${summary}`
        : `✓ ${summary}`;
      showMessage(message, result.errors.length ? 10_000 : 8000);
      await refresh();
    } catch (err) {
      audit.error('regroup', err);
      showMessage(`Regroup error: ${errorText(err)}`, 10_000);
    } finally {
      releaseBusy();
    }
  }, [digest, refresh, showMessage, claimBusy, updatePhase, releaseBusy, audit, logDigest]);
  /** When `z` asked to confirm a regroup (0 = not waiting for the second `z`). */
  const regroupArmedAt = useRef(0);

  const backupDir = config.backupDir ?? DEFAULT_BACKUP_DIR;

  const doBackup = useCallback(async () => {
    showMessage('Backing up updates…', 600_000);
    try {
      const payload = await service.backup();
      await mkdir(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = join(backupDir, `fomo-backup-${stamp}.json`);
      await writeFile(file, JSON.stringify(payload, null, 2));
      audit.log('backup', `${payload.count} update(s) → ${tildify(file)}`);
      showMessage(`✓ Backed up ${payload.count} update${payload.count !== 1 ? 's' : ''} → ${tildify(file)}`, 6000);
    } catch (err) {
      audit.error('backup', err);
      showMessage(`Backup error: ${errorText(err)}`, 6000);
    }
  }, [service, backupDir, showMessage, audit]);

  const openRestore = useCallback(async () => {
    let names: string[];
    try {
      names = (await readdir(backupDir)).filter((n) => n.endsWith('.json'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        audit.error('restore', `read ${tildify(backupDir)}: ${errorText(err)}`);
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
    if (!claimBusy(`Restoring ${file.name}…`)) return;
    setRestoreFiles(undefined);
    setRestoreConfirm(false);
    try {
      const payload = JSON.parse(await readFile(file.path, 'utf-8'));
      if (!payload?.version || !Array.isArray(payload.entities)) throw new Error('not a FOMO backup file');
      const restored = await service.restore(payload);
      audit.log('restore', `${restored} update(s) from ${file.name}`);
      showMessage(`✓ Restored ${restored} update${restored !== 1 ? 's' : ''} from ${file.name}`, 6000);
      await refresh();
    } catch (err) {
      audit.error('restore', `${file.name}: ${errorText(err)}`);
      showMessage(`Restore error: ${errorText(err)}`, 6000);
    } finally {
      releaseBusy();
    }
  }, [service, refresh, showMessage, claimBusy, releaseBusy, audit]);

  /** Ask for the Web app URL when it is missing; returns false then. */
  const needWebUrl = useCallback((what: string): boolean => {
    if (config.webUrl) return true;
    focusSettingsRow('c-webUrl');
    audit.error(what, 'Web app URL is not set');
    showMessage('Set “Web app URL” first (deploy.sh prints it)', 6000);
    return false;
  }, [config.webUrl, focusSettingsRow, showMessage, audit]);

  const qrCode = useCallback(async (url: string) => {
    const { default: qrcode } = await import('qrcode-terminal');
    return new Promise<string>((resolve) => qrcode.generate(url, { small: true }, resolve));
  }, []);

  /** Open `url` in the default browser. */
  const openInBrowser = useCallback((url: string, what: string) => {
    void import('open')
      .then(({ default: open }) => open(url))
      .catch((err) => {
        audit.error(what, `open in browser: ${errorText(err)}`);
        showMessage('Could not open browser');
      });
  }, [audit, showMessage]);

  /** Show the plain web app URL (no access token) as a QR code to open it on a phone. */
  const doWebAppQr = useCallback(async () => {
    if (!needWebUrl('web-app') || !config.webUrl) return;
    try {
      setLinkView({
        action: 'web-app',
        title: 'Web app',
        intro: 'Scan the QR code to open the web app on your phone. A new device also needs “Link a device” once.',
        url: config.webUrl,
        qr: await qrCode(config.webUrl),
      });
    } catch (err) {
      audit.error('web-app', err);
      showMessage(`Can’t show the QR code: ${errorText(err)}`, 6000);
    }
  }, [config.webUrl, needWebUrl, qrCode, showMessage, audit]);

  /** Create a magic link (account SAS in the URL fragment) for the web app and show it as a QR code. */
  const doLink = useCallback(async () => {
    if (!needWebUrl('link-device') || !config.webUrl) return;
    try {
      const { createWebSas } = await import('@fomo/core/store/sas');
      const conn = createWebSas(config.connectionString ?? '', { days: config.linkDays ?? DEFAULT_LINK_DAYS });
      const url = buildConnectLink(config.webUrl, conn);
      setLinkView({
        action: 'link-device',
        title: 'Link a device',
        intro: 'Scan the QR code on your phone, or open the link on any device, to connect the web app.',
        url,
        note: `Valid until ${conn.expiresOn.toISOString().slice(0, 10)}. Anyone with this link can read and change your FOMO data.`,
        qr: await qrCode(url),
      });
      // Never record the link itself: it carries the access token.
      audit.log('link-device', `created a web app link valid until ${conn.expiresOn}`);
    } catch (err) {
      audit.error('link-device', err);
      showMessage(`Can’t create a link: ${errorText(err)}`, 6000);
    }
  }, [config.webUrl, config.connectionString, config.linkDays, needWebUrl, qrCode, showMessage, audit]);

  const applySourceFilter = useCallback((ids: string[] | undefined, f: FilterStatus = filterRef.current) => {
    sourceFilterRef.current = ids;
    setSourceFilter(ids);
    setFilter(f);
    setSelectedIndex(0);
    setShowDetail(false);
    void refresh(f);
  }, [refresh, audit, sourceName]);

  /** Open the source picker with the sources in the current view (search applied, source filter ignored). */
  const openSourcePicker = useCallback(async () => {
    const seq = ++sourcePickerSeq.current;
    const current = sourceFilterRef.current;
    setSourcePicker({ checked: new Set(current ?? []), focus: 0 });
    const f = filterRef.current;
    try {
      const counts = await service.countSources({
        ...(f === 'saved' ? { saved: true } : { status: f }),
        search: searchRef.current || undefined,
        grouped: isGrouped(f, groupedViewsRef.current),
      });
      if (seq !== sourcePickerSeq.current) return;
      const ids = [...new Set([...Object.keys(counts), ...(current ?? [])])];
      const options = ids
        .map((id) => ({
          id,
          label: sourceName(id),
          color: appSettings.sourceColors?.[id] ?? DEFAULT_SOURCE_COLOR[id] ?? '#58a6ff',
          count: counts[id] ?? 0,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      setSourcePicker((p) => p && { ...p, options, checked: new Set(current ?? ids) });
    } catch (err) {
      if (seq !== sourcePickerSeq.current) return;
      setSourcePicker(undefined);
      audit.error('filter', `count sources: ${errorText(err)}`);
      showMessage(`Error: ${errorText(err)}`);
    }
  }, [service, sourceName, appSettings.sourceColors, showMessage, audit]);

  const closeSourcePicker = useCallback(() => {
    sourcePickerSeq.current++;
    setSourcePicker(undefined);
  }, []);

  /** Open the Copilot account picker with the accounts signed in to gh, focused on the saved one. */
  const openAccountPicker = useCallback(async () => {
    const seq = ++accountPickerSeq.current;
    setAccountPicker({ focus: 0 });
    let accounts: GhAccount[] = [];
    let error: string | undefined;
    try {
      accounts = await listAccounts();
    } catch (err) {
      error = errorText(err);
    }
    if (seq !== accountPickerSeq.current) return;
    if (error) audit.error('config', `list gh accounts: ${error}`);
    const focus = accountOptions(accounts, config.copilotAccount).findIndex((o) => o.login === config.copilotAccount);
    setAccountPicker({ accounts, error, focus: Math.max(0, focus) });
  }, [listAccounts, config.copilotAccount, audit]);

  const closeAccountPicker = useCallback(() => {
    accountPickerSeq.current++;
    setAccountPicker(undefined);
  }, []);

  /** Search the current view (and any view switched to) for `query`; empty clears it. */
  const applySearch = useCallback((query: string) => {
    const q = query.trim();
    searchRef.current = q;
    setSearch(q);
    setSelectedIndex(0);
    setShowDetail(false);
    void loadUpdates(filterRef.current);
  }, [loadUpdates, audit]);

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
      audit.error('fetch-content', `“${selected.title}”: ${errorText(err)}`);
      showMessage(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [service, currentUpdate, showMessage, audit]);

  /** Change one update wherever it is shown (list and digest). */
  const patchUpdate = useCallback((id: string, patch: Partial<Update>) => {
    setUpdates((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
    setDigestEntries((prev) => patchDigest(prev, new Set([id]), patch));
  }, []);

  /** Summarise the selected post with Copilot and save it; a saved summary is reused unless `force`. */
  const doSummarize = useCallback(async (force: boolean) => {
    const selected = currentUpdate();
    if (!selected) {
      showMessage(isGrouped(filterRef.current, groupedViewsRef.current) ? 'Expand the topic to summarise a single update' : 'Nothing selected');
      return;
    }
    setShowDetail(true);
    const alreadySaved = () => {
      regenArmed.current = { id: selected.id, at: Date.now() };
      showMessage('Summary already saved · g again regenerates it', REGROUP_CONFIRM_MS);
    };
    if (selected.gist && !force) { alreadySaved(); return; }
    if (!summarize) { showMessage('Copilot is not available'); return; }
    const { id } = selected;
    if (summarizingRef.current.has(id)) { showMessage('⏳ Already summarising this post'); return; }
    const track = (on: boolean) => {
      if (on) summarizingRef.current.add(id); else summarizingRef.current.delete(id);
      setSummarizing(new Set(summarizingRef.current));
    };
    track(true);
    showMessage('Copilot: summarising post…', 120_000);
    try {
      const result = await summarize(id, force);
      if (result.outcome === 'short') {
        audit.log('summarize', `“${selected.title}”: too short to summarise`);
        showMessage('Short post (under 1,000 characters) — nothing to summarise', 5000);
        return;
      }
      patchUpdate(id, { gist: result.update.gist });
      const from = result.from === 'page' ? ' (from the full page)' : result.from === 'preview' ? ' (from the preview)' : '';
      audit.log('summarize', `“${selected.title}”: ${result.outcome === 'cached' ? 'already saved' : `${force ? 'regenerated' : 'saved'}${from}`}`);
      if (result.outcome === 'cached') { alreadySaved(); return; }
      showMessage(`✓ Summary saved${from}`, 4000);
    } catch (err) {
      audit.error('summarize', `“${selected.title}”: ${errorText(err)}`);
      showMessage(`⚠ Summary failed: ${errorText(err)}`, 10_000);
    } finally {
      track(false);
    }
  }, [currentUpdate, summarize, patchUpdate, showMessage, audit]);

  // ── Digest actions ──────────────────────────────────────────────────────────
  /** Record a read / save change and write it; on failure record the error and reload. */
  const persistChange = useCallback(async (action: string, detail: string, write: () => Promise<unknown>) => {
    try {
      await write();
      void loadStats();
    } catch (err) {
      audit.error(action, `${detail}: ${errorText(err)}`);
      showMessage(`Error: ${errorText(err)}`);
      await refresh();
    }
  }, [audit, loadStats, refresh, showMessage]);

  /** Mark updates read in place and optionally move to the next row, keeping them available for undo. */
  const doDigestRead = useCallback(async (ids: string[], advance = false) => {
    if (ids.length === 0) return;
    const selectedKey = digestRowsRef.current[selectedRef.current]?.key;
    if (advance) {
      const nextKey = nextRowKey(digestRowsRef.current, selectedKey);
      setSelectedIndex(Math.max(0, digestRowsRef.current.findIndex((r) => r.key === nextKey)));
    }
    setDigestEntries((prev) => patchDigest(prev, new Set(ids), { status: 'read' }));
    showMessage(ids.length > 1 ? `✓ ${ids.length} marked read${advance ? ' → next' : ''}` : `✓ Marked read${advance ? ' → next' : ''}`);

    await persistChange('status', `read ${describeIds(ids)}`, () => service.setStatusMany(ids, 'read'));
  }, [service, persistChange, describeIds, showMessage]);

  const doDigestToggleSaved = useCallback(async (update: Update) => {
    const saved = !update.saved;
    setDigestEntries((prev) => patchDigest(prev, new Set([update.id]), { saved }));
    showMessage(saved ? '⭐ Marked pending' : 'No longer pending');
    await persistChange('save', `${saved ? 'pending' : 'not pending'} “${update.title}”`, () => service.setSaved(update.id, saved));
  }, [service, persistChange, showMessage]);

  /** Change update statuses in place; with `advance`, move to the next row. */
  const doDigestStatus = useCallback(async (ids: string[], status: Status, advance = false) => {
    if (ids.length === 0) return;
    if (advance) {
      const key = nextRowKey(digestRowsRef.current, digestRowsRef.current[selectedRef.current]?.key);
      setSelectedIndex(Math.max(0, digestRowsRef.current.findIndex((r) => r.key === key)));
    }
    setDigestEntries((prev) => patchDigest(prev, new Set(ids), { status }));
    showMessage(`✓ ${ids.length > 1 ? `${ids.length} marked` : 'Marked'} ${status}${advance ? ' → next' : ''}`);
    await persistChange('status', `${status} ${describeIds(ids)}`, () => service.setStatusMany(ids, status));
  }, [service, persistChange, describeIds, showMessage]);

  const doToggleDigestStatus = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    const hasUnread = digestEntriesRef.current
      .flatMap((entry) => entry.items)
      .some((update) => idSet.has(update.id) && update.status === 'unread');
    void doDigestStatus(ids, hasUnread ? 'read' : 'unread');
  }, [doDigestStatus]);

  /** Pending view: clear an update's pending mark, drop it from the list and keep the cursor on the next remaining row. */
  const doUnsave = useCallback(async (id: string) => {
    const selectedKey = digestRowsRef.current[selectedRef.current]?.key;
    const next = removeAndAdvance(digestEntriesRef.current, expandedRef.current, selectedKey, new Set([id]));
    setDigestEntries(next.entries);
    setSelectedIndex(Math.max(0, next.rows.findIndex((r) => r.key === next.nextKey)));
    showMessage('No longer pending');
    await persistChange('save', `not pending ${describeIds([id])}`, () => service.setSaved(id, false));
  }, [service, persistChange, describeIds, showMessage]);

  const setTopicExpanded = useCallback((topicId: string, open: boolean) => {
    setExpanded((prev) => {
      if (prev.has(topicId) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(topicId);
      else next.delete(topicId);
      return next;
    });
  }, []);

  const doToggleStatus = useCallback(async () => {
    const selected = updatesRef.current[selectedRef.current];
    if (!selected) return;
    const status: Status = selected.status === 'unread' ? 'read' : 'unread';

    setUpdates((prev) =>
      prev.map((u) => (u.id === selected.id ? { ...u, status } : u)),
    );
    showMessage(`Marked ${status}`);

    await persistChange('status', `${status} “${selected.title}”`, () => service.setStatus(selected.id, status));
  }, [service, persistChange, showMessage]);

  const doToggleSaved = useCallback(async () => {
    const selected = updatesRef.current[selectedRef.current];
    if (!selected) return;

    const newSaved = !selected.saved;
    setUpdates((prev) =>
      prev.map((u) => (u.id === selected.id ? { ...u, saved: newSaved } : u)),
    );
    showMessage(newSaved ? '⭐ Marked pending' : 'No longer pending');

    await persistChange('save', `${newSaved ? 'pending' : 'not pending'} “${selected.title}”`, () => service.setSaved(selected.id, newSaved));
  }, [service, persistChange, showMessage]);

  const doOpen = useCallback(async () => {
    const selected = updatesRef.current[selectedRef.current];
    if (!selected) return;
    try {
      const { default: open } = await import('open');
      await open(selected.url);
    } catch (err) {
      audit.error('open', `${selected.url}: ${errorText(err)}`);
      showMessage('Could not open browser');
    }
  }, [showMessage, audit]);

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

    await persistChange('status', `read “${selected.title}”`, () => service.setStatus(selected.id, 'read'));
  }, [service, persistChange, showMessage]);

  // Lazily load content for the update shown in the digest detail pane
  const digestSelectedUpdate = grouped ? rowUpdate(digestRows[selectedIndex]) : undefined;
  useEffect(() => {
    const u = digestSelectedUpdate;
    if (!showDetail || !u || u.content || u.id in contentCache) return;
    let cancelled = false;
    service.getUpdate(u.id)
      .then((full) => { if (!cancelled) setContentCache((prev) => ({ ...prev, [u.id]: full.content })); })
      .catch((err) => {
        audit.error('content', `“${u.title}”: ${errorText(err)}`);
        if (!cancelled) setContentCache((prev) => ({ ...prev, [u.id]: '' }));
      });
    return () => { cancelled = true; };
  }, [service, showDetail, digestSelectedUpdate, contentCache, audit]);

  // ── Settings: save the row being edited ─────────────────────────────────────
  const commitEdit = useCallback((row: SettingsRow, text: string) => {
    const stopEditing = () => { setEditingKey(undefined); setEditBuffer(''); setAddDraft(undefined); };

    if (row.kind === 'add-source') {
      const draft = addDraft ?? { step: 'url' as const, url: '', name: '' };
      const value = text.trim();
      const fail = (error: string) => { audit.error('source', `add: ${error}`); showMessage(`⚠ ${error}`, 5000); };
      if (draft.step === 'url') {
        const guess = newUserSource({ url: value }, appSettings);
        if ('error' in guess) { fail(guess.error); return; }
        setAddDraft({ step: 'name', url: value, name: '' });
        setEditBuffer(guess.spec.displayName);
        return;
      }
      if (draft.step === 'name') {
        const named = newUserSource({ url: draft.url, name: value }, appSettings);
        if ('error' in named) { fail(named.error); return; }
        // A keyword filter only applies to feeds and YouTube
        if (named.spec.kind === 'feed' || named.spec.kind === 'youtube') {
          setAddDraft({ ...draft, step: 'include', name: value });
          setEditBuffer('');
          return;
        }
      }
      const result = newUserSource({ url: draft.url, name: draft.step === 'name' ? value : draft.name, include: draft.step === 'include' ? value : undefined }, appSettings);
      if ('error' in result) { fail(result.error); return; }
      stopEditing();
      const { spec } = result;
      const patch = addSourcePatch(appSettings, spec);
      audit.log('source', `added ${spec.id} (${spec.kind})`);
      setAppSettings((prev) => ({ ...prev, ...patch }));
      void service.updateSettings(patch)
        .then((s) => {
          setAppSettings(s);
          showMessage(`✓ Added ${spec.displayName}, fetching it…`);
          return doFetch([spec.id]);
        })
        .catch((err) => {
          audit.error('source', `add ${spec.id}: ${errorText(err)}`);
          showMessage(`Error: ${errorText(err)}`);
        });
      return;
    }

    if (row.kind === 'source') {
      const sourceId = row.source.id;
      const label = text.trim();
      const newLabels = { ...appSettings.sourceLabels, [sourceId]: label };
      // An empty label (or the id itself) resets to the default
      if (label === '' || label === sourceId) delete newLabels[sourceId];
      setAppSettings((prev) => ({ ...prev, sourceLabels: newLabels }));
      audit.log('source', `${sourceId} label = ${newLabels[sourceId] ? `“${label}”` : '(default)'}`);
      void service.updateSettings({ sourceLabels: newLabels })
        .then((s) => setAppSettings(s))
        .catch((err) => {
          audit.error('source', `${sourceId} label: ${errorText(err)}`);
          showMessage(`Error: ${errorText(err)}`);
        });
      stopEditing();
      return;
    }
    if (row.kind !== 'config') return;

    const parsed = parseConfigEdit(row.field, text);
    if ('error' in parsed) {
      audit.error('config', `${row.field}: ${parsed.error}`);
      showMessage(`⚠ ${parsed.error}`, 4000);
      return;
    }
    stopEditing();

    const save = () => {
      const err = onConfigChange(parsed.patch);
      if (err) {
        audit.error('config', `${describeConfig(parsed.patch)}: ${err}`);
        showMessage(`⚠ Could not save: ${err}`, 6000);
        return;
      }
      const env = envSource(row.field);
      audit.log('config', `${describeConfig(parsed.patch)}${env ? ` (overridden by ${env})` : ''}`);
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
          audit.error('config', `connectionString not saved, can’t connect: ${errorText(err)}`);
          showMessage(`⚠ Can’t connect, not saved: ${errorText(err)}`, 8000);
          return;
        }
        save();
      })();
      return;
    }
    save();
  }, [service, appSettings, addDraft, doFetch, onConfigChange, showMessage, audit]);

  /** Save settings shared with the web app; `what` describes the change for the audit trail. */
  const updateRemoteSettings = useCallback((patch: Partial<AppSettings>, action: string, what: string) => {
    audit.log(action, what);
    setAppSettings((prev) => ({ ...prev, ...patch }));
    void service.updateSettings(patch)
      .then((s) => setAppSettings(s))
      .catch((err) => {
        audit.error(action, `${what}: ${errorText(err)}`);
        showMessage(`Error: ${errorText(err)}`);
      });
  }, [service, showMessage, audit]);

  /** Delete every stored update of a source; one that is gone for good also loses its label and color. */
  const deleteSourceItems = useCallback(async (id: string) => {
    const name = sourceName(id);
    const active = sources.some((s) => s.id === id);
    showMessage(`Deleting the items of ${name}…`, 60_000);
    try {
      const n = await service.deleteSourceUpdates(id);
      audit.log('source', `${id}: deleted ${n} items`);
      showMessage(`✓ Deleted ${n} item${n === 1 ? '' : 's'} of ${name}${active ? ' · f fetches them again' : ''}`, 5000);
      if (!active && !appSettings.removedSources.includes(id)) updateRemoteSettings(forgetSourcePatch(appSettings, id), 'source', `forgot ${id}`);
    } catch (err) {
      audit.error('source', `${id}: delete items: ${errorText(err)}`);
      showMessage(`⚠ Could not delete the items of ${name}: ${errorText(err)}`, 6000);
    }
    await refresh();
  }, [sourceName, sources, showMessage, service, audit, appSettings, updateRemoteSettings, refresh]);

  /** Remove a source, keeping its stored updates (it then shows greyed out) or deleting them too. */
  const removeSource = useCallback((id: string, deleteItems: boolean) => {
    const name = sourceName(id);
    const items = stats?.bySource[id] ?? 0;
    const builtin = !userSource(appSettings, id);
    const patch = removeSourcePatch(appSettings, id, { keepName: items > 0 && !deleteItems });
    updateRemoteSettings(deleteItems && !builtin ? { ...patch, ...forgetSourcePatch(appSettings, id) } : patch, 'source', `removed ${id}`);
    if (deleteItems && items > 0) void deleteSourceItems(id);
    else showMessage(`Removed ${name}${items > 0 ? ` · its ${items} items stay until you delete them` : builtin ? ' · restore it at the end of the list' : ''}`, 5000);
  }, [sourceName, stats, appSettings, updateRemoteSettings, deleteSourceItems, showMessage]);

  /** Tab / Shift+Tab: step through the views in tab order (1–6), wrapping around. */
  const cycleView = (dir: 1 | -1) => {
    const current = refs.active ? 'refs' : showTodos ? 'todos' : filter;
    const next = VIEW_ORDER[(VIEW_ORDER.indexOf(current) + dir + VIEW_ORDER.length) % VIEW_ORDER.length]!;
    if (refs.active) refs.close();
    if (next === 'refs') { setShowTodos(false); refs.openView(); return; }
    if (next === 'todos') { setShowTodos(true); void loadTodos(); return; }
    setShowTodos(false);
    setFilter(next);
    setSelectedIndex(0);
    void refresh(next);
  };

  // ── Input handler ───────────────────────────────────────────────────────────
  useInput((raw, key) => {
    // Shortcuts ignore case (Shift+b does what b does); typed text keeps `raw`.
    const input = shortcutKey(raw);
    // ── Quit from any screen (but not while typing) ──
    if (input === 'q' && !editingKey && sourceDetails?.editing === undefined && !todosAddMode && !refs.typing && searchDraft === undefined && !settingsSearchTyping && !helpSearchTyping) { exit(); return; }

    // ── Search prompt (opened with /) ──
    if (searchDraft !== undefined) {
      if (key.escape) { setSearchDraft(undefined); return; }
      if (key.return) { setSearchDraft(undefined); applySearch(searchDraft); return; }
      if (key.backspace || key.delete) { setSearchDraft((d) => (d ?? '').slice(0, -1)); return; }
      if (key.ctrl && input === 'u') { setSearchDraft(''); return; }
      if (!raw || key.ctrl || key.meta) return;
      // Pasted (or fast-typed) text arrives in one chunk; a line break in it submits.
      const brk = raw.search(/[\r\n]/);
      if (brk === -1) { setSearchDraft((d) => (d ?? '') + raw); return; }
      setSearchDraft(undefined);
      applySearch(searchDraft + raw.slice(0, brk));
      return;
    }

    // ── Help overlay — Esc or h to close, consume all other input ──
    if (showHelp) {
      if (helpSearchTyping) {
        if (key.escape) { setHelpSearch(''); setHelpSearchTyping(false); return; }
        if (key.return) { setHelpSearchTyping(false); return; }
        const next = editText(helpSearch, raw, key);
        if (next !== undefined) setHelpSearch(next);
        return;
      }
      if (input === '/') { setHelpSearchTyping(true); return; }
      if (key.escape && helpSearch) { setHelpSearch(''); return; }
      if (key.escape || key.backspace || key.delete || input === 'h') { setShowHelp(false); setHelpSearch(''); }
      return;
    }

    // Shift+↑/↓ jumps 5 rows, or 10 on a tall terminal
    const step = key.shift && (key.upArrow || key.downArrow) ? jumpStep(rows) : 1;

    // ── Audit trail (opened with a) ──
    if (showAudit) {
      if (key.escape || key.backspace || key.delete || input === 'a') { setShowAudit(false); return; }
      const last = Math.max(0, auditEntries.length - 1);
      if (key.upArrow || input === 'k') { setAuditIndex((i) => Math.max(0, i - step)); return; }
      if (key.downArrow || input === 'j') { setAuditIndex((i) => Math.min(last, i + step)); return; }
      if (key.pageUp) { setAuditIndex((i) => Math.max(0, i - 10)); return; }
      if (key.pageDown) { setAuditIndex((i) => Math.min(last, i + 10)); return; }
      if (input === 'e') { setAuditErrorsOnly((on) => !on); setAuditIndex(0); return; }
      return;
    }

    // ── Source picker (opened with v) ──
    if (sourcePicker) {
      if (key.escape || key.backspace || key.delete) { closeSourcePicker(); return; }
      const options = sourcePicker.options;
      if (!options) return;
      const last = Math.max(0, options.length - 1);
      const set = (checked: ReadonlySet<string>) => setSourcePicker({ ...sourcePicker, checked, warning: undefined });
      if (key.upArrow || input === 'k') { setSourcePicker({ ...sourcePicker, focus: Math.max(0, sourcePicker.focus - 1) }); return; }
      if (key.downArrow || input === 'j') { setSourcePicker({ ...sourcePicker, focus: Math.min(last, sourcePicker.focus + 1) }); return; }
      if (input === 'a') { set(new Set(options.map((o) => o.id))); return; }
      if (input === 'n') { set(new Set()); return; }
      if (input === ' ') {
        const id = options[sourcePicker.focus]?.id;
        if (!id) return;
        const next = new Set(sourcePicker.checked);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        set(next);
        return;
      }
      if (key.return) {
        const chosen = options.filter((o) => sourcePicker.checked.has(o.id)).map((o) => o.id);
        if (options.length > 0 && chosen.length === 0) {
          setSourcePicker({ ...sourcePicker, warning: 'Tick at least one source (space), or press a for all' });
          return;
        }
        closeSourcePicker();
        const all = chosen.length === options.length;
        applySourceFilter(all ? undefined : chosen);
        showMessage(all ? 'Showing all sources' : `Showing ${chosen.length} of ${options.length} sources`);
      }
      return;
    }

    // ── Link a device overlay ──
    if (linkView) {
      if (key.escape || key.backspace || key.delete) {
        setLinkView(undefined);
      } else if (input === 'o') {
        openInBrowser(linkView.url, linkView.action);
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

    // ── Copilot account picker (Config → Copilot account) ──
    if (accountPicker) {
      if (key.escape || key.backspace || key.delete) { closeAccountPicker(); return; }
      if (!accountPicker.accounts) return;
      const options = accountOptions(accountPicker.accounts, config.copilotAccount);
      if (key.upArrow || input === 'k') { setAccountPicker({ ...accountPicker, focus: Math.max(0, accountPicker.focus - 1) }); return; }
      if (key.downArrow || input === 'j') { setAccountPicker({ ...accountPicker, focus: Math.min(options.length - 1, accountPicker.focus + 1) }); return; }
      if (key.return) {
        const login = options[accountPicker.focus]?.login;
        closeAccountPicker();
        if (login === config.copilotAccount) return;
        const patch = { copilotAccount: login };
        const err = onConfigChange(patch);
        if (err) {
          audit.error('config', `${describeConfig(patch)}: ${err}`);
          showMessage(`⚠ Could not save: ${err}`, 6000);
          return;
        }
        audit.log('config', describeConfig(patch));
        showMessage(`✓ Copilot account: ${login ?? `automatic (${automaticAccount()})`}`, 4000);
      }
      return;
    }

    // ── Source details popup (Config → ↵ on a source) ──
    if (sourceDetails) {
      const d = sourceDetails;
      if (!detailsSource) { setSourceDetails(undefined); return; }
      const own = !!userSource(appSettings, d.id);
      const removed = !!detailsSource.removed;
      const fields = removed ? [] : detailsFields(own, d.draft);
      const field = fields[Math.min(d.focus, fields.length - 1)];
      if (d.editing !== undefined) {
        if (key.escape) { setSourceDetails({ ...d, editing: undefined }); return; }
        if (key.return) {
          if (!field) return;
          const draft = { ...d.draft, [field]: d.editing.trim() };
          setSourceDetails({ ...d, draft, editing: undefined, error: undefined, focus: Math.min(d.focus, detailsFields(own, draft).length - 1) });
          return;
        }
        const next = editText(d.editing, raw, key);
        if (next !== undefined) setSourceDetails({ ...d, editing: next });
        return;
      }
      if (key.escape || key.backspace || key.delete) {
        if (detailsChanged && d.confirm !== 'discard') setSourceDetails({ ...d, confirm: 'discard' });
        else setSourceDetails(undefined);
        return;
      }
      const items = stats?.bySource[d.id] ?? 0;
      if (d.confirm === 'remove' && items > 0 && (input === 'x' || input === 'd')) {
        setSourceDetails(undefined);
        removeSource(d.id, input === 'd');
        return;
      }
      if (input === 'x' && !removed) {
        if (d.confirm !== 'remove') { setSourceDetails({ ...d, confirm: 'remove' }); return; }
        setSourceDetails(undefined);
        removeSource(d.id, false);
        setSettingsFocusIndex((i) => Math.max(0, i - 1));
        return;
      }
      if ((input === 'd' || (removed && input === 'x')) && items > 0) {
        if (d.confirm !== 'items') { setSourceDetails({ ...d, confirm: 'items' }); return; }
        if (removed) setSourceDetails(undefined);
        else setSourceDetails({ ...d, confirm: undefined });
        void deleteSourceItems(d.id);
        return;
      }
      const ready = { ...d, confirm: undefined };
      if (removed) {
        if (input === 'r' && detailsSource.builtin) {
          setSourceDetails(undefined);
          updateRemoteSettings({ removedSources: appSettings.removedSources.filter((s) => s !== d.id) }, 'source', `restored ${d.id}`);
          showMessage(`Restored ${sourceName(d.id)}`);
        } else if (input === 'v') {
          setSourceDetails(undefined); setShowSettings(false); applySourceFilter([d.id]);
        } else if (d.confirm) setSourceDetails(ready);
        return;
      }
      if (!field) return;
      if (key.upArrow || input === 'k') { setSourceDetails({ ...ready, focus: Math.max(0, d.focus - 1) }); return; }
      if (key.downArrow || input === 'j') { setSourceDetails({ ...ready, focus: Math.min(fields.length - 1, d.focus + 1) }); return; }
      if (input === 's') {
        const result = sourceDraftPatch(appSettings, d.id, d.draft);
        if ('error' in result) { setSourceDetails({ ...ready, error: result.error }); return; }
        setSourceDetails(undefined);
        if (detailsChanged) {
          updateRemoteSettings(result.patch, 'source', `${d.id} details saved`);
          showMessage(`✓ Saved ${sourceName(d.id)}`);
        }
        return;
      }
      if (input === 'f') { setSourceDetails(ready); void doFetch([d.id]); return; }
      if (input === 'v') { setSourceDetails(undefined); setShowSettings(false); applySourceFilter([d.id]); return; }
      if ((field === 'enabled' || field === 'shorts') && (key.return || input === ' ')) {
        setSourceDetails({ ...ready, draft: { ...d.draft, [field]: !d.draft[field] } });
        return;
      }
      if (field === 'color' && (key.return || key.rightArrow || key.leftArrow)) {
        const current = COLOR_PALETTE.indexOf(d.draft.color || COLOR_PALETTE[0]!);
        const next = COLOR_PALETTE[(current + (key.leftArrow ? -1 : 1) + COLOR_PALETTE.length) % COLOR_PALETTE.length]!;
        setSourceDetails({ ...ready, draft: { ...d.draft, color: next } });
        return;
      }
      if ((key.return || input === 'e') && typeof d.draft[field] === 'string') {
        setSourceDetails({ ...ready, error: undefined, editing: d.draft[field] });
        return;
      }
      if (d.confirm) setSourceDetails(ready);
      return;
    }

    // ── References view (5) and the file-a-link form (m) ──
    if (refs.active) {
      if (input === 'h' && !refs.typing) {
        setHelpContext('references');
        setShowHelp(true);
        return;
      }
      if (key.tab && !refs.typing) { cycleView(key.shift ? -1 : 1); return; }
      if (input === '6' && !refs.typing) {
        refs.close();
        setShowTodos(true);
        void loadTodos();
        return;
      }
      refs.handleInput(raw, key);
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
          const subject = todosFormSubject.trim();
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
              audit.error('todo', `add “${subject}”: ${errorText(err)}`);
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
        if (raw && !key.ctrl && !key.meta) {
          if (todosFormField === 'subject')      setTodosFormSubject((b) => b + raw);
          else if (todosFormField === 'due')     setTodosFormDue((b) => b + raw);
          else if (todosFormField === 'description') setTodosFormDesc((b) => b + raw);
        }
        return;
      }

      // List mode inside todos view
      if (key.tab) { cycleView(key.shift ? -1 : 1); return; }
      if (key.escape || key.backspace || input === '6') {
        setShowTodos(false);
        return;
      }
      if (input === '5') {
        setShowTodos(false);
        refs.openView();
        return;
      }
      if (key.upArrow || input === 'k') {
        setTodosSelectedIndex((i) => Math.max(0, i - step));
        return;
      }
      if (key.downArrow || input === 'j') {
        setTodosSelectedIndex((i) => Math.max(0, Math.min(todosList.length - 1, i + step)));
        return;
      }
      if (input === 'a') {
        setTodosAddMode(true);
        setTodosFormField('subject');
        return;
      }
      if (input === 's') {
        const next = nextSort(TODO_SORTS, sortsRef.current.todos);
        sortsRef.current = { ...sortsRef.current, todos: next };
        setSorts(sortsRef.current);
        const keep = todosList[todosSelectedIndex]?.id;
        const sorted = sortTodos(todosList, next);
        setTodosList(sorted);
        setTodosSelectedIndex(Math.max(0, sorted.findIndex((t) => t.id === keep)));
        showTodosMessage(`Sort: ${next.label}`);
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
          .catch((err) => {
            audit.error('todo', `“${todo.subject}” → ${next}: ${errorText(err)}`);
            return loadTodos();
          });
        return;
      }
      if (input === 'd' && todosList[todosSelectedIndex]) {
        const { id, subject } = todosList[todosSelectedIndex];
        setTodosList((prev) => prev.filter((t) => t.id !== id));
        setTodosSelectedIndex((i) => Math.max(0, i - 1));
        void service.deleteTodo(id)
          .then(() => loadTodos())
          .catch((err) => {
            audit.error('todo', `delete “${subject}”: ${errorText(err)}`);
            return loadTodos();
          });
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
        if (key.escape) { setEditingKey(undefined); setEditBuffer(''); setAddDraft(undefined); return; }
        if (key.return) { if (editRow) commitEdit(editRow, editBuffer); return; }
        if (key.backspace || key.delete) { setEditBuffer((b) => b.slice(0, -1)); return; }
        // Pasted text arrives in one chunk; drop line breaks
        if (input && !key.ctrl && !key.meta) setEditBuffer((b) => b + raw.replace(/[\r\n]/g, ''));
        return;
      }

      if (settingsSearchTyping) {
        if (key.escape) { setSettingsSearch(''); setSettingsSearchTyping(false); setSettingsFocusIndex(firstFocusable(buildSettingsRows(sources, collapsedSections))); return; }
        if (key.return) { setSettingsSearchTyping(false); return; }
        if (key.upArrow || key.downArrow) {
          setSettingsSearchTyping(false);
        } else {
          const next = editText(settingsSearch, raw, key);
          if (next !== undefined) { setSettingsSearch(next); setSettingsFocusIndex(1); }
          return;
        }
      }

      if (key.escape && confirmKey) { setConfirmKey(undefined); return; }
      if (key.escape && settingsSearch) { setSettingsSearch(''); setSettingsFocusIndex(firstFocusable(buildSettingsRows(sources, collapsedSections))); return; }
      if (input === '/') { setSettingsSearchTyping(true); setConfirmKey(undefined); return; }
      if (key.escape || key.backspace || key.delete || input === 'c') {
        setShowSettings(false);
        setConfirmKey(undefined);
        setSettingsSearch('');
        return;
      }
      const page = Math.max(1, rows - STATUSBAR_H - FILTERBAR_H - 5);
      const move = key.upArrow || input === 'k' ? -step : key.downArrow || input === 'j' ? step : key.pageUp ? -page : key.pageDown ? page : 0;
      if (move) { setSettingsFocusIndex((i) => moveFocus(settingsRows, i, move)); setConfirmKey(undefined); return; }
      if (input === 'h') {
        setHelpContext('settings');
        setShowHelp(true);
        return;
      }
      if (!row) return;

      // Sections stay open while searching
      if (settingsSearch && (row.kind === 'header' || key.leftArrow || key.rightArrow)) return;
      if (row.kind === 'header') {
        if (key.return || input === ' ') setSectionCollapsed(row.key, !row.collapsed);
        else if (key.leftArrow) setSectionCollapsed(row.key, true);
        else if (key.rightArrow) setSectionCollapsed(row.key, false);
        setConfirmKey(undefined);
        return;
      }
      if (key.leftArrow) {
        const header = sectionHeaderIndex(settingsRows, settingsFocusIndex);
        setSettingsFocusIndex(header);
        setSectionCollapsed(settingsRows[header]!.key, true);
        setConfirmKey(undefined);
        return;
      }

      if (row.kind === 'source') {
        const sourceId = row.source.id;
        const items = stats?.bySource[sourceId] ?? 0;
        if (confirmKey === row.key && !row.source.removed && items > 0 && (input === 'x' || input === 'd')) {
          setConfirmKey(undefined);
          removeSource(sourceId, input === 'd');
          setSettingsFocusIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (row.source.removed && !key.return && input !== 'v') {
          if (input === 'x') {
            if (confirmKey !== row.key) { setConfirmKey(row.key); return; }
            setConfirmKey(undefined);
            void deleteSourceItems(sourceId);
            setSettingsFocusIndex((i) => Math.max(0, i - 1));
            return;
          }
          setConfirmKey(undefined);
          return;
        }
        if (key.return) {
          setConfirmKey(undefined);
          setSourceDetails({ id: sourceId, draft: sourceDraft(appSettings, sourceId), focus: 0 });
          return;
        }
        if (input === ' ') {
          const disabled = new Set(appSettings.disabledSources);
          const enable = disabled.has(sourceId);
          if (enable) disabled.delete(sourceId);
          else disabled.add(sourceId);
          updateRemoteSettings({ disabledSources: [...disabled] }, 'source', `${sourceName(sourceId)} ${enable ? 'enabled' : 'disabled'}`);
        } else if (input === 'e') {
          setEditBuffer(appSettings.sourceLabels[sourceId] ?? '');
          setEditingKey(row.key);
        } else if (input === 'd') {
          const currentColor = appSettings.sourceColors?.[sourceId] || COLOR_PALETTE[0];
          const nextColor = COLOR_PALETTE[(COLOR_PALETTE.indexOf(currentColor) + 1) % COLOR_PALETTE.length];
          updateRemoteSettings({ sourceColors: { ...appSettings.sourceColors, [sourceId]: nextColor } }, 'source', `${sourceName(sourceId)} color = ${nextColor}`);
        } else if (input === 'f') {
          void doFetch([sourceId]);
        } else if (input === 'v') {
          setShowSettings(false);
          applySourceFilter([sourceId]);
        } else if (input === 'x') {
          // x again confirms; a removed built-in can be restored, a user source is gone
          if (confirmKey !== row.key) { setConfirmKey(row.key); return; }
          setConfirmKey(undefined);
          removeSource(sourceId, false);
          setSettingsFocusIndex((i) => Math.max(0, i - 1));
          return;
        }
        setConfirmKey(undefined);
        return;
      }

      if (row.kind === 'add-source') {
        if (key.return || input === 'e') {
          setAddDraft({ step: 'url', url: '', name: '' });
          setEditBuffer('');
          setEditingKey(row.key);
        }
        return;
      }

      if (row.kind === 'restore-sources') {
        if (key.return) {
          updateRemoteSettings(restoreSourcesPatch(), 'source', `restored ${row.count} removed source${row.count === 1 ? '' : 's'}`);
          showMessage(`Restored ${row.count} source${row.count === 1 ? '' : 's'}`);
        }
        return;
      }

      if (row.kind === 'preview') {
        if (key.return) {
          const next = PREVIEW_OPTIONS[(PREVIEW_OPTIONS.indexOf(appSettings.previewPosition) + 1) % PREVIEW_OPTIONS.length]!;
          if (next !== 'off') setPreviewPosition(next);
          updateRemoteSettings({ previewPosition: next }, 'preview', `position = ${next}`);
        }
        return;
      }

      if (row.kind === 'config') {
        if (row.field === 'webUrl' && input === 'o') {
          if (needWebUrl('web-app') && config.webUrl) openInBrowser(config.webUrl, 'web-app');
          return;
        }
        if (!key.return && input !== 'e') return;
        if (isToggleField(row.field)) {
          const field = row.field;
          const on = config[field] === false;
          const err = onConfigChange({ [field]: on ? undefined : false });
          if (err) {
            audit.error('config', `${field} = ${on ? 'on' : 'off'}: ${err}`);
            showMessage(`⚠ Could not save: ${err}`, 6000);
          } else {
            audit.log('config', `${field} = ${on ? 'on' : 'off'}`);
          }
          return;
        }
        if (isPickerField(row.field)) {
          void openAccountPicker();
          return;
        }
        setEditBuffer(editStartValue(row.field));
        setEditingKey(row.key);
        return;
      }

      if (row.kind === 'action' && row.action === 'webapp' && input === 'o') {
        if (needWebUrl('web-app') && config.webUrl) openInBrowser(config.webUrl, 'web-app');
        return;
      }
      if (row.kind === 'action' && key.return) {
        switch (row.action) {
          case 'link': void doLink(); break;
          case 'webapp': void doWebAppQr(); break;
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

    // z asks before regrouping every topic with Copilot: z again within a few seconds runs it,
    // any other key cancels (Esc does nothing else).
    const regroupArmed = Date.now() - regroupArmedAt.current < REGROUP_CONFIRM_MS;
    regroupArmedAt.current = 0;
    if (regroupArmed) {
      clearTimeout(messageTimer.current);
      setMessage(undefined);
      if (key.escape) return;
    }
    if (input === 'z') {
      if (!digest) showMessage('Copilot is not available');
      else if (busyRef.current) showMessage(BUSY_MESSAGE);
      else if (regroupArmed) void doRegroup();
      else {
        regroupArmedAt.current = Date.now();
        showMessage('⚠ z again to regroup all topics · Esc cancels', REGROUP_CONFIRM_MS);
      }
      return;
    }

    // Audit trail of actions and errors
    if (input === 'a') {
      setShowAudit(true);
      setAuditIndex(0);
      return;
    }

    // Help
    if (input === 'h') {
      setHelpContext(grouped ? (filter === 'saved' ? 'saved' : 'digest') : showDetail ? 'detail' : 'list');
      setShowHelp(true);
      return;
    }

    // Search the current view (starts from the applied query)
    if (input === '/') {
      setSearchDraft(search);
      return;
    }

    // Pick which sources to show
    if (input === 'v') {
      void openSourcePicker();
      return;
    }

    // Detail-specific: Esc or q to close
    if (showDetail && (key.escape || key.backspace || key.delete)) {
      setShowDetail(false);
      return;
    }

    // Esc clears the search, then a source filter
    if (key.escape && search) {
      applySearch('');
      showMessage('Search cleared');
      return;
    }

    // Esc clears a source filter (set with v)
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
    if (input === '6') {
      setShowTodos(true);
      void loadTodos();
      return;
    }

    // References: 5 opens them, m files the selected update
    if (input === '5') {
      refs.openView();
      return;
    }
    if (input === 'm') {
      const sel = currentUpdate();
      if (sel) refs.fileUpdate(sel);
      else showMessage(grouped ? 'Expand the topic to file a single update' : 'Nothing selected');
      return;
    }

    // Navigation
    if (key.upArrow   || input === 'k') { setSelectedIndex((i) => Math.max(0, i - step));                return; }
    if (key.downArrow || input === 'j') { setSelectedIndex((i) => Math.max(0, Math.min(listLength - 1, i + step))); return; }

    if (key.tab) { cycleView(key.shift ? -1 : 1); return; }

    // Filters
    const filterMap: Record<string, FilterStatus> = { '1': 'all', '2': 'unread', '3': 'read', '4': 'saved' };
    if (input in filterMap) {
      const f = filterMap[input]!;
      // Pressing the current view's key again switches it between topics and a plain list
      if (f === filter && canGroup(f)) {
        const next = { ...groupedViewsRef.current, [f]: !groupedViewsRef.current[f] };
        groupedViewsRef.current = next;
        setGroupedViews(next);
        showMessage(`${f === 'unread' ? 'Unread' : 'Pending'}: ${next[f] ? 'grouped by topic' : 'list'}`);
      }
      setFilter(f);
      setSelectedIndex(0);
      void refresh(f);
      return;
    }

    // Toggle preview position (and show the preview, otherwise the key seems to do nothing)
    if (input === '.') {
      const next = previewPosition === 'bottom' ? 'right' : 'bottom';
      setPreviewPosition(next);
      setShowDetail(true);
      showMessage(`Preview on the ${next}`);
      return;
    }

    if (input === 'f') { void doFetch(); return; }
    // g summarises (or shows the saved summary); g again while it's shown regenerates it
    if (input === 'g') {
      const sel = currentUpdate();
      const armed = regenArmed.current;
      regenArmed.current = undefined;
      void doSummarize(!!sel?.gist && showDetail && armed?.id === sel.id && Date.now() - armed.at < REGROUP_CONFIRM_MS);
      return;
    }
    if (input === 'u' && showDetail) {
      const sel = currentUpdate();
      if (sel && !sel.content && !contentCache[sel.id]) void doFetchContent();
      return;
    }

    // s cycles the view's sort; the selected row stays selected
    if (input === 's') {
      if (grouped) {
        const view = filter as GroupableView;
        const next = nextSort(TOPIC_SORTS, sortsRef.current.topics[view]);
        sortsRef.current = { ...sortsRef.current, topics: { ...sortsRef.current.topics, [view]: next } };
        setSorts(sortsRef.current);
        const keep = digestRows[selectedIndex]?.key;
        const sorted = sortDigestEntries(digestEntriesRef.current, next);
        setDigestEntries(sorted);
        setSelectedIndex(Math.max(0, flattenDigest(sorted, expanded).findIndex((r) => r.key === keep)));
        showMessage(`Sort: ${next.label}`);
      } else {
        const next = nextSort(updateSorts(filter), sortsRef.current.list[filter]);
        sortsRef.current = { ...sortsRef.current, list: { ...sortsRef.current.list, [filter]: next } };
        setSorts(sortsRef.current);
        keepSelectedId.current = updates[selectedIndex]?.id;
        showMessage(`Sort: ${next.label}`);
        void loadUpdates(filter);
      }
      return;
    }

    // ── Digest and Pending views (grouped by topic) ──
    if (grouped) {
      const savedView = filter === 'saved';
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
      const rowIds = row.kind === 'item' ? [row.update.id] : entry.items.map((u) => u.id);
      if (savedView) {
        if (input === 'r') { doToggleDigestStatus(rowIds); return; }
        if (input === 'x') { void doDigestStatus(rowIds, 'read', true); return; }
        if (input === 'p') {
          if (update) void doUnsave(update.id);
          else showMessage('Expand the topic to change a single update');
          return;
        }
      }
      if (input === 'x') {
        void doDigestRead(rowIds, true);
        return;
      }
      if (input === 'r') {
        doToggleDigestStatus(rowIds);
        return;
      }
      if (input === 'p') {
        if (update) void doDigestToggleSaved(update);
        else showMessage('Expand the topic to mark a single update pending');
        return;
      }
      if (input === 'o') {
        const target = update ?? entry.items[0];
        if (target) {
          void import('open')
            .then(({ default: open }) => open(target.url))
            .catch((err) => {
              audit.error('open', `${target.url}: ${errorText(err)}`);
              showMessage('Could not open browser');
            });
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
      return;
    }

    if (key.return) { setShowDetail((prev) => !prev); return; }

    // Actions (work in both list and detail)
    if (input === 'r') { void doToggleStatus();   return; }
    if (input === 'p') { void doToggleSaved();    return; }
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
  const statusBar = (
    <StatusBar stats={stats} loading={loading} message={message} activity={activity} fetchInfo={fetchInfo} columns={columns} />
  );
  const searchMatches = grouped
    ? digestEntries.reduce((n, e) => n + e.items.length, 0)
    : listTotal;
  const sourceFilterLabel = !sourceFilter
    ? undefined
    : sourceFilter.length <= 2 ? sourceFilter.map(sourceName).join(', ') : `${sourceFilter.length} sources`;
  /** The active view's sort, when it isn't the default order. */
  const activeSortLabel = (() => {
    if (refs.active) return refs.sortLabel;
    if (showTodos) return isDefaultSort(TODO_SORTS, sorts.todos) ? undefined : sortLabel(TODO_SORTS, sorts.todos);
    if (grouped) {
      const sort = sorts.topics[filter as GroupableView];
      return isDefaultSort(TOPIC_SORTS, sort) ? undefined : sortLabel(TOPIC_SORTS, sort);
    }
    const options = updateSorts(filter);
    return isDefaultSort(options, sorts.list[filter]) ? undefined : sortLabel(options, sorts.list[filter]);
  })();

  const filterBar = (
    <FilterBar
      active={refs.active ? 'refs' : showTodos ? 'todos' : filter}
      groupedViews={groupedViews}
      columns={columns}
      sourceLabel={sourceFilterLabel}
      search={!showTodos && !refs.active && search ? search : undefined}
      matches={!showTodos && !refs.active && search ? searchMatches : undefined}
      searchDraft={searchDraft}
      sortLabel={activeSortLabel}
    />
  );

  const renderTable = (height: number, width: number) =>
    grouped ? (
      <DigestTable
        mode={filter === 'saved' ? 'saved' : 'digest'}
        rows={digestRows}
        expanded={expanded}
        pending={digestPending}
        grouping={digesting}
        selectedIndex={selectedIndex}
        height={height}
        columns={width}
        sourceLabels={appSettings.sourceLabels}
        sourceColors={appSettings.sourceColors}
        search={search || undefined}
      />
    ) : (
      <UpdatesTable
        updates={updates}
        search={search || undefined}
        selectedIndex={selectedIndex}
        height={height}
        columns={width}
        sourceLabels={appSettings.sourceLabels}
        sourceColors={appSettings.sourceColors}
      />
    );

  const renderDetail = (height: number, width: number, position: 'bottom' | 'right') => {
    if (grouped) {
      const row = digestRows[selectedIndex];
      if (!row) return null;
      if (digestSelectedUpdate) {
        const content = digestSelectedUpdate.content || contentCache[digestSelectedUpdate.id] || '';
        const loading = !digestSelectedUpdate.content && !(digestSelectedUpdate.id in contentCache);
        return (
          <DetailPane
            update={{ ...digestSelectedUpdate, content }}
            loading={loading}
            summarizing={summarizing.has(digestSelectedUpdate.id)}
            height={height}
            columns={width}
            position={position}
          />
        );
      }
      return (
        <TopicPane
          entry={row.entry}
          mode={filter === 'saved' ? 'saved' : 'digest'}
          height={height}
          columns={width}
          position={position}
          sourceLabels={appSettings.sourceLabels}
        />
      );
    }
    return selectedUpdate ? (
      <DetailPane
        update={selectedUpdate}
        summarizing={summarizing.has(selectedUpdate.id)}
        height={height}
        columns={width}
        position={position}
      />
    ) : null;
  };

  // Help overlay — replaces main content area
  if (showHelp) {
    return (
      <Box flexDirection="column" height={rows}>
        {statusBar}
        {filterBar}
        <HelpOverlay context={helpContext} height={availableH} columns={columns} search={helpSearch} searchTyping={helpSearchTyping} />
      </Box>
    );
  }

  if (showAudit) {
    return (
      <Box flexDirection="column" height={rows}>
        {statusBar}
        {filterBar}
        <AuditView
          file={auditFile}
          entries={auditEntries}
          focusIndex={auditIndex}
          errorsOnly={auditErrorsOnly}
          height={availableH}
          columns={columns}
        />
      </Box>
    );
  }

  if (linkView) {
    return (
      <Box flexDirection="column" height={rows}>
        {statusBar}
        {filterBar}
        <LinkOverlay link={linkView} height={availableH} columns={columns} />
      </Box>
    );
  }

  if (sourcePicker) {
    return (
      <Box flexDirection="column" height={rows}>
        {statusBar}
        {filterBar}
        <SourcePicker
          options={sourcePicker.options}
          checked={sourcePicker.checked}
          focusIndex={sourcePicker.focus}
          warning={sourcePicker.warning}
          height={availableH}
          columns={columns}
        />
      </Box>
    );
  }

  if (restoreFiles) {
    return (
      <Box flexDirection="column" height={rows}>
        {statusBar}
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

  if (showSettings && sourceDetails && detailsSource) {
    return (
      <Box flexDirection="column" height={rows}>
        {statusBar}
        {filterBar}
        <SourceDetailsPane
          source={detailsSource}
          state={sourceDetails}
          own={!!userSource(appSettings, sourceDetails.id)}
          changed={detailsChanged}
          stats={stats}
          items={stats?.bySource[sourceDetails.id] ?? 0}
          lastFetch={lastFetch[sourceDetails.id]}
          height={availableH}
          columns={columns}
        />
      </Box>
    );
  }

  if (accountPicker) {
    return (
      <Box flexDirection="column" height={rows}>
        {statusBar}
        {filterBar}
        <AccountPicker
          accounts={accountPicker.accounts}
          current={config.copilotAccount}
          automatic={automaticAccount()}
          error={accountPicker.error}
          focusIndex={accountPicker.focus}
          height={availableH}
          columns={columns}
        />
      </Box>
    );
  }

  // References view / file-a-link form — replaces main content area
  if (refs.active) {
    return (
      <Box flexDirection="column" height={rows}>
        {statusBar}
        {filterBar}
        <ReferencesView {...refs.view} height={availableH} columns={columns} />
      </Box>
    );
  }

  // Todos overlay — replaces main content area
  if (showTodos) {
    return (
      <Box flexDirection="column" height={rows}>
        {statusBar}
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
        {statusBar}
        {filterBar}
        <SettingsPane
          rows={settingsRows}
          settings={appSettings}
          config={config}
          stats={stats}
          lastFetch={lastFetch}
          focusIndex={settingsFocusIndex}
          search={settingsSearch}
          searchTyping={settingsSearchTyping}
          editBuffer={editingKey ? editBuffer : undefined}
          confirmKey={confirmKey}
          addStep={editingKey && addDraft ? addDraft.step : undefined}
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
        {statusBar}
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
      {statusBar}
      {filterBar}
      {renderTable(tableH, columns)}
      {showDetail && renderDetail(detailH, columns, 'bottom')}
    </Box>
  );
}
