import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DEFAULT_SETTINGS,
  patchDigest,
  removeFromDigest,
  type FomoService,
  type Update,
  type Status,
  type StatsResponse,
  type AppSettings,
  type DigestEntry,
} from '@fomo/core';

export type FilterStatus = Status | 'all' | 'saved' | 'todos';
/** Views that can be listed as topics; selecting the view again toggles it. */
export type GroupableView = 'unread' | 'saved';
export type GroupedViews = Record<GroupableView, boolean>;
export const canGroup = (f: FilterStatus): f is GroupableView => f === 'unread' || f === 'saved';
export const isGroupedView = (f: FilterStatus, g: GroupedViews) => canGroup(f) && g[f];

export interface FomoState {
  updates: Update[];
  total: number;
  hasMore: boolean;
  /** Topics of the Unread or Saved view when it is grouped. */
  digest: DigestEntry[];
  /** Updates in that view not yet grouped into topics by the Copilot digest. */
  pending: number;
  stats: StatsResponse | undefined;
  settings: AppSettings;
  loading: boolean;
  message: string | undefined;
  filter: FilterStatus;
  /** Whether Unread and Saved are grouped by topic (both start grouped). */
  grouped: GroupedViews;
  /** Applied search query, scoped to the current view ('' when off). */
  search: string;
  /** Only updates from these sources are shown (every view); undefined shows all. */
  sourceFilter: string[] | undefined;
  /** Lazily loaded update bodies (lists are fetched without content). */
  content: Record<string, string>;
}

