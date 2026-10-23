import React from 'react';
import { Box, Text } from 'ink';
import { DEFAULT_COLOR, timeAgo, type AppSettings, type PreviewPosition, type SourceFetchResult, type StatsResponse } from '@fomo/core';
import type { LocalConfig } from '../../config.js';
import { DEFAULT_SOURCE_COLOR } from './UpdatesTable.js';
import { ADD_SOURCE_PROMPTS, configDisplay, isSecretField, maskSetting, rowHint, type AddSourceStep, type SettingsRow } from '../settings.js';

interface Props {
  rows: SettingsRow[];
  settings: AppSettings;
  config: LocalConfig;
  /** What the profile's config file stores, without environment overrides: tells which values come from environment variables. */
  file: LocalConfig;
  /** Profile in use. */
  profile: string;
  stats?: StatsResponse;
  /** Result of the last fetch per source in this session. */
  lastFetch: Record<string, SourceFetchResult>;
  focusIndex: number;
  /** `/` filter of the rows. */
  search?: string;
  /** The filter is being typed. */
  searchTyping?: boolean;
  /** Text being typed into the focused row, when editing. */
  editBuffer?: string;
  /** Key of the action row waiting for a second ↵. */
  confirmKey?: string;
  /** Step of adding a source being typed. */
  addStep?: AddSourceStep;
  height: number;
  columns: number;
}

