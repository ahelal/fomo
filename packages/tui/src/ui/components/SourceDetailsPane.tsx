import React from 'react';
import { Box, Text } from 'ink';
import { colorName, DEFAULT_COLOR, isGithubRepoUrl, isYoutubeChannelUrl, timeAgo, type SourceDraft, type SourceFetchResult, type SourceInfo, type StatsResponse } from '@fomo/core';
import { DEFAULT_SOURCE_COLOR } from './UpdatesTable.js';

export type DetailsField = 'enabled' | 'label' | 'color' | 'name' | 'extensionName' | 'url' | 'include' | 'shorts' | 'changelogPath';

/** State of the source details popup (Config → ↵ on a source). */
export interface SourceDetailsState {
  id: string;
  draft: SourceDraft;
  focus: number;
  /** Text being typed into the focused field. */
  editing?: string;
  /**
   * A second x removes (keeping its items, or d deletes them too); a second d deletes its items; a second Esc
   * drops unsaved changes; a second s turns an experimental source on (signing in).
   */
  confirm?: 'remove' | 'discard' | 'items' | 'consent';
  error?: string;
}

/** Names are editable for every source; URLs and filters only for user-defined feeds. */
export function detailsFields(own: boolean, draft: SourceDraft): DetailsField[] {
  const fields: DetailsField[] = ['enabled', 'label', 'color'];
  fields.push('name');
  if (draft.extensionName !== undefined) fields.push('extensionName');
  if (own) fields.push(
    'url',
    ...(isGithubRepoUrl(draft.url) ? ['changelogPath' as const] : ['include' as const]),
    ...(isYoutubeChannelUrl(draft.url) ? ['shorts' as const] : []),
  );
  return fields;
}

const FIELD_LABEL: Record<DetailsField, string> = {
  enabled: 'Enabled',
  label: 'Label',
  color: 'Color',
  name: 'Name',
  extensionName: 'Extension name',
  url: 'URL(s)',
  include: 'Keywords',
  shorts: 'Shorts',
  changelogPath: 'Changelog file',
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
  /** What turning an experimental source on agrees to. */
  consent?: string;
  /** Whether an experimental provider runs outside the extension sandbox. */
  isolation?: 'sandboxed' | 'unsandboxed';
  /** The draft differs from the saved settings. */
  changed: boolean;
  stats?: StatsResponse;
  /** Stored updates of the source. */
  items: number;
  lastFetch?: SourceFetchResult;
  /** What is running for the source right now (signing in, fetching); shown in place of its last error. */
  pending?: string;
  height: number;
  columns: number;
}

const LABEL_W = 16;
const tail = (s: string, w: number) => (w <= 0 ? '' : s.length > w ? `…${s.slice(s.length - w + 1)}` : s);

export function SourceDetailsPane({ source, state, own, consent, isolation, changed, stats, items, lastFetch, pending, height, columns }: Props) {
  const { draft, focus, editing, confirm, error } = state;
  const removed = !!source.removed;
  const experimental = !!source.experimental;
  const fields = removed ? [] : detailsFields(own, draft);
  const valueW = Math.max(10, columns - 4 - 2 - LABEL_W);
  const history = stats?.sourceStatus?.[source.id];
  const lastError = history ? history.lastError : lastFetch?.error;
  const color = draft.color || DEFAULT_SOURCE_COLOR[source.id] || DEFAULT_COLOR;

  const value = (field: DetailsField): { text: string; muted?: boolean; color?: string } => {
    switch (field) {
      case 'enabled': return draft.enabled ? { text: '[x] on', color: '#3fb950' } : { text: '[ ] off', color: '#f85149' };
      case 'label': return draft.label ? { text: draft.label } : { text: `(none — shows “${source.displayName}”)`, muted: true };
      case 'color': return { text: `■■ ${colorName(color)} ${color}${draft.color ? '' : ' (default)'}`, color };
      case 'name': return { text: draft.name };
      case 'extensionName': return { text: draft.extensionName ?? '' };
      case 'url': return { text: draft.url };
      case 'include': return draft.include ? { text: draft.include } : { text: '(none — keeps everything)', muted: true };
      case 'shorts': return draft.shorts ? { text: '[x] included' } : { text: '[ ] skipped (videos and live streams only)', muted: true };
      case 'changelogPath': return draft.changelogPath ? { text: draft.changelogPath } : { text: '(none — uses release notes)', muted: true };
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
    : confirm === 'consent'
    ? `press s again to ${consent ?? 'turn it on'} · any other key cancels`
    : confirm === 'discard'
    ? 'unsaved changes — s save   Esc again to drop them'
    : removed
    ? `${deleteItems.trim()}   v show its updates${source.builtin ? '   r restore' : ''}   Esc close`
    : `↑↓ move   ↵ ${fields[focus] === 'enabled' || fields[focus] === 'shorts' ? 'toggle' : fields[focus] === 'color' ? 'pick color' : 'edit'}   s save${experimental ? '   l sign in again' : ''}   f fetch now   v show its updates${deleteItems}${experimental ? '' : '   x remove'}   Esc close`;

  return (
    <Box flexDirection="column" height={height} width={columns} paddingX={2} paddingTop={1}>
      <Text wrap="truncate">
        <Text color="#f0f6fc" bold>{`📡 ${source.displayName}`}</Text>
        <Text color={isolation === 'unsandboxed' ? '#f85149' : '#8b949e'}>{removed ? `   removed · ${source.id}` : `   ${source.extensionId ? `C/${source.extensionName ?? source.extensionId}` : KIND_LABEL[source.kind]} · ${experimental ? isolation === 'unsandboxed' ? 'UNSANDBOXED · host access' : 'experimental · this computer' : source.builtin ? 'built-in' : 'yours'} · ${source.id}`}</Text>
        {changed && <Text color="#e3b341">{'   ● unsaved'}</Text>}
      </Text>
      <Text color="#8b949e" wrap="truncate">
        {`${items} items · fetched ${history?.lastFetchAt ? timeAgo(history.lastFetchAt) : 'never'}`}
        {history?.lastAddedAt ? ` · last new ${timeAgo(history.lastAddedAt)}` : ''}
        {lastFetch && !lastFetch.error ? ` · +${lastFetch.added} new this session` : ''}
      </Text>
      {pending
        ? <Text color="#e3b341" wrap="truncate">{pending}</Text>
        : lastError ? <Text color="#f85149" wrap="truncate">{`⚠ ${lastError}`}</Text> : <Text> </Text>}
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
          <Text color="#8b949e" wrap="truncate">
            {`  ${''.padEnd(LABEL_W)}${experimental
              ? isolation === 'unsandboxed'
                ? 'on/off and approval are per profile; WorkIQ sign-in uses the host account'
                : 'experimental: on/off and sign-in are kept per profile on this computer; label, color and names are shared'
              : 'built-in: its address is maintained with the app'}`}
          </Text>
          {isolation === 'unsandboxed' && (
            <Text color="#f85149" bold wrap="truncate">
              UNSANDBOXED: WorkIQ has host filesystem/network access. FOMO blocks write tools, constrains Graph calls, and uses read-only file search for recordings.
            </Text>
          )}
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
    case 'changelogPath': return 'relative changelog file path (empty uses release notes)';
    case 'label': return 'a short label, max 10 characters (empty shows the name)';
    default: return 'a value';
  }
}
