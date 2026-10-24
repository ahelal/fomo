import React from 'react';
import { Box, Text } from 'ink';
import { DEFAULT_COLOR, MAX_SOURCE_LABEL_LENGTH, timeAgo, type AppSettings, type PreviewPosition, type SourceFetchResult, type SourceKind, type StatsResponse } from '@fomo/core';
import type { LocalConfig } from '../../config.js';
import { EXPERIMENTAL_SETUPS, type ExperimentalSetups } from '../../experimental/index.js';
import { DEFAULT_SOURCE_COLOR } from './UpdatesTable.js';
import { ADD_SOURCE_PROMPTS, configDisplay, experimentalOn, fetchCovers, isSecretField, maskSetting, rowHint, type AddSourceStep, type FetchScope, type SettingsRow } from '../settings.js';

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
  /** Setup of the experimental sources (what turning one on agrees to). */
  experimental?: ExperimentalSetups;
  /** The experimental source being signed in to. */
  signingIn?: string;
  /** The sources being fetched right now. */
  fetching?: FetchScope;
  height: number;
  columns: number;
}

const PREVIEW_OPTIONS: PreviewPosition[] = ['right', 'bottom', 'off'];

const BG = '#0d1117';
const FOCUS_BG = '#1c2d4f';
const PENDING = '#e3b341';
export const SIGNING_IN_STATUS = 'sign-in…';
export const SIGNING_IN_NOTE = '⟳ signing in — check your browser or account picker';
export const FETCHING_NOTE = '⟳ fetching…';
const NAME_W = 22;
const STATUS_W = 10;
const TYPE_W = 16;
const LABEL_W = 14;
const ITEMS_W = 7;
const NEW_W = 7;
const LAST_NEW_W = 12;

const SOURCE_TYPE: Record<SourceKind, string> = {
  feed: 'RSS/Atom',
  'github-releases': 'GitHub releases',
  youtube: 'YouTube',
  custom: 'Custom',
};

