import React, { type Ref } from 'react';
import { Box, Text } from 'ink';
import { formatDate, IMPORTANCE_LABEL, type DigestEntry } from '@fomo/core';
import { PreviewViewport, type PreviewLine, type PreviewScroll } from './PreviewViewport.js';

const IMPORTANCE_COLOR = { high: '#f0883e', medium: '#58a6ff', low: '#8b949e' } as const;

interface Props {
  entry: DigestEntry;
  height: number;
  columns: number;
  position?: 'bottom' | 'right';
  focused?: boolean;
  scrollRef?: Ref<PreviewScroll>;
  sourceLabels?: Record<string, string>;
  /** `saved` shows the topic's pending updates, marking the unread ones. */
  mode?: 'digest' | 'saved';
}

/** Summary + highlights of a digest topic, followed by the updates it groups. */
export function TopicPane({ entry, height, columns, position = 'bottom', focused, scrollRef, sourceLabels = {}, mode = 'digest' }: Props) {
  const { topic, items } = entry;
  const saved = mode === 'saved';
  const unread = items.filter((u) => u.status === 'unread').length;
  const count = saved
    ? `${items.length} pending update${items.length === 1 ? '' : 's'}${unread ? ` (${unread} unread)` : ''}`
    : `${items.length} update${items.length === 1 ? '' : 's'}`;
  const sources = entry.sources.map((s) => sourceLabels[s] ?? s).join(', ');
  const lines: PreviewLine[] = [];
  if (topic.summary) lines.push({ text: topic.summary });
  lines.push(...topic.highlights.map((h) => ({ text: `• ${h}` })));
  lines.push({ text: '' }, {
    text: saved ? '↵ expand/collapse · r toggle topic read/unread · o open newest' : '↵ expand/collapse · r toggle read/unread · x read & next · o open newest',
    color: '#8b949e',
  });
  for (const u of items) {
    lines.push({ text: `${saved && u.status === 'unread' ? '● ' : ''}${formatDate(u.datePublished)}  ${u.title}` });
    if (u.summary) lines.push({ text: u.summary, color: '#8b949e' });
  }

  // Blocks don't shrink, so a tall topic is clipped at the bottom instead of drawing lines over each other.
  return (
    <Box flexDirection="column" height={height} overflowY="hidden">
      {position === 'bottom' && (
        <Box paddingX={1} flexShrink={0}>
          <Text color={focused ? '#58a6ff' : '#30363d'}>{'─'.repeat(Math.max(columns - 2, 10))}</Text>
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
          {`${count} · ${sources} · latest ${formatDate(entry.latestDate)}`}
        </Text>
      </Box>
      <PreviewViewport
        key={topic.id}
        lines={lines}
        height={height - (position === 'bottom' ? 3 : 2)}
        columns={columns}
        focused={focused}
        scrollRef={scrollRef}
      />
    </Box>
  );
}
