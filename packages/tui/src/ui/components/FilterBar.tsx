import React from 'react';
import { Box, Text } from 'ink';

const FILTERS = [
  { key: '1', label: 'All',    value: 'all' },
  { key: '2', label: 'Unread', value: 'unread' },
  { key: '3', label: 'Read',   value: 'read' },
  { key: '4', label: 'Pending', value: 'saved' },
] as const;

/** Views opened over the feed, shown after the tabs. */
const PANES = [
  { key: '5', label: 'Refs',  value: 'refs' },
  { key: '6', label: 'Todos', value: 'todos' },
] as const;

/** Views that switch between topics and a plain list when their key is pressed again. */
const GROUPABLE = new Set<string>(['unread', 'saved']);
const ESC_HINT = ' · Esc clears';

interface Props {
  /** Active view: a feed filter, or `todos` / `refs` while one of those is open. */
  active: string;
  /** The active view is listed as topics (Unread and Pending can switch). */
  grouped?: boolean;
  columns: number;
  /** Sources the view is limited to (names, or a count), if any. */
  sourceLabel?: string;
  /** Applied search query. */
  search?: string;
  /** Number of updates matching `search` in this view. */
  matches?: number;
  /** Search prompt being typed (opened with /); replaces the bar while set. */
  searchDraft?: string;
  /** The view's sort (cycled with s); only shown when it isn't the default order. */
  sortLabel?: string;
}

export function FilterBar({ active, grouped, columns, sourceLabel, search, matches, searchDraft, sortLabel }: Props) {
  if (searchDraft !== undefined) {
    return (
      <Box width={columns} flexShrink={0}>
        <Text wrap="truncate-start">
          <Text color="#e3b341" bold>{' / '}</Text>
          <Text color="#f0f6fc">{searchDraft}</Text>
          <Text inverse> </Text>
          <Text color="#8b949e">{'   ↵ search this view · Esc cancel · ^U clear'}</Text>
        </Text>
      </Box>
    );
  }

  const showSource = !!sourceLabel;
  const tabs = FILTERS.map((f) => {
    const mode = active === f.value && GROUPABLE.has(f.value) ? (grouped ? ' · topics' : ' · list') : '';
    return { ...f, text: ` ${f.key} ${f.label}${mode} ` };
  });
  const panes = PANES.map((p) => ({ ...p, text: ` ${p.key} ${p.label} ` }));
  // Width of the tab strip: tabs and panes, single-space gaps.
  const tabsW = [...tabs, ...panes].reduce((w, t, i) => w + (i > 0 ? 1 : 0) + t.text.length, 0);

  // Budget the chip area so the match count survives on narrow terminals:
  // the query is truncated first, and the Esc hint is dropped if it can't fit.
  const srcChip = showSource ? ` src:${sourceLabel} ` : '';
  const sortChip = sortLabel ? ` ↕ ${sortLabel} ` : '';
  const count = search && matches !== undefined ? ` ${matches} match${matches === 1 ? '' : 'es'}` : '';
  let room = columns - tabsW - (srcChip ? srcChip.length + 1 : 0) - (sortChip ? sortChip.length + 1 : 0) - count.length;
  let queryChip = '';
  if (search) {
    room -= 1;
    const full = ` /${search} `;
    queryChip = full.length <= room ? full : ` /${search.slice(0, Math.max(1, room - 4))}… `;
    room -= queryChip.length;
  }
  const showHint = room >= ESC_HINT.length;

  return (
    <Box width={columns} flexShrink={0}>
      <Box flexShrink={0}>
        {tabs.map((f, i) => {
          const isActive = active === f.value;
          return (
            <React.Fragment key={f.value}>
              {i > 0 && <Text color="gray"> </Text>}
              <Text
                color={isActive ? '#58a6ff' : '#8b949e'}
                bold={isActive}
                inverse={isActive}
              >
                {f.text}
              </Text>
            </React.Fragment>
          );
        })}
        {panes.map((p) => (
          <React.Fragment key={p.value}>
            <Text color="gray"> </Text>
            <Text color={active === p.value ? '#58a6ff' : '#8b949e'} bold={active === p.value} inverse={active === p.value}>
              {p.text}
            </Text>
          </React.Fragment>
        ))}
      </Box>
      {(showSource || search || sortChip) && (
        <Box flexShrink={1} overflow="hidden">
          <Text wrap="truncate-end">
            {sortChip && (
              <>
                <Text color="gray"> </Text>
                <Text color="#a5d6ff" inverse>{sortChip}</Text>
              </>
            )}
            {showSource && (
              <>
                <Text color="gray"> </Text>
                <Text color="#e3b341" inverse>{` src:${sourceLabel} `}</Text>
              </>
            )}
            {search && (
              <>
                <Text color="gray"> </Text>
                <Text color="#e3b341" inverse>{queryChip}</Text>
                {count && <Text color="#8b949e">{count}</Text>}
              </>
            )}
            {(showSource || search) && showHint && <Text color="#8b949e">{ESC_HINT}</Text>}
          </Text>
        </Box>
      )}
    </Box>
  );
}
