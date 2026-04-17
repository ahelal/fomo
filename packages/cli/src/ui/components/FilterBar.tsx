import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  filter: string;
  columns: number;
}

const FILTERS = ['all', 'unread', 'read', 'saved'];

export const FilterBar = React.memo(function FilterBar({ filter, columns }: Props) {
  // Web: background: var(--panel) #161b22, border-bottom: 1px solid var(--border) #30363d
  // Active pill: background var(--blue-dim) #0d4f8b, border var(--blue), color var(--text-bright)
  // Inactive pill: border var(--border), color var(--text-dim)
  const bg = '#161b22';

  const contentLen = FILTERS.reduce((sum, p) => sum + p.length + 3, 0) + 1;
  const pad = Math.max(0, columns - contentLen);

  return (
    <Box flexDirection="column" width={columns}>
      <Text backgroundColor={bg}>
        {FILTERS.map((pill, i) => {
          const active = pill === filter;
          return (
            <React.Fragment key={pill}>
              <Text backgroundColor={bg}>{' '}</Text>
              {active ? (
                <Text backgroundColor="#0d4f8b" color="#f0f6fc" bold>{` ${pill} `}</Text>
              ) : (
                <Text color="#8b949e" backgroundColor={bg}>{` ${pill} `}</Text>
              )}
            </React.Fragment>
          );
        })}
        <Text backgroundColor={bg}>{' '.repeat(pad)}</Text>
      </Text>
      <Text color="#30363d">{'─'.repeat(columns)}</Text>
    </Box>
  );
});
