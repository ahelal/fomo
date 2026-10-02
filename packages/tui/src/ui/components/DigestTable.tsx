import React, { useRef } from 'react';
import { Box, Text } from 'ink';
import { soloUpdate, type DigestEntry, type DigestRow } from '@fomo/core';
import { DEFAULT_SOURCE_COLOR } from './UpdatesTable.js';

interface Props {
  rows: DigestRow[];
  expanded: ReadonlySet<string>;
  pending: number;
  /** A Copilot digest run is in progress. */
  grouping?: boolean;
  selectedIndex: number;
  height: number;
  columns: number;
  sourceLabels?: Record<string, string>;
  sourceColors?: Record<string, string>;
  /** Applied search, for the empty state. */
  search?: string;
  /** `saved` lists saved updates (read or unread) and marks the unread ones instead of the saved ones. */
  mode?: 'digest' | 'saved';
}

const SEL_BG = '#1c2d4f';
const SOURCE_W = 13;
const DATE_W = 12;
const COUNT_W = 5;
const UNREAD_COLOR = '#58a6ff';

/** Summary shown under a single-update topic row; falls back to the topic's Copilot summary. */
function soloSummary(entry: DigestEntry): string {
  const u = soloUpdate(entry);
  if (!u) return '';
  return u.summary || (entry.synthetic ? '' : entry.topic.summary);
}

/** Topics get a separator line above them; items and single-update topics with a summary get a second line. */
function lineCost(row: DigestRow, firstInView: boolean): number {
  if (row.kind === 'item') return row.update.summary ? 2 : 1;
  return (firstInView ? 1 : 2) + (soloSummary(row.entry) ? 1 : 0);
}

