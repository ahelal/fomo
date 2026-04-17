import React from 'react';
import { Box, Text } from 'ink';
import type { StatsResponse } from '@fomo/core';

interface Props {
  stats?: StatsResponse;
  loading?: boolean;
  message?: string;
  filter: string;
  columns: number;
}

export const StatusBar = React.memo(function StatusBar({ stats, loading, message, filter, columns }: Props) {
  const unread = stats?.byStatus.unread ?? 0;
  const saved  = stats?.saved          ?? 0;
  const read   = stats?.byStatus.read  ?? 0;
  const total  = stats?.total          ?? 0;

  const filterLabel = filter.toUpperCase();

  // Build left and right as styled segments, pad the gap with background-colored spaces
  // Web: full-width background: var(--blue-dim) #0d4f8b, border-bottom: var(--border) #30363d
  const bg = '#0d4f8b';

  // Compute visible lengths for padding
  const brandStr = ' 📰 FOMO ';
  const sep = ' │ ';
  const statsStr = stats
    ? `Total: ${total}  Unread: ${unread}  Read: ${read}  Saved: ${saved}`
    : 'loading…';
  const rightStr = `${loading ? ' ⟳ ' : ''}${message ? ` ${message} ` : ''}${sep}Filter: ${filterLabel} `;

  const leftLen = brandStr.length + sep.length + statsStr.length;
  const rightLen = rightStr.length;
  const gap = Math.max(1, columns - leftLen - rightLen);
  const pad = ' '.repeat(gap);

  return (
    <Box flexDirection="column" width={columns}>
      <Text backgroundColor={bg}>
        <Text color="#f0f6fc" bold backgroundColor={bg}>{brandStr}</Text>
        <Text color="#8b949e" backgroundColor={bg}>{sep}</Text>
        {stats ? (
          <>
            <Text color="#8b949e" backgroundColor={bg}>{'Total: '}</Text>
            <Text color="#f0f6fc" bold backgroundColor={bg}>{total}</Text>
            <Text color="#8b949e" backgroundColor={bg}>{'  Unread: '}</Text>
            <Text color="#f0f6fc" bold backgroundColor={bg}>{unread}</Text>
            <Text color="#8b949e" backgroundColor={bg}>{'  Read: '}</Text>
            <Text color="#8b949e" backgroundColor={bg}>{read}</Text>
            <Text color="#8b949e" backgroundColor={bg}>{'  Saved: '}</Text>
            <Text color="#e3b341" bold backgroundColor={bg}>{saved}</Text>
          </>
        ) : (
          <Text color="#8b949e" backgroundColor={bg}>{'loading…'}</Text>
        )}
        <Text backgroundColor={bg}>{pad}</Text>
        {loading && <Text color="#e3b341" backgroundColor={bg}>{' ⟳ '}</Text>}
        {message && <Text color="#3fb950" backgroundColor={bg}>{` ${message} `}</Text>}
        <Text color="#8b949e" backgroundColor={bg}>{sep}</Text>
        <Text color="#8b949e" backgroundColor={bg}>{'Filter: '}</Text>
        <Text color="#58a6ff" bold backgroundColor={bg}>{filterLabel}</Text>
        <Text backgroundColor={bg}>{' '}</Text>
      </Text>
      <Text color="#30363d">{'─'.repeat(columns)}</Text>
    </Box>
  );
});
