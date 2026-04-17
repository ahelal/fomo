import React from 'react';
import { Box, Text } from 'ink';
import type { Update } from '@fomo/core';

interface Props {
  update: Update;
  height: number;
  columns: number;
  position?: 'bottom' | 'right';
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

export function DetailPane({ update, height, columns, position = 'bottom' }: Props) {
  const badge = STATUS_BADGE[update.status] ?? { label: '???', color: 'white' };
  const sourceColor = SOURCE_COLOR[update.source] ?? '#58a6ff';

  const content = update.content
    ? update.content
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  const hasContent = content.length > 0;

  const contentLines = Math.max(1, height - 6);
  const maxContentLen = columns * contentLines;
  const truncatedContent = content.length > maxContentLen
    ? content.slice(0, maxContentLen - 1) + '…'
    : content;

  return (
    <Box flexDirection="column" height={height} overflowY="hidden">
      {/* Top divider */}
      {position === 'bottom' && (
        <Box paddingX={1}>
          <Text color="#30363d">{'─'.repeat(Math.max(columns - 2, 10))}</Text>
        </Box>
      )}

      {/* Title */}
      <Box paddingX={2}>
        <Text bold color="#f0f6fc" wrap="truncate">
          {update.title}
        </Text>
      </Box>

      {/* Meta: source + date */}
      <Box paddingX={2}>
        <Text color="#8b949e">{'Source '}</Text>
        <Text color={sourceColor} bold>{update.source}</Text>
        <Text color="#8b949e">{'   Published '}</Text>
        <Text color="#c9d1d9">{update.datePublished.slice(0, 10)}</Text>
      </Box>

      {/* Meta: status + saved */}
      <Box paddingX={2}>
        <Text color="#8b949e">{'Status '}</Text>
        <Text color={badge.color} bold>{badge.label.toLowerCase()}</Text>
        {update.saved && <Text color="#e3b341" bold>{' ⭐'}</Text>}
      </Box>

      {/* URL */}
      <Box paddingX={2}>
        <Text color="#58a6ff" underline wrap="truncate">{update.url}</Text>
      </Box>

      {/* Content divider */}
      <Box paddingX={2}>
        <Text color="#30363d">{'─'.repeat(Math.max(columns - 6, 10))}</Text>
      </Box>

      {/* Content preview */}
      <Box paddingX={2} flexGrow={1} overflowY="hidden">
        {hasContent ? (
          <Text wrap="wrap" color="#c9d1d9">
            {truncatedContent}
          </Text>
        ) : (
          <Text wrap="wrap" color="#8b949e">
            {'No preview — press '}
            <Text color="#58a6ff" bold>p</Text>
            {' to fetch content or '}
            <Text color="#58a6ff" bold>o</Text>
            {' to open in browser'}
          </Text>
        )}
      </Box>
    </Box>
  );
}
