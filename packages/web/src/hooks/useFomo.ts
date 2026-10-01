import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DEFAULT_SETTINGS,
  removeFromDigest,
  type FomoService,
  type Update,
  type Status,
  type StatsResponse,
  type AppSettings,
  type DigestEntry,
} from '@fomo/core';

export type FilterStatus = Status | 'all' | 'saved' | 'digest' | 'todos';

export interface FomoState {
  updates: Update[];
  total: number;
  hasMore: boolean;
  digest: DigestEntry[];
  /** Unread updates not yet grouped by `fomo digest`. */
  pending: number;
  stats: StatsResponse | undefined;
  settings: AppSettings;
  loading: boolean;
  message: string | undefined;
  filter: FilterStatus;
  /** Lazily loaded update bodies (lists are fetched without content). */
  content: Record<string, string>;
}

export interface FomoActions {
  setFilter(f: FilterStatus): void;
  setStatus(id: string, status: Status): Promise<void>;
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
  const [filter, setFilterState] = useState<FilterStatus>('digest');
  const [content, setContent] = useState<Record<string, string>>({});
  const filterRef = useRef(filter);
  filterRef.current = filter;
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
      setLoading(true);
      try {
        if (f === 'digest') {
          const resp = await service.getDigest();
          setDigest(resp.entries);
          setPending(resp.pending);
          return;
        }
        const opts = f === 'saved'
          ? { saved: true, limit: 200, includeContent: false }
          : { status: f, limit: 200, includeContent: false };
        const resp = await service.listUpdates(opts);
        setUpdates(resp.updates);
        setTotal(resp.total);
        setHasMore(resp.hasMore);
      } catch (err) {
        showMessage(`Error loading updates: ${errorText(err)}`, 6000);
      } finally {
        setLoading(false);
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

  const setStatus = useCallback(
    async (id: string, status: Status) => {
      setUpdates((prev) => prev.map((u) => (u.id === id ? { ...u, status } : u)));
      if (status === 'read') setDigest((prev) => removeFromDigest(prev, new Set([id])));
      showMessage(`Marked ${status}`);
      try {
        await service.setStatus(id, status);
        void loadStats();
      } catch (err) {
        showMessage(`Error: ${errorText(err)}`);
        await refresh();
      }
    },
    [service, showMessage, loadStats, refresh],
  );

  const markRead = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      setUpdates((prev) => prev.map((u) => (idSet.has(u.id) ? { ...u, status: 'read' as Status } : u)));
      setDigest((prev) => removeFromDigest(prev, idSet));
      showMessage(ids.length > 1 ? `✓ ${ids.length} marked read` : '✓ Marked read');
      try {
        await service.setStatusMany(ids, 'read');
        void loadStats();
      } catch (err) {
        showMessage(`Error: ${errorText(err)}`);
        await refresh();
      }
    },
    [service, showMessage, loadStats, refresh],
  );

  const setSaved = useCallback(
    async (id: string, saved: boolean) => {
      setUpdates((prev) => prev.map((u) => (u.id === id ? { ...u, saved } : u)));
      setDigest((prev) => prev.map((e) => (
        e.items.some((u) => u.id === id)
          ? { ...e, items: e.items.map((u) => (u.id === id ? { ...u, saved } : u)) }
          : e
      )));
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
    content,
    setFilter,
    setStatus,
    markRead,
    setSaved,
    loadContent,
    updateSettings,
    refresh,
  };
}
