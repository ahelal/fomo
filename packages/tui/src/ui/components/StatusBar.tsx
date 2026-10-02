import React from 'react';
import { Box, Text } from 'ink';
import type { StatsResponse } from '@fomo/core';

interface Props {
  stats?: StatsResponse;
  loading?: boolean;
  message?: string;
  columns: number;
  onHelp?(): void;
}

export const StatusBar = React.memo(function StatusBar({ stats, loading, message, columns, onHelp }: Props) {
  const unread = stats?.byStatus.unread ?? 0;
  const saved  = stats?.saved          ?? 0;
  const read   = stats?.byStatus.read  ?? 0;
  const total  = stats?.total          ?? 0;

  const bg = '#0d4f8b';

  const brandStr = ' 📰 FOMO ';
  const sep = ' │ ';
  const statsStr = stats
    ? `Total: ${total}  Unread: ${unread}  Read: ${read}  Saved: ${saved}`
    : 'loading…';
  const leftLen = brandStr.length + sep.length + statsStr.length;
  const fixedRightLen = (loading ? 3 : 0) + sep.length + '[h] help '.length;
  const room = columns - leftLen - fixedRightLen - 3;
  const shownMessage = message && message.length > room
    ? (room > 1 ? `${message.slice(0, room - 1)}…` : undefined)
    : message;

  const rightStr = `${loading ? ' ⟳ ' : ''}${shownMessage ? ` ${shownMessage} ` : ''}${sep}[h] help `;

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
        {shownMessage && <Text color="#3fb950" backgroundColor={bg}>{` ${shownMessage} `}</Text>}
        <Text color="#8b949e" backgroundColor={bg}>{sep}</Text>
        <Text color="#58a6ff" bold backgroundColor={bg}>{'[h]'}</Text>
        <Text color="#8b949e" backgroundColor={bg}>{' help '}</Text>
      </Text>
      <Text color="#30363d">{'─'.repeat(columns)}</Text>
    </Box>
  );
});
