import React, { useImperativeHandle, useMemo, useState, type Ref } from 'react';
import { Box, Text } from 'ink';
import { textRows, textWidth } from '../text.js';

export interface PreviewScroll {
  scroll(delta: number): void;
}

export interface PreviewLine {
  text: string;
  color?: string;
  bold?: boolean;
}

interface Props {
  lines: PreviewLine[];
  height: number;
  columns: number;
  focused?: boolean;
  scrollRef?: Ref<PreviewScroll>;
}

function wrapPreview(text: string, width: number): string[] {
  return text.split('\n').flatMap((paragraph) => {
    const rows: string[] = [];
    let row = '';
    for (const word of paragraph.match(/\S+|\s+/g) ?? []) {
      if (/^\s+$/.test(word)) {
        if (row && textWidth(row + word) <= width) row += word;
        continue;
      }
      if (row && textWidth(row + word) > width) {
        rows.push(row.trimEnd());
        row = '';
      }
      const parts = textRows(word, width);
      rows.push(...parts.slice(0, -1).map((part) => part.text));
      row += parts.at(-1)!.text;
    }
    rows.push(row.trimEnd());
    return rows;
  });
}

export function PreviewViewport({ lines, height, columns, focused = false, scrollRef }: Props) {
  const [offset, setOffset] = useState(0);
  const width = Math.max(1, columns - 4);
  const wrapped = useMemo(
    () => lines.flatMap(({ text, ...style }) => wrapPreview(text, width).map((row) => ({ ...style, text: row }))),
    [lines, width],
  );
  const room = Math.max(0, height - 1);
  const maxOffset = Math.max(0, wrapped.length - room);
  const start = Math.min(offset, maxOffset);
  const progress = wrapped.length > room ? ` ${start + 1}–${Math.min(start + room, wrapped.length)}/${wrapped.length} ` : '';
  useImperativeHandle(scrollRef, () => ({
    scroll(delta) {
      setOffset(Math.max(0, Math.min(maxOffset, start + delta)));
    },
  }), [maxOffset, start]);

  return (
    <Box flexDirection="column" height={Math.max(0, height)} flexShrink={0} overflowY="hidden">
      <Box paddingX={2} flexShrink={0}>
        <Text wrap="truncate" color={focused ? '#58a6ff' : '#30363d'}>
          {'─'.repeat(Math.max(0, width - textWidth(progress)))}{progress}
        </Text>
      </Box>
      {wrapped.slice(start, start + room).map((line, i) => (
        <Box key={i} paddingX={2} height={1} flexShrink={0}>
          <Text color={line.color ?? '#c9d1d9'} bold={line.bold} wrap="truncate">{line.text || ' '}</Text>
        </Box>
      ))}
    </Box>
  );
}
