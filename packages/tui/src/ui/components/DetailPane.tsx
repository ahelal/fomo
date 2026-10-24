import React from 'react';
import { Box, Text } from 'ink';
import { formatDate, formatDateTime, formatUpdateTime, type Update } from '@fomo/core';
import { textWidth } from '../text.js';
import { DUP_COLOR } from './UpdatesTable.js';

interface Props {
  update: Update;
  /** Content is still being loaded. */
  loading?: boolean;
  /** Copilot is summarising this post (g, or g again to regenerate). */
  summarizing?: boolean;
  /** The post's page is being re-read (u). */
  refreshing?: boolean;
  height: number;
  columns: number;
  position?: 'bottom' | 'right';
  /** The other updates of this one's duplicate group (the original first), also those outside the current view. */
  duplicates?: Update[];
  /** Ids of `duplicates` that are listed in the current view, which `d` jumps to. */
  listed?: ReadonlySet<string>;
  /** Display name and colour of a source, as in the list. */
  labelOf?: (source: string) => string;
  colorOf?: (source: string) => string;
}

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  unread: { label: 'UNREAD', color: '#58a6ff' },
  read:   { label: 'READ',   color: '#8b949e' },
};

const SOURCE_COLOR: Record<string, string> = {
  github: '#58a6ff',
  azure:  '#58a6ff',
  vscode: '#3fb950',
};

const GIST_COLOR = '#d2a8ff';
const ORIGINAL_COLOR = '#3fb950';

/** Most duplicates listed at the bottom; the rest is only counted. */
const MAX_DUPLICATES = 2;

/** How many of `count` duplicates fit in `room` rows (a divider, two rows each, and a row for the rest), and the rows they take. */
export function duplicateRows(count: number, room: number): { shown: number; rows: number } {
  for (let shown = Math.min(count, MAX_DUPLICATES); shown > 0; shown--) {
    const rows = 1 + 2 * shown + (count > shown ? 1 : 0);
    if (rows <= room) return { shown, rows };
  }
  return { shown: 0, rows: 0 };
}

/** Rows `text` takes when word-wrapped to `width` columns. */
function wrappedRows(text: string, width: number): number {
  let rows = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = textWidth(word);
    if (used === 0) used = w;
    else if (used + 1 + w <= width) used += 1 + w;
    else { rows++; used = w; }
    while (used > width) { rows++; used -= width; }
  }
  return rows;
}

