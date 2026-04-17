import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  view: 'list' | 'detail' | 'settings';
  columns: number;
}

const LIST_KEYS: [string, string][] = [
  ['↵', 'detail'],
  ['r', 'read'],
  ['u', 'unread'],
  ['s', 'save/unsave'],
  ['x', 'read & next'],
  ['o', 'open'],
  ['c', 'settings'],
];

const DETAIL_KEYS: [string, string][] = [
  ['Esc', 'back'],
  ['r', 'read'],
  ['u', 'unread'],
  ['s', 'save/unsave'],
  ['x', 'read & next'],
  ['o', 'open url'],
  ['p', 'fetch content'],
  ['c', 'settings'],
];

const SETTINGS_KEYS: [string, string][] = [
  ['↑↓', 'navigate'],
  ['↵', 'toggle'],
  ['c', 'close'],
  ['Esc', 'close'],
];

export const KeyHelp = React.memo(function KeyHelp({ view, columns }: Props) {
  const keys = view === 'settings' ? SETTINGS_KEYS : view === 'list' ? LIST_KEYS : DETAIL_KEYS;

  // Web: background: var(--panel) #161b22, border-top: 1px solid var(--border) #30363d
  // Keys in <kbd>: border var(--border), color var(--cyan) #58a6ff
  // Labels: var(--text-dim) #8b949e, separator: var(--border) #30363d
  const bg = '#161b22';

  // Build the content string to compute padding
  const segments = keys.map(([key, label], i) => {
    const prefix = i > 0 ? ' · ' : ' ';
    return `${prefix}[${key}] ${label}`;
  });
  const contentLen = segments.join('').length;
  const pad = Math.max(0, columns - contentLen - 1);

  return (
    <Box flexDirection="column" width={columns}>
      <Text color="#30363d">{'─'.repeat(columns)}</Text>
      <Text backgroundColor={bg}>
        {keys.map(([key, label], i) => (
          <React.Fragment key={key}>
            {i > 0 && <Text color="#30363d" backgroundColor={bg}>{' · '}</Text>}
            {i === 0 && <Text backgroundColor={bg}>{' '}</Text>}
            <Text color="#58a6ff" bold backgroundColor={bg}>{'['}{key}{']'}</Text>
            <Text color="#8b949e" backgroundColor={bg}>{` ${label}`}</Text>
          </React.Fragment>
        ))}
        <Text backgroundColor={bg}>{' '.repeat(pad)}</Text>
      </Text>
    </Box>
  );
});