const PREVIEW_OPTIONS: PreviewPosition[] = ['right', 'bottom', 'off'];

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
  file,
  profile,
  stats,
  lastFetch,
  focusIndex,
  search = '',
  searchTyping = false,
  editBuffer,
  confirmKey,
  addStep,
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

  const editBox = (text: string) => (
    <Text color="#e3b341" backgroundColor="#2d1b00">{` ${tail(text, restW - 3)}▏`.padEnd(restW)}</Text>
  );

  const renderRow = (row: SettingsRow, index: number) => {
    const isFocused = index === focusIndex;
    if (row.kind === 'header') {
      const label = ` ${row.collapsed ? '▸' : '▾'} ${row.label}${row.collapsed ? ` (${row.count})` : ''} `;
      const hbg = isFocused ? FOCUS_BG : undefined;
      return (
        <Text key={row.key} wrap="truncate">
          <Text color="#30363d" backgroundColor={hbg}>{'──'}</Text>
          <Text color="#58a6ff" backgroundColor={hbg} bold>{label}</Text>
          <Text color="#30363d" backgroundColor={hbg}>{'─'.repeat(Math.max(0, innerW - label.length - 2))}</Text>
        </Text>
      );
    }

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
      const items = stats?.bySource[id] ?? 0;
      if (confirmKey === row.key) {
        const ask = clip(
          row.source.removed ? `press x again to delete its ${items} items · Esc cancel`
          : items > 0 ? `x again: remove, keep its ${items} items · d: delete them too · Esc cancel`
          : `press x again to remove${row.source.builtin ? ' (restore it later from the end of the list)' : ''} · Esc cancel`,
          restW,
        );
        return (
          <Text key={row.key} wrap="truncate">
            {cursor}
            <Text color={enabled ? '#3fb950' : '#f85149'} backgroundColor={bg}>{enabled ? '● ' : '○ '}</Text>
            {name(row.source.displayName)}
            <Text color="#e3b341" backgroundColor={bg}>{ask}</Text>
            {fill(ask.length)}
          </Text>
        );
      }
      if (row.source.removed) {
        const note = clip(`removed · ${items} items still stored`, restW);
        return (
          <Text key={row.key} wrap="truncate">
            {cursor}
            <Text color="#6e7681" backgroundColor={bg}>{'○ '}</Text>
            {name(row.source.displayName, '#6e7681')}
            <Text color="#6e7681" backgroundColor={bg}>{note}</Text>
            {fill(note.length)}
          </Text>
        );
      }
      const status = (enabled ? 'enabled' : 'disabled').padEnd(10);
      const label = clip(settings.sourceLabels[id] ?? '', 12).padEnd(14);
      const count = `${stats?.bySource[id] ?? 0} items`.padEnd(11);
      const result = lastFetch[id];
      const history = stats?.sourceStatus?.[id];
      const error = history ? history.lastError : result?.error;
      const added = (result && !result.error ? `+${result.added} new` : '').padEnd(9);
      const newest = (history?.lastAddedAt ? `last new ${timeAgo(history.lastAddedAt)}` : '').padEnd(17);
      const fetchedAt = history?.lastFetchAt ? timeAgo(history.lastFetchAt) : '';
      const fetched = error ? `⚠ ${fetchedAt ? `${fetchedAt}: ` : ''}${error}` : fetchedAt ? `✓ fetched ${fetchedAt}` : '';
      const used = 37 + added.length + newest.length;
      const last = clip(fetched, Math.max(0, restW - used));
      return (
        <Text key={row.key} wrap="truncate">
          {cursor}
          <Text color={enabled ? '#3fb950' : '#f85149'} backgroundColor={bg}>{enabled ? '● ' : '○ '}</Text>
          {name(row.source.displayName, enabled ? '#f0f6fc' : '#8b949e')}
          <Text color={enabled ? '#3fb950' : '#f85149'} backgroundColor={bg}>{status}</Text>
          <Text color={settings.sourceColors?.[id] || DEFAULT_SOURCE_COLOR[id] || DEFAULT_COLOR} backgroundColor={bg}>{'■ '}</Text>
          <Text color="#58a6ff" backgroundColor={bg}>{label}</Text>
          <Text color="#8b949e" backgroundColor={bg}>{count}</Text>
          <Text color="#3fb950" backgroundColor={bg}>{added}</Text>
          <Text color="#c9d1d9" backgroundColor={bg}>{newest}</Text>
          <Text color={error ? '#f85149' : '#8b949e'} backgroundColor={bg}>{last}</Text>
          {fill(used + last.length)}
        </Text>
      );
    }

    if (row.kind === 'add-source' || row.kind === 'restore-sources') {
      const add = row.kind === 'add-source';
      const label = add ? (isFocused && editing && addStep ? `Add source · ${addStep}` : 'Add source') : 'Restore removed';
      if (add && isFocused && editing) {
        return (
          <Text key={row.key} wrap="truncate">
            {cursor}
            <Text color="#3fb950" backgroundColor={bg}>{'+ '}</Text>
            {name(label)}
            {editBox(editBuffer)}
          </Text>
        );
      }
      const hint = clip(add ? 'RSS/Atom feed, GitHub repository releases or YouTube channel' : `${row.count} built-in source${row.count === 1 ? '' : 's'} removed`, restW);
      return (
        <Text key={row.key} wrap="truncate">
          {cursor}
          <Text color={add ? '#3fb950' : '#e3b341'} backgroundColor={bg}>{add ? '+ ' : '↺ '}</Text>
          {name(label)}
          <Text color="#8b949e" backgroundColor={bg}>{hint}</Text>
          {fill(hint.length)}
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
          {editBox(isSecretField(row.field) ? maskSetting(row.field, editBuffer) : editBuffer)}
        </Text>
      );
    }
    const shown = configDisplay(config, row.field, file, profile);
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

  const footer = searchTyping
    ? `/${search}▏   ↵ keep   ↑↓ move   Esc clear`
    : editing && addStep
    ? `type ${ADD_SOURCE_PROMPTS[addStep]}   ↵ next   Esc cancel`
    : editing
    ? `type ${focused?.kind === 'source' ? 'a label' : 'a value'}   ↵ save   Esc cancel   (empty resets to the default)`
    : `${rowHint(focused)}${rowHint(focused) ? '   ' : ''}/ search   ${search ? 'Esc clear search' : 'Esc close'}   h help`;

  return (
    <Box flexDirection="column" height={height} width={columns}>
      <Box paddingX={2} paddingTop={1}>
        <Text color="#f0f6fc" bold>{'⚙️  Config'}</Text>
        {search && !searchTyping && <Text color="#e3b341">{`   / ${search}`}</Text>}
        {search && rows.length === 0 && <Text color="#8b949e">{'   no matches'}</Text>}
        {rows.length > listH && (
          <Text color="#8b949e">
            {`   ${start > 0 ? '↑' : ' '}${start + listH < rows.length ? '↓' : ' '} rows ${start + 1}–${Math.min(rows.length, start + listH)} of ${rows.length}`}
          </Text>
        )}
      </Box>
      <Box height={1} />

      <Box flexDirection="column" paddingX={2} height={listH} overflowY="hidden">
        {visible.map((row, i) => renderRow(row, start + i))}
      </Box>

      <Box height={1} />
      <Box paddingX={2}>
        <Text color={searchTyping ? '#e3b341' : '#8b949e'} wrap="truncate">{footer}</Text>
      </Box>
    </Box>
  );
});

export { PREVIEW_OPTIONS };
