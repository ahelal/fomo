import React from 'react';
import { Box, Text } from 'ink';
import { isGithubRepoUrl, isYoutubeChannelUrl, timeAgo, type SourceDraft, type SourceFetchResult, type SourceInfo, type StatsResponse } from '@fomo/core';
import { COLOR_PALETTE } from './SettingsPane.js';

export type DetailsField = 'enabled' | 'label' | 'color' | 'name' | 'url' | 'include' | 'shorts';

/** State of the source details popup (Config → ↵ on a source). */
export interface SourceDetailsState {
  id: string;
  draft: SourceDraft;
  focus: number;
  /** Text being typed into the focused field. */
  editing?: string;
  /** A second x removes (keeping its items, or d deletes them too); a second d deletes its items; a second Esc drops unsaved changes. */
  confirm?: 'remove' | 'discard' | 'items';
  error?: string;
}

/** The rows of the popup: name, URLs and filter only for the user's own sources (no filter for a repository; Shorts for a YouTube channel). */
export function detailsFields(own: boolean, draft: SourceDraft): DetailsField[] {
  const fields: DetailsField[] = ['enabled', 'label', 'color'];
  if (own) fields.push('name', 'url', ...(isGithubRepoUrl(draft.url) ? [] : ['include' as const]), ...(isYoutubeChannelUrl(draft.url) ? ['shorts' as const] : []));
  return fields;
}

const FIELD_LABEL: Record<DetailsField, string> = {
  enabled: 'Enabled',
  label: 'Label',
  color: 'Color',
  name: 'Name',
  url: 'URL(s)',
  include: 'Keywords',
  shorts: 'Shorts',
};

const KIND_LABEL: Record<SourceInfo['kind'], string> = {
  feed: 'RSS/Atom feed',
  'github-releases': 'GitHub releases',
  youtube: 'YouTube',
  custom: 'custom code',
};

interface Props {
  source: SourceInfo;
  state: SourceDetailsState;
  /** The user's own source (its name, URLs and filter can be edited). */
  own: boolean;
  /** The draft differs from the saved settings. */
  changed: boolean;
  stats?: StatsResponse;
  /** Stored updates of the source. */
  items: number;
  lastFetch?: SourceFetchResult;
  height: number;
  columns: number;
}

const LABEL_W = 12;
const tail = (s: string, w: number) => (w <= 0 ? '' : s.length > w ? `…${s.slice(s.length - w + 1)}` : s);