export interface FomoActions {
  setFilter(f: FilterStatus): void;
  /** Switch the current Unread or Saved view between topics and a plain list. */
  toggleGrouped(): void;
  /** Search titles, summaries and content within the current view. */
  setSearch(q: string): void;
  /** Limit every view to these sources; undefined shows all. */
  setSourceFilter(ids: string[] | undefined): void;
  /** Updates per source in the current view (with the search, ignoring the source filter). */
  countSources(): Promise<Record<string, number>>;
  setStatus(id: string, status: Status): Promise<void>;
  /** Change read status in place so an update can be toggled back before refreshing or switching views. */
  setStatusMany(ids: string[], status: Status): Promise<void>;
  markRead(ids: string[]): Promise<void>;
  setSaved(id: string, saved: boolean): Promise<void>;
  loadContent(id: string): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  refresh(): Promise<void>;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useFomo(service: FomoService): FomoState & FomoActions {
  const [updates, setUpdates] = useState<Update[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [digest, setDigest] = useState<DigestEntry[]>([]);
  const [pending, setPending] = useState(0);
  const [stats, setStats] = useState<StatsResponse | undefined>();
  const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [filter, setFilterState] = useState<FilterStatus>('unread');
  const [grouped, setGrouped] = useState<GroupedViews>({ unread: true, saved: true });
  const groupedRef = useRef(grouped);
  const [content, setContent] = useState<Record<string, string>>({});
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const [search, setSearchState] = useState('');
  const searchRef = useRef(search);
  const [sourceFilter, setSourceFilterState] = useState<string[] | undefined>();
  const sourceFilterRef = useRef(sourceFilter);
  const loadSeq = useRef(0);
  const contentRequested = useRef(new Set<string>());

  const messageTimer = useRef<ReturnType<typeof setTimeout>>();
  const showMessage = useCallback((msg: string, ms = 2500) => {
    setMessage(msg);
    clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(undefined), ms);
  }, []);

  const loadView = useCallback(
    async (f: FilterStatus) => {
      if (f === 'todos') return;
      // Searches are slower full scans; drop responses superseded by a newer load.
      const seq = ++loadSeq.current;
      setLoading(true);
      try {
        const search = searchRef.current || undefined;
        const sources = sourceFilterRef.current;
        if (isGroupedView(f, groupedRef.current)) {
          const resp = await service.getDigest({ search, sources, saved: f === 'saved' });
          if (seq !== loadSeq.current) return;
          setDigest(resp.entries);
          setPending(resp.pending);
          return;
        }
        const resp = await service.listUpdates(f === 'saved'
          ? { saved: true, sources, search, limit: 200, includeContent: false }
          : { status: f, sources, search, limit: 200, includeContent: false });
        if (seq !== loadSeq.current) return;
        setUpdates(resp.updates);
        setTotal(resp.total);
        setHasMore(resp.hasMore);
      } catch (err) {
        if (seq !== loadSeq.current) return;
        showMessage(`Error loading updates: ${errorText(err)}`, 6000);
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [service, showMessage],
  );

  const loadStats = useCallback(async () => {
    try {
      setStats(await service.getStats());
    } catch {
      // non-critical
    }
  }, [service]);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await service.getSettings());
    } catch {
      // non-critical — use defaults
    }
  }, [service]);

  const refresh = useCallback(async () => {
    await Promise.all([loadView(filterRef.current), loadStats(), loadSettings()]);
  }, [loadView, loadStats, loadSettings]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setFilter = useCallback(
    (f: FilterStatus) => {
      setFilterState(f);
      filterRef.current = f;
      void loadView(f);
    },
    [loadView],
  );

  const toggleGrouped = useCallback(() => {
    const f = filterRef.current;
    if (!canGroup(f)) return;
    const next = { ...groupedRef.current, [f]: !groupedRef.current[f] };
    groupedRef.current = next;
    setGrouped(next);
    showMessage(`${f === 'unread' ? 'Unread' : 'Saved'}: ${next[f] ? 'grouped by topic' : 'list'}`);
    void loadView(f);
  }, [loadView, showMessage]);

  const setSearch = useCallback(
    (q: string) => {
      const next = q.trim();
      if (next === searchRef.current) return;
      searchRef.current = next;
      setSearchState(next);
      void loadView(filterRef.current);
    },
    [loadView],
  );

  const setSourceFilter = useCallback(
    (ids: string[] | undefined) => {
      sourceFilterRef.current = ids;
      setSourceFilterState(ids);
      void loadView(filterRef.current);
    },
    [loadView],
  );

  const countSources = useCallback(() => {
    const f = filterRef.current;
    return service.countSources({
      ...(f === 'saved' ? { saved: true } : { status: f === 'todos' ? 'all' : f }),
      search: searchRef.current || undefined,
      grouped: isGroupedView(f, groupedRef.current),
    });
  }, [service]);

  const setStatusMany = useCallback(
    async (ids: string[], status: Status) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      setUpdates((prev) => prev.map((u) => (idSet.has(u.id) ? { ...u, status } : u)));
      setDigest((prev) => patchDigest(prev, idSet, { status }));
      showMessage(`✓ ${ids.length > 1 ? `${ids.length} marked` : 'Marked'} ${status}`);
      try {
        await service.setStatusMany(ids, status);
        void loadStats();
      } catch (err) {
        showMessage(`Error: ${errorText(err)}`);
        await refresh();
      }
    },
    [service, showMessage, loadStats, refresh],
  );

  const setStatus = useCallback((id: string, status: Status) => setStatusMany([id], status), [setStatusMany]);
  const markRead = useCallback((ids: string[]) => setStatusMany(ids, 'read'), [setStatusMany]);

  const setSaved = useCallback(
    async (id: string, saved: boolean) => {
      setUpdates((prev) => prev.map((u) => (u.id === id ? { ...u, saved } : u)));
      setDigest((prev) => (
        !saved && filterRef.current === 'saved' ? removeFromDigest(prev, new Set([id])) : patchDigest(prev, new Set([id]), { saved })
      ));
      showMessage(saved ? '⭐ Saved' : 'Unsaved');
      try {
        await service.setSaved(id, saved);
        void loadStats();
      } catch (err) {
        showMessage(`Error: ${errorText(err)}`);
        await refresh();
      }
    },
    [service, showMessage, loadStats, refresh],
  );

  const loadContent = useCallback(
    async (id: string) => {
      if (contentRequested.current.has(id)) return;
      contentRequested.current.add(id);
      try {
        const full = await service.getUpdate(id);
        setContent((prev) => ({ ...prev, [id]: full.content }));
      } catch {
        contentRequested.current.delete(id);
        setContent((prev) => ({ ...prev, [id]: '' }));
      }
    },
    [service],
  );

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      try {
        setSettings(await service.updateSettings(patch));
        showMessage('✓ Settings saved');
      } catch (err) {
        showMessage(`Settings error: ${errorText(err)}`);
      }
    },
    [service, showMessage],
  );

  return {
    updates,
    total,
    hasMore,
    digest,
    pending,
    stats,
    settings,
    loading,
    message,
    filter,
    grouped,
    search,
    sourceFilter,
    content,
    setFilter,
    toggleGrouped,
    setSearch,
    setSourceFilter,
    countSources,
    setStatus,
    setStatusMany,
    markRead,
    setSaved,
    loadContent,
    updateSettings,
    refresh,
  };
}
