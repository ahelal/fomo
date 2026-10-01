import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { AppSettings, PreviewPosition, SourceFetchResult, StatsResponse } from '@fomo/core';
import { maskConnectionString, readConfigFile, type LocalConfig } from '../../config.js';
import { configDisplay, rowHint, type SettingsRow } from '../settings.js';

interface Props {
  rows: SettingsRow[];
  settings: AppSettings;
  config: LocalConfig;
  stats?: StatsResponse;
  /** Result of the last fetch per source in this session. */
  lastFetch: Record<string, SourceFetchResult>;
  focusIndex: number;
  /** Text being typed into the focused row, when editing. */
  editBuffer?: string;
  /** Key of the action row waiting for a second ↵. */
  confirmKey?: string;
  height: number;
  columns: number;
}

const PREVIEW_OPTIONS: PreviewPosition[] = ['right', 'bottom', 'off'];

const COLOR_PALETTE = [
  '#58a6ff', // cyan (default)
  '#3fb950', // green
  '#e3b341', // yellow
  '#f85149', // red
  '#bc8cff', // purple
  '#f78166', // orange
  '#79c0ff', // light blue
  '#d2a8ff', // lavender
  '#ff7b72', // coral
  '#7ee787', // mint
  '#06b6d4', // teal
  '#f472b6', // pink
  '#fb923c', // amber
  '#a3e635', // lime
  '#34d399', // emerald
  '#e879f9', // fuchsia
  '#fbbf24', // gold
  '#818cf8', // indigo
  '#f87171', // rose
  '#94a3b8', // slate
];

const BG = '#0d1117';
const FOCUS_BG = '#1c2d4f';
const NAME_W = 22;

const clip = (s: string, w: number) => (w <= 0 ? '' : s.length > w ? `${s.slice(0, Math.max(0, w - 1))}…` : s);
/** Keep the end of the text visible while typing. */
const tail = (s: string, w: number) => (w <= 0 ? '' : s.length > w ? `…${s.slice(s.length - w + 1)}` : s);

