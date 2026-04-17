import { useState, useEffect, useCallback, useRef } from 'react';
import { FomoClient, type Update, type Status, type StatsResponse, type AppSettings, DEFAULT_SETTINGS } from '@fomo/core';

type FilterStatus = Status | 'all' | 'saved';

export interface FomoState {
  updates: Update[];
  total: number;
  hasMore: boolean;
  stats: StatsResponse | undefined;
  settings: AppSettings;
  loading: boolean;
  message: string | undefined;
  selectedId: string | undefined;
  filter: FilterStatus;
}

export interface FomoActions {
  setFilter(f: FilterStatus): void;
  setSelectedId(id: string | undefined): void;
  setStatus(id: string, status: Status): Promise<void>;
  setSaved(id: string, saved: boolean): Promise<void>;
  triggerFetch(sources?: string[]): Promise<void>;
  fetchContent(id: string): Promise<Update | undefined>;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  refresh(): Promise<void>;
}

export function useFomo(client: FomoClient): FomoState & FomoActions {
  const [updates, setUpdates] = useState<Update[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<StatsResponse | undefined>();
  const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [filter, setFilterState] = useState<FilterStatus>('all');
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const showMessage = useCallback((msg: string, ms = 2500) => {
    setMessage(msg);
    setTimeout(() => setMessage(undefined), ms);
  }, []);

  const loadUpdates = useCallback(
    async (f: FilterStatus) => {
      setLoading(true);
      try {
        const opts = f === 'saved'
          ? { saved: true, limit: 200 }
          : { status: f as Status | 'all', limit: 200 };
        const resp = await client.listUpdates(opts);
        setUpdates(resp.updates);
        setTotal(resp.total);
        setHasMore(resp.hasMore);
      } catch (err) {
        showMessage(`Error loading updates: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    },
    [client, showMessage],
  );

  const loadStats = useCallback(async () => {
    try {
      const s = await client.getStats();
      setStats(s);
    } catch {
      // non-critical
    }
  }, [client]);

  const loadSettings = useCallback(async () => {
    try {
      const s = await client.getSettings();
      setSettings(s);
    } catch {
      // non-critical — use defaults
    }
  }, [client]);

  const refresh = useCallback(async () => {
    await Promise.all([loadUpdates(filterRef.current), loadStats(), loadSettings()]);
  }, [loadUpdates, loadStats, loadSettings]);

  useEffect(() => {
    void refresh();
  }, []); // Run once on mount — refresh is stable but not needed in deps

  const setFilter = useCallback(
    (f: FilterStatus) => {
      setFilterState(f);
      filterRef.current = f;
      void loadUpdates(f);
    },
    [loadUpdates],
  );

  const setStatus = useCallback(
    async (id: string, status: Status) => {
      // Optimistic update (matches CLI behavior)
      setUpdates((prev) => prev.map((u) => (u.id === id ? { ...u, status } : u)));
      showMessage(`Marked ${status}`);
      try {
        await client.setStatus(id, status);
        void loadStats();
      } catch (err) {
        showMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
        await refresh();
      }
    },
    [client, showMessage, loadStats, refresh],
  );

  const setSaved = useCallback(
    async (id: string, saved: boolean) => {
      // Optimistic update (matches CLI behavior)
      setUpdates((prev) => prev.map((u) => (u.id === id ? { ...u, saved } : u)));
      showMessage(saved ? '⭐ Saved' : 'Unsaved');
      try {
        await client.setSaved(id, saved);
        void loadStats();
      } catch (err) {
        showMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
        await refresh();
      }
    },
    [client, showMessage, loadStats, refresh],
  );

  const fetchContent = useCallback(
    async (id: string): Promise<Update | undefined> => {
      setLoading(true);
      showMessage('Fetching content…');
      try {
        const updated = await client.fetchContent(id);
        setUpdates((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
        showMessage('✓ Content fetched');
        return updated;
      } catch (err) {
        showMessage(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [client, showMessage],
  );

  const triggerFetch = useCallback(
    async (sources?: string[]) => {
      setLoading(true);
      showMessage('Fetching updates…');
      try {
        const resp = await client.fetch({ sources });
        showMessage(`✓ Added ${resp.added} new update${resp.added !== 1 ? 's' : ''}`);
        await refresh();
      } catch (err) {
        showMessage(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    },
    [client, showMessage, refresh],
  );

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      try {
        const updated = await client.updateSettings(patch);
        setSettings(updated);
        showMessage('✓ Settings saved');
      } catch (err) {
        showMessage(`Settings error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [client, showMessage],
  );

  return {
    updates,
    total,
    hasMore,
    stats,
    settings,
    loading,
    message,
    selectedId,
    filter,
    setFilter,
    setSelectedId,
    setStatus,
    setSaved,
    triggerFetch,
    fetchContent,
    updateSettings,
    refresh,
  };
}
