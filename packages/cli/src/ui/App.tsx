import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, useInput, useApp } from 'ink';
import type { FomoService, Update, Status, StatsResponse, PreviewPosition, SourceInfo, AppSettings } from '@fomo/core';
import { DEFAULT_SETTINGS } from '@fomo/core';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { UpdatesTable } from './components/UpdatesTable.js';
import { StatusBar } from './components/StatusBar.js';
import { DetailPane } from './components/DetailPane.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { FilterBar } from './components/FilterBar.js';
import { SettingsPane, PREVIEW_OPTIONS } from './components/SettingsPane.js';

type FilterStatus = Status | 'all' | 'saved';

interface Props {
  service: FomoService;
}

// Fixed line counts for chrome
const STATUSBAR_H = 2; // content + border line
const FILTERBAR_H = 1;

export function App({ service }: Props) {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();

  const [updates, setUpdates] = useState<Update[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState<FilterStatus>('all');
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
  const [helpContext, setHelpContext] = useState<'list' | 'detail' | 'settings'>('list');

  // Keep refs so async callbacks always see the latest state
  const updatesRef  = useRef(updates);
  const selectedRef = useRef(selectedIndex);
  const filterRef   = useRef(filter);
  useEffect(() => { updatesRef.current  = updates;      }, [updates]);
  useEffect(() => { selectedRef.current = selectedIndex; }, [selectedIndex]);
  useEffect(() => { filterRef.current   = filter;       }, [filter]);

  // Load remote settings and sources on mount
  useEffect(() => {
    service.getSettings().then((s) => {
      setAppSettings(s);
      const pos = s.previewPosition === 'off' ? 'bottom' : s.previewPosition;
      setPreviewPosition(pos as 'right' | 'bottom');
    }).catch(() => { /* use default */ });
    service.getSources().then(setSources).catch(() => { /* ignore */ });
  }, [service]);

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
  const doFetch = useCallback(async () => {
    setLoading(true);
    showMessage('Fetching…');
    try {
      const resp = await service.fetch();
      await refresh();
      showMessage(`✓ Added ${resp.added} update${resp.added !== 1 ? 's' : ''}`);
    } catch (err) {
      showMessage(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [service, refresh, showMessage]);

  const doFetchContent = useCallback(async () => {
    const selected = updatesRef.current[selectedRef.current];
    if (!selected) return;
    setLoading(true);
    showMessage('Fetching content…');
    try {
      const updated = await service.fetchContent(selected.id);
      setUpdates((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      showMessage('✓ Content fetched');
    } catch (err) {
      showMessage(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [service, showMessage]);

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

  // Auto-fetch every hour while UI is open
  useEffect(() => {
    const id = setInterval(() => { void doFetch(); }, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [doFetch]);

  // ── Input handler ───────────────────────────────────────────────────────────
  useInput((input, key) => {
    // ── Help overlay — Esc or h to close, consume all other input ──
    if (showHelp) {
      if (key.escape || key.backspace || input === 'h') setShowHelp(false);
      return;
    }

    // ── Settings view input handling ──
    if (showSettings) {
      // Label edit mode — character input
      if (editingLabel) {
        if (key.escape || key.backspace) {
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

      if (key.escape || key.backspace || input === 'c') {
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
      setHelpContext(showDetail ? 'detail' : 'list');
      setShowHelp(true);
      return;
    }

    // Detail-specific: Esc or q to close
    if (showDetail && (key.escape || key.backspace || input === 'q')) {
      setShowDetail(false);
      return;
    }

    // Quit only from list view
    if (!showDetail && input === 'q') { exit(); return; }

    // Open settings
    if (input === 'c') {
      setShowSettings(true);
      setSettingsFocusIndex(0);
      return;
    }

    // Navigation
    if (key.upArrow   || input === 'k') { setSelectedIndex((i) => Math.max(0, i - 1));                                return; }
    if (key.downArrow || input === 'j') { setSelectedIndex((i) => Math.min(updatesRef.current.length - 1, i + 1));     return; }
    if (key.return)                     { setShowDetail((prev) => !prev);                                              return; }

    // Filters
    const filterMap: Record<string, FilterStatus> = { '1': 'all', '2': 'unread', '3': 'read', '4': 'saved' };
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

    // Actions (work in both list and detail)
    if (input === 'r') { void doMark('read');     return; }
    if (input === 'u') { void doMark('unread');   return; }
    if (input === 's') { void doToggleSaved();    return; }
    if (input === 'x') { void doReadAndNext();    return; }
    if (input === 'o') { void doOpen();         return; }
    if (input === 'f') { void doFetch(); return; }
    if (input === 'p' && showDetail) {
      const sel = updatesRef.current[selectedRef.current];
      if (sel && !sel.content) void doFetchContent();
      return;
    }
  });

  // ── Layout calculations ─────────────────────────────────────────────────────
  const chrome = STATUSBAR_H + FILTERBAR_H;
  const availableH = rows - chrome;
  const selectedUpdate = updates[selectedIndex];

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
            <UpdatesTable
              updates={updates}
              selectedIndex={selectedIndex}
              height={availableH}
              columns={tableW}
              sourceLabels={appSettings.sourceLabels}
            />
          </Box>
          <Box borderStyle="single" borderLeft borderTop={false} borderRight={false} borderBottom={false} borderColor="gray">
            <Box width={detailW - 2}>
              {selectedUpdate && (
                <DetailPane
                  update={selectedUpdate}
                  height={availableH}
                  columns={detailW - 2}
                  position="right"
                />
              )}
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
      <UpdatesTable
        updates={updates}
        selectedIndex={selectedIndex}
        height={tableH}
        columns={columns}
        sourceLabels={appSettings.sourceLabels}
      />
      {showDetail && selectedUpdate && (
        <DetailPane
          update={selectedUpdate}
          height={detailH}
          columns={columns}
          position="bottom"
        />
      )}
    </Box>
  );
}
