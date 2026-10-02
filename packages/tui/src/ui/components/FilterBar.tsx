import React from 'react';
import { Box, Text } from 'ink';

const FILTERS = [
  { key: '0', label: 'Digest', value: 'digest' },
  { key: '1', label: 'All',    value: 'all' },
  { key: '2', label: 'Unread', value: 'unread' },
  { key: '3', label: 'Read',   value: 'read' },
  { key: '4', label: 'Saved',  value: 'saved' },
] as const;

interface Props {
  active: string;
  columns: number;
  /** Name of the source the list is limited to, if any. */
  sourceLabel?: string;
}

export function FilterBar({ active, columns, sourceLabel }: Props) {
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
      {sourceLabel && active !== 'digest' && (
        <>
          <Text color="gray"> </Text>
          <Text color="#e3b341" inverse>{` src:${sourceLabel} `}</Text>
          <Text color="#8b949e">{' Esc clears'}</Text>
        </>
      )}
    </Box>
  );
}
