import React from 'react';
import { Box, Text } from 'ink';
import { IMPORTANCE_LABEL, type DigestEntry } from '@fomo/core';

const IMPORTANCE_COLOR = { high: '#f0883e', medium: '#58a6ff', low: '#8b949e' } as const;

interface Props {
  entry: DigestEntry;
  height: number;
  columns: number;
  position?: 'bottom' | 'right';
  sourceLabels?: Record<string, string>;
  /** `saved` shows the topic's saved updates, marking the unread ones. */
  mode?: 'digest' | 'saved';
}

/** Summary + highlights of a digest topic, followed by the updates it groups. */
export function TopicPane({ entry, height, columns, position = 'bottom', sourceLabels = {}, mode = 'digest' }: Props) {
  const { topic, items } = entry;
  const saved = mode === 'saved';
  const unread = items.filter((u) => u.status === 'unread').length;
  const count = saved
    ? `${items.length} saved update${items.length === 1 ? '' : 's'}${unread ? ` (${unread} unread)` : ''}`
    : `${items.length} update${items.length === 1 ? '' : 's'}`;
  const sources = entry.sources.map((s) => sourceLabels[s] ?? s).join(', ');
  const width = Math.max(columns - 6, 10);

  // Blocks don't shrink, so a tall topic is clipped at the bottom instead of drawing lines over each other.
  return (
    <Box flexDirection="column" height={height} overflowY="hidden">
      {position === 'bottom' && (
        <Box paddingX={1} flexShrink={0}>
          <Text color="#30363d">{'─'.repeat(Math.max(columns - 2, 10))}</Text>
        </Box>
      )}

      <Box paddingX={2} flexShrink={0}>
        <Text bold color="#f0f6fc" wrap="truncate">{topic.title}</Text>
      </Box>
      <Box paddingX={2} flexShrink={0}>
        {topic.importance && (
          <Box flexShrink={0}>
            <Text color={IMPORTANCE_COLOR[topic.importance]} bold>
              {`${topic.importance === 'high' ? '▲ ' : ''}${IMPORTANCE_LABEL[topic.importance]} · `}
            </Text>
          </Box>
        )}
        <Text color="#8b949e" wrap="truncate">
          {`${count} · ${sources} · latest ${entry.latestDate.slice(0, 10)}`}
        </Text>
      </Box>
      <Box paddingX={2} flexShrink={0}>
        <Text color="#30363d">{'─'.repeat(width)}</Text>
      </Box>

      {topic.summary && (
        <Box paddingX={2} flexShrink={0}>
          <Text color="#c9d1d9" wrap="wrap">{topic.summary}</Text>
        </Box>
      )}
      {topic.highlights.map((h, i) => (
        <Box key={i} paddingX={2} flexShrink={0}>
          <Box flexShrink={0}><Text color="#58a6ff">{'• '}</Text></Box>
          <Text color="#c9d1d9" wrap="wrap">{h}</Text>
        </Box>
      ))}

      <Box paddingX={2} flexShrink={0} marginTop={topic.summary || topic.highlights.length ? 1 : 0}>
        <Text color="#8b949e" dimColor>
          {saved ? '↵ expand/collapse · r/u mark topic read/unread · o open newest' : '↵ expand/collapse · x mark topic read · o open newest'}
        </Text>
      </Box>
      {items.map((u) => (
        <Box key={u.id} flexDirection="column" paddingX={2} flexShrink={0}>
          <Box>
            {saved && (
              <Box flexShrink={0}><Text color="#58a6ff">{u.status === 'unread' ? '● ' : '  '}</Text></Box>
            )}
            <Box flexShrink={0}><Text color="#8b949e">{`${u.datePublished.slice(0, 10)}  `}</Text></Box>
            <Text color="#c9d1d9" wrap="truncate">{u.title}</Text>
          </Box>
          {u.summary && (
            <Box paddingLeft={12}>
              <Text color="#8b949e" wrap="wrap">{u.summary}</Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