export function DigestTable({
  rows,
  expanded,
  pending,
  grouping = false,
  selectedIndex,
  height,
  columns,
  sourceLabels = {},
  sourceColors = {},
  search,
  mode = 'digest',
}: Props) {
  const saved = mode === 'saved';
  // header(1) + bottom indicator(1)
  const budget = Math.max(1, height - 2);
  const scrollOffsetRef = useRef(0);

  let offset = Math.min(scrollOffsetRef.current, Math.max(0, rows.length - 1));
  if (selectedIndex < offset) offset = selectedIndex;
  const linesBetween = (from: number, to: number) => {
    let n = 0;
    for (let i = from; i <= to; i++) n += lineCost(rows[i]!, i === from);
    return n;
  };
  // Keep an expanded topic's updates in view too (as far as the selected row stays visible).
  let target = selectedIndex;
  const sel = rows[selectedIndex];
  if (sel?.kind === 'topic') {
    while (rows[target + 1]?.kind === 'item' && rows[target + 1]!.entry.topic.id === sel.entry.topic.id) target++;
  }
  while (offset < selectedIndex && linesBetween(offset, target) > budget) offset++;
  scrollOffsetRef.current = offset;

  const visible: { row: DigestRow; index: number }[] = [];
  let used = 0;
  for (let i = offset; i < rows.length; i++) {
    const cost = lineCost(rows[i]!, i === offset);
    if (used + cost > budget) break;
    used += cost;
    visible.push({ row: rows[i]!, index: i });
  }
  const hasMoreBelow = offset + visible.length < rows.length;

  const titleW = Math.max(10, columns - (2 + 2 + SOURCE_W + DATE_W + COUNT_W) - 2);
  const summaryIndent = 2 + 2 + SOURCE_W + DATE_W + COUNT_W;
  const separatorW = Math.max(columns - 2, 10);
  const label = (source: string) => (sourceLabels[source] ?? source).slice(0, SOURCE_W - 2);
  const color = (source: string) => sourceColors[source] ?? DEFAULT_SOURCE_COLOR[source] ?? '#58a6ff';
  const clip = (s: string, w: number) => (s.length > w ? `${s.slice(0, w - 1)}…` : s);

  if (rows.length === 0) {
    return (
      <Box flexDirection="column" height={height}>
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          {search ? (
            <Text color="#8b949e">{`No ${saved ? 'saved' : 'unread'} updates match “${search}” — Esc clears the search`}</Text>
          ) : saved ? (
            <>
              <Text color="#8b949e">No saved updates — press </Text>
              <Text color="#58a6ff" bold>s</Text>
              <Text color="#8b949e"> on an update to save it</Text>
            </>
          ) : (
            <>
              <Text color="#8b949e">All caught up — press </Text>
              <Text color="#58a6ff" bold>f</Text>
              <Text color="#8b949e"> for new updates</Text>
            </>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={height} overflowY="hidden">
      <Box paddingX={1}>
        <Text color="#8b949e" dimColor wrap="truncate">
          {'    '}
          {'SOURCE'.padEnd(SOURCE_W)}
          {'LATEST'.padEnd(DATE_W)}
          {'#'.padEnd(COUNT_W)}
          {'TOPIC'}
          {grouping
            ? `   · ${pending > 0 ? `${pending} not grouped yet — ` : ''}Copilot is grouping in the background…`
            : pending > 0 ? `   · ${pending} not grouped yet — press f to group them` : ''}
        </Text>
      </Box>

      {visible.map(({ row, index }, viewIdx) => {
        const selected = index === selectedIndex;
        const bg = selected ? SEL_BG : undefined;
        const bar = selected ? <Text color="#1c7cd6" backgroundColor={SEL_BG}>{'▎ '}</Text> : <Text>{'  '}</Text>;

        if (row.kind === 'item') {
          const u = row.update;
          const unread = u.status === 'unread';
          const mark = saved ? (unread ? '●' : '└') : u.saved ? '⭐' : '└';
          return (
            <Box key={row.key} flexDirection="column">
              <Box paddingX={1}>
                {bar}
                <Text backgroundColor={bg}>{'  '}</Text>
                <Text color={color(u.source)} backgroundColor={bg}>{label(u.source).padEnd(SOURCE_W)}</Text>
                <Text color="#8b949e" backgroundColor={bg}>{u.datePublished.slice(0, 10).padEnd(DATE_W)}</Text>
                <Text color={saved && unread ? UNREAD_COLOR : '#30363d'} backgroundColor={bg}>{mark.padEnd(COUNT_W)}</Text>
                <Text color={saved && !unread ? '#8b949e' : '#c9d1d9'} backgroundColor={bg} wrap="truncate">{clip(u.title, titleW)}</Text>
              </Box>
              {u.summary && (
                <Box paddingX={1}>
                  {selected ? <Text color="#1c7cd6" backgroundColor={SEL_BG}>{'▎ '}</Text> : <Text>{'  '}</Text>}
                  <Text backgroundColor={bg}>{' '.repeat(summaryIndent - 2)}</Text>
                  <Text color="#8b949e" backgroundColor={bg} wrap="truncate">{clip(u.summary, titleW)}</Text>
                </Box>
              )}
            </Box>
          );
        }

        const { entry } = row;
        const solo = soloUpdate(entry);
        const summary = soloSummary(entry);
        const isOpen = expanded.has(entry.topic.id);
        const marker = solo ? '• ' : isOpen ? '▾ ' : '▸ ';
        const sourceText = entry.sources.length === 1 ? label(entry.sources[0]!) : `${entry.sources.length} sources`;
        const sourceColor = entry.sources.length === 1 ? color(entry.sources[0]!) : '#c9d1d9';
        const soloMark = saved ? (solo?.status === 'unread' ? '●' : '') : solo?.saved ? '⭐' : '';
        const count = solo ? soloMark : `×${entry.items.length}`;
        const importance = entry.topic.importance;
        const titleColor = importance === 'low' ? '#8b949e' : '#f0f6fc';
        const title = solo ? solo.title : entry.topic.title;

        return (
          <React.Fragment key={row.key}>
            {viewIdx > 0 && (
              <Box paddingX={1}>
                <Text color="#30363d">{'─'.repeat(separatorW)}</Text>
              </Box>
            )}
            <Box paddingX={1}>
              {bar}
              <Text color={solo ? '#8b949e' : '#58a6ff'} backgroundColor={bg}>{marker}</Text>
              <Text color={sourceColor} bold backgroundColor={bg}>{sourceText.padEnd(SOURCE_W)}</Text>
              <Text color="#f0f6fc" backgroundColor={bg}>{entry.latestDate.slice(0, 10).padEnd(DATE_W)}</Text>
              <Text color={solo && !saved ? '#e3b341' : '#58a6ff'} bold backgroundColor={bg}>{count.padEnd(COUNT_W)}</Text>
              {importance === 'high' && <Text color="#f0883e" bold backgroundColor={bg}>{'▲ '}</Text>}
              <Text color={titleColor} bold={importance !== 'low'} backgroundColor={bg} wrap="truncate">
                {clip(title, importance === 'high' ? titleW - 2 : titleW)}
              </Text>
            </Box>
            {summary && (
              <Box paddingX={1}>
                {selected ? <Text color="#1c7cd6" backgroundColor={SEL_BG}>{'▎ '}</Text> : <Text>{'  '}</Text>}
                <Text backgroundColor={bg}>{' '.repeat(summaryIndent - 2)}</Text>
                <Text color="#8b949e" backgroundColor={bg} wrap="truncate">{clip(summary, titleW)}</Text>
              </Box>
            )}
          </React.Fragment>
        );
      })}

      {hasMoreBelow && (
        <Box paddingX={1} justifyContent="center">
          <Text color="#8b949e">{'▼ more ▼'}</Text>
        </Box>
      )}
    </Box>
  );
}