export const SettingsPane = React.memo(function SettingsPane({
  rows,
  settings,
  config,
  stats,
  lastFetch,
  focusIndex,
  editBuffer,
  confirmKey,
  height,
  columns,
}: Props) {
  const disabledSet = new Set(settings.disabledSources);
  const headerH = 3;
  const footerH = 2;
  const listH = Math.max(1, height - headerH - footerH);
  const start = Math.max(0, Math.min(focusIndex - Math.floor(listH / 2), rows.length - listH));
  const visible = rows.slice(start, start + listH);
  const innerW = Math.max(20, columns - 4);
  const restW = Math.max(0, innerW - 4 - NAME_W);
  const editing = editBuffer !== undefined;
  const focused = rows[focusIndex];
  // Read once per config change: tells which values come from environment variables
  const file = useMemo(() => {
    try { return readConfigFile(); } catch { return {}; }
  }, [config]);

  const editBox = (text: string) => (
    <Text color="#e3b341" backgroundColor="#2d1b00">{` ${tail(text, restW - 3)}▏`.padEnd(restW)}</Text>
  );

  const renderRow = (row: SettingsRow, index: number) => {
    if (row.kind === 'header') {
      const label = ` ${row.label} `;
      return (
        <Text key={row.key} wrap="truncate">
          <Text color="#30363d">{'──'}</Text>
          <Text color="#58a6ff" bold>{label}</Text>
          <Text color="#30363d">{'─'.repeat(Math.max(0, innerW - label.length - 2))}</Text>
        </Text>
      );
    }

    const isFocused = index === focusIndex;
    const bg = isFocused ? FOCUS_BG : BG;
    const cursor = <Text color="#1c7cd6" backgroundColor={bg}>{isFocused ? '▸ ' : '  '}</Text>;
    const name = (label: string, color = '#f0f6fc') => (
      <Text color={color} backgroundColor={bg}>{clip(label, NAME_W - 1).padEnd(NAME_W)}</Text>
    );
    const fill = (used: number) => <Text backgroundColor={bg}>{' '.repeat(Math.max(0, restW - used))}</Text>;

    if (row.kind === 'action') {
      const confirming = confirmKey === row.key;
      const hint = clip(confirming ? 'press ↵ again to confirm · Esc cancel' : row.hint, restW);
      return (
        <Text key={row.key} wrap="truncate">
          {cursor}
          <Text color="#bc8cff" backgroundColor={bg}>{'» '}</Text>
          {name(row.label)}
          <Text color={confirming ? '#e3b341' : '#8b949e'} backgroundColor={bg}>{hint}</Text>
          {fill(hint.length)}
        </Text>
      );
    }

    if (row.kind === 'source') {
      const id = row.source.id;
      const enabled = !disabledSet.has(id);
      if (isFocused && editing) {
        return (
          <Text key={row.key} wrap="truncate">
            {cursor}
            <Text color={enabled ? '#3fb950' : '#f85149'} backgroundColor={bg}>{enabled ? '● ' : '○ '}</Text>
            {name(row.source.displayName)}
            {editBox(editBuffer)}
          </Text>
        );
      }
      const status = (enabled ? 'enabled' : 'disabled').padEnd(10);
      const label = clip(settings.sourceLabels[id] ?? '', 12).padEnd(14);
      const count = `${stats?.bySource[id] ?? 0} items`.padEnd(11);
      const result = lastFetch[id];
      const last = clip(result ? (result.error ? `⚠ ${result.error}` : `+${result.added} new`) : '', Math.max(0, restW - 37));
      return (
        <Text key={row.key} wrap="truncate">
          {cursor}
          <Text color={enabled ? '#3fb950' : '#f85149'} backgroundColor={bg}>{enabled ? '● ' : '○ '}</Text>
          {name(row.source.displayName, enabled ? '#f0f6fc' : '#8b949e')}
          <Text color={enabled ? '#3fb950' : '#f85149'} backgroundColor={bg}>{status}</Text>
          <Text color={settings.sourceColors?.[id] || COLOR_PALETTE[0]} backgroundColor={bg}>{'■ '}</Text>
          <Text color="#58a6ff" backgroundColor={bg}>{label}</Text>
          <Text color="#8b949e" backgroundColor={bg}>{count}</Text>
          <Text color={result?.error ? '#f85149' : '#3fb950'} backgroundColor={bg}>{last}</Text>
          {fill(37 + last.length)}
        </Text>
      );
    }

    if (row.kind === 'preview') {
      return (
        <Text key={row.key} wrap="truncate">
          {cursor}
          <Text color="#58a6ff" backgroundColor={bg}>{'◆ '}</Text>
          {name('Preview position')}
          <Text color="#58a6ff" backgroundColor={bg}>{settings.previewPosition}</Text>
          {fill(settings.previewPosition.length)}
        </Text>
      );
    }

    // Local config field
    if (isFocused && editing) {
      return (
        <Text key={row.key} wrap="truncate">
          {cursor}
          <Text color="#58a6ff" backgroundColor={bg}>{'◆ '}</Text>
          {name(row.label)}
          {editBox(row.field === 'connectionString' ? maskConnectionString(editBuffer) : editBuffer)}
        </Text>
      );
    }
    const shown = configDisplay(config, row.field, file);
    const envTag = shown.env ? ` [${shown.env}]` : '';
    const value = clip(shown.value, restW - envTag.length);
    return (
      <Text key={row.key} wrap="truncate">
        {cursor}
        <Text color="#58a6ff" backgroundColor={bg}>{'◆ '}</Text>
        {name(row.label)}
        <Text color={shown.muted ? '#8b949e' : '#c9d1d9'} backgroundColor={bg}>{value}</Text>
        <Text color="#e3b341" backgroundColor={bg}>{envTag}</Text>
        {fill(value.length + envTag.length)}
      </Text>
    );
  };

  const footer = editing
    ? `type ${focused?.kind === 'source' ? 'a label' : 'a value'}   ↵ save   Esc cancel   (empty resets to the default)`
    : `${rowHint(focused)}${rowHint(focused) ? '   ' : ''}Esc close   h help`;

  return (
    <Box flexDirection="column" height={height} width={columns}>
      <Box paddingX={2} paddingTop={1}>
        <Text color="#f0f6fc" bold>{'⚙️  Config'}</Text>
      </Box>
      <Box height={1} />

      <Box flexDirection="column" paddingX={2} height={listH} overflowY="hidden">
        {visible.map((row, i) => renderRow(row, start + i))}
      </Box>

      <Box height={1} />
      <Box paddingX={2}>
        <Text color="#8b949e" wrap="truncate">{footer}</Text>
      </Box>
    </Box>
  );
});

export { PREVIEW_OPTIONS, COLOR_PALETTE };