const clip = (s: string, w: number) => (w <= 0 ? '' : s.length > w ? `${s.slice(0, Math.max(0, w - 1))}…` : s);
export const fixedColumn = (value: string, width: number, align: 'left' | 'right' = 'left') => {
  const clipped = value.length > width ? `${value.slice(0, Math.max(0, width - 1))}…` : value;
  return align === 'right' ? clipped.padStart(width) : clipped.padEnd(width);
};
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
  experimental = EXPERIMENTAL_SETUPS,
  signingIn,
  fetching,
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

    if (row.kind === 'source-columns') {
      const bg = BG;
      const heading = (text: string, width: number) => (
        <Text color="#8b949e" backgroundColor={bg} bold>{text.padEnd(width)}</Text>
      );
      const prefix = ' '.repeat(2 + 2 + NAME_W);
      return (
        <Text key={row.key} wrap="truncate">
          <Text backgroundColor={bg}>{prefix}</Text>
          {heading('Status', STATUS_W)}
          <Text backgroundColor={bg}>{'  '}</Text>
          {heading('Type', TYPE_W)}
          {heading('Label', LABEL_W)}
          {heading('Items', ITEMS_W)}
          {heading('New', NEW_W)}
          {heading('Last new', LAST_NEW_W)}
          {heading('Fetched', Math.max(0, restW - (STATUS_W + 2 + TYPE_W + LABEL_W + ITEMS_W + NEW_W + LAST_NEW_W)))}
        </Text>
      );
    }

    const bg = isFocused ? FOCUS_BG : BG;
    const cursor = <Text color="#1c7cd6" backgroundColor={bg}>{isFocused ? '▸ ' : '  '}</Text>;
    const name = (label: string, color = '#f0f6fc') => (
      <Text color={color} backgroundColor={bg}>{clip(label, NAME_W - 1).padEnd(NAME_W)}</Text>
    );
    const fill = (used: number) => <Text backgroundColor={bg}>{' '.repeat(Math.max(0, restW - used))}</Text>;
    const dot = (on: boolean) => <Text color={on ? '#3fb950' : '#f85149'} backgroundColor={bg}>{on ? '● ' : '○ '}</Text>;
    /** A question about the row, in place of its status. */
    const asking = (key: string, on: boolean, label: string, text: string) => {
      const ask = clip(text, restW);
      return (
        <Text key={key} wrap="truncate">
          {cursor}
          {dot(on)}
          {name(label)}
          <Text color="#e3b341" backgroundColor={bg}>{ask}</Text>
          {fill(ask.length)}
        </Text>
      );
    };
    /** A source's state, label, item count and last fetch; `pending` replaces the last fetch while it runs. */
    const sourceLine = (
      row: { key: string; source: { id: string; displayName: string; kind?: string } },
      on: boolean,
      state: string,
      type: string,
      tag: string,
      tagColor: string,
      { typeColor = '#8b949e', stateColor, pending }: { typeColor?: string; stateColor?: string; pending?: string } = {},
    ) => {
      const id = row.source.id;
      const status = fixedColumn(state, STATUS_W);
      const sourceType = fixedColumn(type, TYPE_W);
      const label = fixedColumn(tag, LABEL_W);
      const count = fixedColumn(String(stats?.bySource[id] ?? 0), ITEMS_W);
      const result = lastFetch[id];
      const history = stats?.sourceStatus?.[id];
      const error = history ? history.lastError : result?.error;
      const added = fixedColumn(result && !result.error && result.added > 0 ? `+${result.added}` : '', NEW_W);
      const newest = fixedColumn(history?.lastAddedAt ? timeAgo(history.lastAddedAt) : '', LAST_NEW_W);
      const fetchedAt = history?.lastFetchAt ? timeAgo(history.lastFetchAt) : '';
      const fetched = pending ?? (error ? `⚠ ${fetchedAt ? `${fetchedAt}: ` : ''}${error}` : fetchedAt ? `✓ ${fetchedAt}` : '');
      const used = STATUS_W + 2 + TYPE_W + LABEL_W + ITEMS_W + added.length + newest.length;
      const last = clip(fetched, Math.max(0, restW - used));
      return (
        <Text key={row.key} wrap="truncate">
          {cursor}
          {dot(on)}
          {name(row.source.displayName, on ? '#f0f6fc' : '#8b949e')}
          <Text color={stateColor ?? (on ? '#3fb950' : '#f85149')} backgroundColor={bg}>{status}</Text>
          <Text color={settings.sourceColors?.[id] || DEFAULT_SOURCE_COLOR[id] || DEFAULT_COLOR} backgroundColor={bg}>{'■ '}</Text>
          <Text color={typeColor} backgroundColor={bg}>{sourceType}</Text>
          <Text color={tagColor} backgroundColor={bg}>{label}</Text>
          <Text color="#8b949e" backgroundColor={bg}>{count}</Text>
          <Text color="#3fb950" backgroundColor={bg}>{added}</Text>
          <Text color="#c9d1d9" backgroundColor={bg}>{newest}</Text>
          <Text color={pending ? PENDING : error ? '#f85149' : '#8b949e'} backgroundColor={bg}>{last}</Text>
          {fill(used + last.length)}
        </Text>
      );
    };

    if (row.kind === 'experimental') {
      const id = row.source.id;
      const on = experimentalOn(config, id);
      const items = stats?.bySource[id] ?? 0;
      const signing = signingIn === id;
      const fetchingNow = on && fetchCovers(fetching, id, !disabledSet.has(id));
      if (isFocused && editing) {
        return (
          <Text key={row.key} wrap="truncate">
            {cursor}
            {dot(on)}
            {name(row.source.displayName)}
            {editBox(editBuffer)}
          </Text>
        );
      }
      // Each question belongs to one state, so one left over from before can't act on the next state.
      if (signing && confirmKey === `${row.key}:cancel`) {
        return asking(row.key, on, row.source.displayName, 'still signing in — space again to cancel the sign-in · Esc keep waiting');
      }
      if (fetchingNow && !signing && confirmKey === `${row.key}:off`) {
        return asking(row.key, on, row.source.displayName, 'fetching now — space again to stop it and turn the source off · Esc cancel');
      }
      if (!on && !signing && confirmKey === row.key) {
        return asking(row.key, on, row.source.displayName, `space again to ${experimental[id]?.consent ?? 'turn it on'} · Esc cancel`);
      }
      if (confirmKey === `${row.key}:x`) {
        return asking(row.key, on, row.source.displayName, `press x again to delete its ${items} items · Esc cancel`);
      }
      const extensionId = row.source.extensionId;
      const isolation = experimental[id]?.isolation;
      return sourceLine(
        row, on, signing ? SIGNING_IN_STATUS : on ? 'on' : 'off',
        isolation === 'unsandboxed' ? 'UNSANDBOXED' : extensionId ? `C/${row.source.extensionName ?? extensionId}` : 'Experimental',
        settings.sourceLabels[id] ?? '',
        settings.sourceColors?.[id] || DEFAULT_SOURCE_COLOR[id] || DEFAULT_COLOR,
        {
          typeColor: isolation === 'unsandboxed' ? '#f85149' : '#8b949e',
          ...(signing ? { stateColor: PENDING, pending: SIGNING_IN_NOTE } : fetchingNow ? { pending: FETCHING_NOTE } : {}),
        },
      );
    }

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
      return sourceLine(
        row,
        enabled,
        enabled ? 'enabled' : 'disabled',
        row.source.extensionId ? `C/${row.source.extensionName ?? row.source.extensionId}` : SOURCE_TYPE[row.source.kind],
        settings.sourceLabels[id] ?? '',
        settings.sourceColors?.[id] || DEFAULT_SOURCE_COLOR[id] || DEFAULT_COLOR,
        fetchCovers(fetching, id, enabled) ? { pending: FETCHING_NOTE } : {},
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
    ? `type ${focused?.kind === 'source' || focused?.kind === 'experimental' ? `a label (max ${MAX_SOURCE_LABEL_LENGTH})` : 'a value'}   ↵ save   Esc cancel   (empty resets to the default)`
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
