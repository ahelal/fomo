import React, { useRef } from 'react';
import { Box, Text } from 'ink';
import type { Update } from '@fomo/core';

const STATUS_ICON: Record<string, { icon: string; color: string }> = {
  unread: { icon: '●', color: '#58a6ff' },
  read:   { icon: '○', color: '#8b949e' },
};

const SOURCE_COLOR: Record<string, string> = {
  github: '#58a6ff',
  azure:  '#58a6ff',
  vscode: '#3fb950',
};

interface Props {
  updates: Update[];
  selectedIndex: number;
  height: number;
  columns: number;
  sourceLabels?: Record<string, string>;
}

export function UpdatesTable({ updates, selectedIndex, height, columns, sourceLabels = {} }: Props) {
  // Reserve lines for header(1) + bottom scroll indicator(1)
  // Each row takes 2 lines (content + separator), except last row takes 1
  const viewportRows = Math.max(1, Math.floor((height - 1) / 2));

  const scrollOffsetRef = useRef(0);
  const maxOffset = Math.max(0, updates.length - viewportRows);
  let scrollOffset = Math.min(scrollOffsetRef.current, maxOffset);
  if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
  else if (selectedIndex >= scrollOffset + viewportRows) scrollOffset = Math.max(0, selectedIndex - viewportRows + 1);
  scrollOffsetRef.current = scrollOffset;

  const visibleUpdates = updates.slice(scrollOffset, scrollOffset + viewportRows);
  const hasMoreBelow = scrollOffset + viewportRows < updates.length;

  // Column widths
  const sourceW = 13;
  const dateW = 12;
  const statusW = 4;
  const prefixW = 3;
  const fixedW = prefixW + sourceW + dateW + statusW + 2;
  const titleW = Math.max(10, columns - fixedW - 2);
  const separatorW = Math.max(columns - 2, 10);

  if (updates.length === 0) {
    return (
      <Box flexDirection="column" height={height}>
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <Text color="#8b949e">No updates yet — press </Text>
          <Text color="#58a6ff" bold>f</Text>
          <Text color="#8b949e"> to fetch</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={height} overflowY="hidden">
      {/* Column header — matches web: uppercase, dim */}
      <Box paddingX={1}>
        <Text color="#8b949e" dimColor>
          {'   '}
          {'SOURCE'.padEnd(sourceW)}
          {'DATE'.padEnd(dateW)}
          {'ST'.padEnd(statusW)}
          {'TITLE'}
        </Text>
      </Box>

      {/* Visible rows with separators between them */}
      {visibleUpdates.map((update, viewIdx) => {
        const realIdx = scrollOffset + viewIdx;
        const isSelected = realIdx === selectedIndex;
        const icon = STATUS_ICON[update.status] ?? { icon: '?', color: 'white' };
        const sourceColor = SOURCE_COLOR[update.source] ?? '#58a6ff';
        const dateStr = update.datePublished.slice(0, 10);
        const source = (sourceLabels[update.source] ?? update.source).slice(0, 11).padEnd(sourceW);
        const isUnread = update.status === 'unread';
        const isSaved = update.saved;
        const titleRaw = update.title.length > titleW
          ? `${update.title.slice(0, titleW - 1)}…`
          : update.title;

        const statusLabel = isSaved ? `⭐${icon.icon}` : `${icon.icon} `;
        const textColor = isUnread ? '#f0f6fc' : isSaved ? '#e3b341' : '#8b949e';

        return (
          <React.Fragment key={update.id}>
            {/* Row separator (before each row except the first) */}
            {viewIdx > 0 && (
              <Box paddingX={1}>
                <Text color="#30363d">{'─'.repeat(separatorW)}</Text>
              </Box>
            )}
            {/* Data row */}
            <Box paddingX={1}>
              {isSelected ? (
                <Text color="#1c7cd6" backgroundColor="#1c2d4f">{'▎ '}</Text>
              ) : (
                <Text>{'  '}</Text>
              )}
              <Text color={sourceColor} bold={isUnread} backgroundColor={isSelected ? '#1c2d4f' : undefined}>{source}</Text>
              <Text color={textColor} bold={isUnread} backgroundColor={isSelected ? '#1c2d4f' : undefined}>{dateStr.padEnd(dateW)}</Text>
              <Text color={isSaved ? '#e3b341' : icon.color} backgroundColor={isSelected ? '#1c2d4f' : undefined}>{statusLabel.padEnd(statusW)}</Text>
              <Text color={textColor} bold={isUnread} backgroundColor={isSelected ? '#1c2d4f' : undefined} wrap="truncate">{titleRaw}</Text>
            </Box>
          </React.Fragment>
        );
      })}

      {/* Bottom scroll indicator */}
      {hasMoreBelow && (
        <Box paddingX={1} justifyContent="center">
          <Text color="#8b949e">{'▼ more ▼'}</Text>
        </Box>
      )}
    </Box>
  );
}
