import React from 'react';
import { Box, Text } from 'ink';

export interface SourceOption {
  id: string;
  label: string;
  color: string;
  /** Updates from this source in the current view (with the search applied). */
  count: number;
}

interface Props {
  /** Undefined while the counts load. */
  options: SourceOption[] | undefined;
  checked: ReadonlySet<string>;
  focusIndex: number;
  /** Shown when ↵ is pressed with nothing ticked. */
  warning?: string;
  height: number;
  columns: number;
}

export function SourcePicker({ options, checked, focusIndex, warning, height, columns }: Props) {
  const listH = Math.max(1, height - 7);
  const total = options?.length ?? 0;
  const start = Math.max(0, Math.min(focusIndex - Math.floor(listH / 2), total - listH));
  const visible = options?.slice(start, start + listH) ?? [];
  const labelW = Math.max(10, Math.min(32, columns - 24));

  return (
    <Box flexDirection="column" height={height} width={columns} paddingX={2} paddingTop={1}>
      <Text color="#f0f6fc" bold>{'⧩ Show sources'}</Text>
      <Text color="#8b949e" wrap="truncate">
        {options ? `${checked.size} of ${total} selected · counts are for this view and search` : 'Counting updates per source…'}
      </Text>
      <Box height={1} />
      <Box flexDirection="column" height={listH} overflowY="hidden">
        {options && total === 0 && <Text color="#8b949e">No updates in this view</Text>}
        {visible.map((o, i) => {
          const focused = start + i === focusIndex;
          const on = checked.has(o.id);
          const bg = focused ? '#1c2d4f' : undefined;
          const label = o.label.length > labelW ? `${o.label.slice(0, labelW - 1)}…` : o.label.padEnd(labelW);
          return (
            <Text key={o.id} wrap="truncate">
              <Text color="#1c7cd6" backgroundColor={bg}>{focused ? '▸ ' : '  '}</Text>
              <Text color={on ? '#3fb950' : '#8b949e'} backgroundColor={bg}>{on ? '[x] ' : '[ ] '}</Text>
              <Text color={on ? o.color : '#8b949e'} bold={on} backgroundColor={bg}>{label}</Text>
              <Text color="#8b949e" backgroundColor={bg}>{String(o.count).padStart(6)}</Text>
            </Text>
          );
        })}
      </Box>
      <Box height={1} />
      {warning ? (
        <Text color="#e3b341">{warning}</Text>
      ) : (
        <Text color="#8b949e" wrap="truncate">
          <Text color="#58a6ff" bold>↑/↓</Text>{' move   '}
          <Text color="#58a6ff" bold>space</Text>{' toggle   '}
          <Text color="#58a6ff" bold>a</Text>{' all   '}
          <Text color="#58a6ff" bold>n</Text>{' none   '}
          <Text color="#58a6ff" bold>↵</Text>{' apply   '}
          <Text color="#58a6ff" bold>Esc</Text>{' cancel'}
        </Text>
      )}
    </Box>
  );
}
