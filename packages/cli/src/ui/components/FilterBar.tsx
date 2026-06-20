import React from 'react';
import { Box, Text } from 'ink';

const FILTERS = [
  { key: '1', label: 'All',    value: 'all' },
  { key: '2', label: 'Unread', value: 'unread' },
  { key: '3', label: 'Read',   value: 'read' },
  { key: '4', label: 'Saved',  value: 'saved' },
] as const;

interface Props {
  active: string;
  columns: number;
}

export function FilterBar({ active, columns }: Props) {
  return (
    <Box width={columns} flexShrink={0}>
      {FILTERS.map((f, i) => {
        const isActive = active === f.value;
        return (
          <React.Fragment key={f.value}>
            {i > 0 && <Text color="gray"> </Text>}
            <Text
              color={isActive ? '#58a6ff' : '#8b949e'}
              bold={isActive}
              inverse={isActive}
            >
              {` ${f.key} ${f.label} `}
            </Text>
          </React.Fragment>
        );
      })}
      <Text color="gray"> </Text>
      <Text color="#8b949e">{` t Todos `}</Text>
    </Box>
  );
}