export function SourceDetailsPane({ source, state, own, changed, stats, items, lastFetch, height, columns }: Props) {
  const { draft, focus, editing, confirm, error } = state;
  const removed = !!source.removed;
  const fields = removed ? [] : detailsFields(own, draft);
  const valueW = Math.max(10, columns - 4 - 2 - LABEL_W);
  const history = stats?.sourceStatus?.[source.id];
  const lastError = history ? history.lastError : lastFetch?.error;
  const color = draft.color || COLOR_PALETTE[0]!;

  const value = (field: DetailsField): { text: string; muted?: boolean; color?: string } => {
    switch (field) {
      case 'enabled': return draft.enabled ? { text: '[x] on', color: '#3fb950' } : { text: '[ ] off', color: '#f85149' };
      case 'label': return draft.label ? { text: draft.label } : { text: `(none — shows “${source.displayName}”)`, muted: true };
      case 'color': return { text: `■ ${color}`, color };
      case 'name': return { text: draft.name };
      case 'url': return { text: draft.url };
      case 'include': return draft.include ? { text: draft.include } : { text: '(none — keeps everything)', muted: true };
      case 'shorts': return draft.shorts ? { text: '[x] included' } : { text: '[ ] skipped (videos and live streams only)', muted: true };
    }
  };

  const saved = stats?.savedBySource?.[source.id] ?? 0;
  const deleteItems = items > 0 ? `   d delete its ${items} items` : '';
  const footer = editing !== undefined
    ? `type ${field(fields[focus])}   ↵ done   Esc cancel`
    : confirm === 'remove' && items > 0
    ? `remove ${source.displayName}:   x again keeps its ${items} items   d deletes them too   any other key cancels`
    : confirm === 'remove'
    ? `press x again to remove${source.builtin ? ' (restore it later from the end of the source list)' : ' for good'} · any other key cancels`
    : confirm === 'items'
    ? `press d again to delete its ${items} items${saved ? ` (${saved} pending)` : ''}${removed ? ' and remove it for good' : ' · the next fetch adds them back as new'} · any other key cancels`
    : confirm === 'discard'
    ? 'unsaved changes — s save   Esc again to drop them'
    : removed
    ? `${deleteItems.trim()}   v show its updates${source.builtin ? '   r restore' : ''}   Esc close`
    : `↑↓ move   ↵ ${fields[focus] === 'enabled' || fields[focus] === 'shorts' ? 'toggle' : fields[focus] === 'color' ? 'next color' : 'edit'}   s save   f fetch now   v show its updates${deleteItems}   x remove   Esc close`;

  return (
    <Box flexDirection="column" height={height} width={columns} paddingX={2} paddingTop={1}>
      <Text wrap="truncate">
        <Text color="#f0f6fc" bold>{`📡 ${source.displayName}`}</Text>
        <Text color="#8b949e">{removed ? `   removed · ${source.id}` : `   ${KIND_LABEL[source.kind]} · ${source.builtin ? 'built-in' : 'yours'} · ${source.id}`}</Text>
        {changed && <Text color="#e3b341">{'   ● unsaved'}</Text>}
      </Text>
      <Text color="#8b949e" wrap="truncate">
        {`${items} items · fetched ${history?.lastFetchAt ? timeAgo(history.lastFetchAt) : 'never'}`}
        {history?.lastAddedAt ? ` · last new ${timeAgo(history.lastAddedAt)}` : ''}
        {lastFetch && !lastFetch.error ? ` · +${lastFetch.added} new this session` : ''}
      </Text>
      {lastError ? <Text color="#f85149" wrap="truncate">{`⚠ ${lastError}`}</Text> : <Text> </Text>}
      <Box height={1} />

      {fields.map((f, i) => {
        const focused = i === focus;
        const bg = focused ? '#1c2d4f' : undefined;
        const v = value(f);
        return (
          <Text key={f} wrap="truncate">
            <Text color="#1c7cd6" backgroundColor={bg}>{focused ? '▸ ' : '  '}</Text>
            <Text color="#c9d1d9" backgroundColor={bg}>{FIELD_LABEL[f].padEnd(LABEL_W)}</Text>
            {focused && editing !== undefined
              ? <Text color="#e3b341" backgroundColor="#2d1b00">{` ${tail(editing, valueW - 3)}▏`.padEnd(valueW)}</Text>
              : <Text color={v.color ?? (v.muted ? '#8b949e' : '#f0f6fc')} backgroundColor={bg}>{tail(v.text, valueW)}</Text>}
          </Text>
        );
      })}

      {removed && (
        <Text color="#8b949e" wrap="truncate">
          {`Removed — no longer fetched. Its ${items} items still show in your lists; delete them to remove it for good${source.builtin ? ', or r to restore it' : ''}.`}
        </Text>
      )}
      {!own && !removed && (
        <>
          <Box height={1} />
          <Text color="#8b949e" wrap="truncate">{`  ${'Fetches'.padEnd(LABEL_W)}${source.location ?? 'custom code in the app'}`}</Text>
          {source.filter && <Text color="#8b949e" wrap="truncate">{`  ${'Keeps'.padEnd(LABEL_W)}${source.filter}`}</Text>}
          <Text color="#8b949e" wrap="truncate">{`  ${''.padEnd(LABEL_W)}built-in: its address is maintained with the app`}</Text>
        </>
      )}

      <Box flexGrow={1} />
      {error && <Text color="#f85149" wrap="truncate">{`⚠ ${error}`}</Text>}
      <Text color={confirm || editing !== undefined ? '#e3b341' : '#8b949e'} wrap="truncate">{footer}</Text>
    </Box>
  );
}

function field(f: DetailsField | undefined): string {
  switch (f) {
    case 'url': return 'feed URLs (separate with spaces), github.com/owner/repo or a YouTube channel/playlist URL';
    case 'include': return 'keywords to keep, as a regex (empty keeps everything)';
    case 'label': return 'a short label (empty shows the name)';
    default: return 'a value';
  }
}