export function DetailPane({
  update,
  loading = false,
  summarizing = false,
  refreshing = false,
  height,
  columns,
  position = 'bottom',
  duplicates = [],
  listed,
  labelOf = (source) => source,
  colorOf = () => '#58a6ff',
}: Props) {
  const badge = STATUS_BADGE[update.status] ?? { label: '???', color: 'white' };
  const sourceColor = SOURCE_COLOR[update.source] ?? '#58a6ff';
  const time = formatUpdateTime(update);
  const fetched = formatDateTime(update.dateAdded);

  const content = update.content
    ? update.content
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  const hasContent = content.length > 0;

  // Title, source, status, URL and divider (+ the top divider at the bottom); the rest is the body.
  const fixedRows = position === 'bottom' ? 6 : 5;
  // The duplicates take what is left after a row of preview.
  const links = duplicateRows(duplicates.length, height - fixedRows - 1);
  const bodyRows = Math.max(1, height - fixedRows - links.rows);
  const gist = update.gist;
  // The saved summary goes first: its sentence, then as many bullets as fit above a divider and a line of preview.
  const gistWidth = Math.max(columns - 6, 10);
  const points: string[] = [];
  let gistRows = 0;
  if (gist) {
    gistRows = wrappedRows(gist.summary, gistWidth);
    for (const point of gist.points) {
      const n = wrappedRows(point, gistWidth);
      if (gistRows + n > bodyRows - 2) break;
      points.push(point);
      gistRows += n;
    }
  }
  const contentLines = gist ? bodyRows - gistRows - 1 : bodyRows;
  const maxContentLen = columns * Math.max(1, contentLines);
  const truncatedContent = content.length > maxContentLen
    ? content.slice(0, maxContentLen - 1) + '…'
    : content;

  return (
    <Box flexDirection="column" height={height} overflowY="hidden">
      {/* Top divider */}
      {position === 'bottom' && (
        <Box paddingX={1} flexShrink={0}>
          <Text color="#30363d">{'─'.repeat(Math.max(columns - 2, 10))}</Text>
        </Box>
      )}

      {/* Title */}
      <Box paddingX={2} flexShrink={0}>
        <Text bold color="#f0f6fc" wrap="truncate">
          {update.title}
        </Text>
      </Box>

      {/* Meta: source, dates, length */}
      <Box paddingX={2} flexShrink={0}>
        <Text color="#8b949e" wrap="truncate">
          {'Source '}
          <Text color={sourceColor} bold>{update.source}</Text>
          {'   Published '}
          <Text color="#c9d1d9">{formatDate(update.datePublished)}</Text>
          {time && (
            <>
              {update.durationSeconds ? '   Length ' : '   Reading '}
              <Text color="#c9d1d9">{time}</Text>
            </>
          )}
          {update.duplicateOf && (
            <>
              {'   '}
              <Text color={DUP_COLOR} bold>{`duplicate of ${update.duplicateOf.slice(0, update.duplicateOf.indexOf('__'))}`}</Text>
            </>
          )}
          {fetched && (
            <>
              {'   Fetched '}
              <Text color="#c9d1d9">{fetched}</Text>
            </>
          )}
        </Text>
      </Box>

      {/* Meta: status + saved */}
      <Box paddingX={2} flexShrink={0}>
        <Text color="#8b949e">{'Status '}</Text>
        <Text color={badge.color} bold>{badge.label.toLowerCase()}</Text>
        {update.saved && <Text color="#e3b341" bold>{' ⭐'}</Text>}
        {summarizing ? (
          <Text color={GIST_COLOR} wrap="truncate">{'   ⟳ Copilot is summarising…'}</Text>
        ) : refreshing ? (
          <Text color="#8b949e" wrap="truncate">{'   ⟳ Refreshing from the page…'}</Text>
        ) : (
          <Text color="#8b949e" dimColor wrap="truncate">{gist ? '   u refresh' : '   g summarise · u refresh'}</Text>
        )}
      </Box>

      {/* URL */}
      <Box paddingX={2} flexShrink={0}>
        <Text color="#58a6ff" underline wrap="truncate">{update.url}</Text>
      </Box>

      {/* Content divider */}
      <Box paddingX={2} flexShrink={0}>
        <Text color="#30363d">{'─'.repeat(Math.max(columns - 6, 10))}</Text>
      </Box>

      {/* Saved Copilot summary */}
      {gist && (
        <>
          <Box paddingX={2} flexShrink={0}>
            <Box flexShrink={0}><Text color={GIST_COLOR} bold>{'✦ '}</Text></Box>
            <Text color="#f0f6fc" wrap="wrap">{gist.summary}</Text>
          </Box>
          {points.map((point, i) => (
            <Box key={i} paddingX={2} flexShrink={0}>
              <Box flexShrink={0}><Text color={GIST_COLOR}>{'• '}</Text></Box>
              <Text color="#c9d1d9" wrap="wrap">{point}</Text>
            </Box>
          ))}
          {contentLines > 0 && (
            <Box paddingX={2} flexShrink={0}>
              <Text color="#30363d">{'┄'.repeat(Math.max(columns - 6, 10))}</Text>
            </Box>
          )}
        </>
      )}

      {/* Content preview */}
      {contentLines > 0 && (
        <Box paddingX={2} flexGrow={1} overflowY="hidden">
          {hasContent ? (
            <Text wrap="wrap" color="#c9d1d9">
              {truncatedContent}
            </Text>
          ) : loading ? (
            <Text color="#8b949e">Loading…</Text>
          ) : (
            <Text wrap="wrap" color="#8b949e">
              {'No preview — press '}
              <Text color="#58a6ff" bold>u</Text>
              {gist ? ' to fetch content or ' : ' to fetch content, '}
              {!gist && <Text color="#58a6ff" bold>g</Text>}
              {!gist && ' to summarise or '}
              <Text color="#58a6ff" bold>o</Text>
              {' to open in browser'}
            </Text>
          )}
        </Box>
      )}

      {/* Duplicates: the original of this update, or its copies, wherever they are */}
      {links.shown > 0 && (
        <>
          {contentLines <= 0 && <Box flexGrow={1} />}
          <Box paddingX={2} flexShrink={0}>
            <Text wrap="truncate">
              <Text color="#30363d">{'─ '}</Text>
              <Text color="#8b949e">{'duplicates'}</Text>
              <Text color="#30363d">{` ${'─'.repeat(Math.max(columns - 19, 4))}`}</Text>
            </Text>
          </Box>
          {duplicates.slice(0, links.shown).map((other) => {
            const isOriginal = !other.duplicateOf;
            return (
              <React.Fragment key={other.id}>
                <Box paddingX={2} flexShrink={0}>
                  <Text wrap="truncate">
                    <Text color={isOriginal ? ORIGINAL_COLOR : DUP_COLOR} bold>{isOriginal ? 'original' : 'duplicate'}</Text>
                    {'  '}
                    <Text color={colorOf(other.source)} bold>{labelOf(other.source)}</Text>
                    {other.source !== update.source && <Text color={DUP_COLOR} bold>{'  other source'}</Text>}
                    <Text color="#8b949e">{`   ${formatDate(other.datePublished)}   `}</Text>
                    {listed?.has(other.id)
                      ? <Text color="#58a6ff" bold>{'d jump'}</Text>
                      : <Text color="#8b949e" dimColor>{'not in this view'}</Text>}
                  </Text>
                </Box>
                <Box paddingX={2} flexShrink={0}>
                  <Text color="#c9d1d9" wrap="truncate">{other.title}</Text>
                </Box>
              </React.Fragment>
            );
          })}
          {duplicates.length > links.shown && (
            <Box paddingX={2} flexShrink={0}>
              <Text color="#8b949e" dimColor>{`+${duplicates.length - links.shown} more`}</Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
