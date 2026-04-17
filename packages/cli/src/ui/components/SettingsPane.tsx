import React from 'react';
import { Box, Text } from 'ink';
import type { AppSettings, PreviewPosition, SourceInfo } from '@fomo/core';

interface Props {
  settings: AppSettings;
  sources: SourceInfo[];
  focusIndex: number;
  editingLabel: boolean;
  labelBuffer: string;
  height: number;
  columns: number;
}

const PREVIEW_OPTIONS: PreviewPosition[] = ['right', 'bottom', 'off'];

export const SettingsPane = React.memo(function SettingsPane({
  settings,
  sources,
  focusIndex,
  editingLabel,
  labelBuffer,
  height,
  columns,
}: Props) {
  const bg = '#0d1117';
  const disabledSet = new Set(settings.disabledSources);

  // Build list of configurable items
  const items: { id: string; label: string; value: string; type: 'source' | 'preview' }[] = sources.map((s) => ({
    id: s.id,
    label: s.displayName,
    value: disabledSet.has(s.id) ? 'disabled' : 'enabled',
    type: 'source' as const,
  }));
  items.push({
    id: '_preview',
    label: 'Preview Position',
    value: settings.previewPosition,
    type: 'preview' as const,
  });

  const headerH = 3;
  const footerH = 2;
  const listH = Math.max(1, height - headerH - footerH);

  // Fixed column widths to prevent layout shifts
  const nameW = 20;
  const statusW = 10; // ' enabled ' or ' disabled'
  const labelW = 16;

  return (
    <Box flexDirection="column" height={height} width={columns}>
      <Box paddingX={2} paddingTop={1}>
        <Text color="#f0f6fc" bold>{'⚙️  Settings'}</Text>
      </Box>
      <Box height={1} />

      <Box flexDirection="column" paddingX={2} height={listH}>
        {items.slice(0, listH).map((item, i) => {
          const focused = i === focusIndex;
          const rowBg = focused ? '#1c2d4f' : bg;
          const cursor = focused ? <Text color="#1c7cd6" backgroundColor={rowBg}>{'▸ '}</Text> : <Text backgroundColor={rowBg}>{'  '}</Text>;
          const pad = ' '.repeat(Math.max(0, columns - nameW - statusW - labelW - 8));

          if (item.type === 'source') {
            const enabled = item.value === 'enabled';
            const customLabel = settings.sourceLabels[item.id];
            const isEditingThis = editingLabel && focused;

            return (
              <Text key={item.id} backgroundColor={rowBg}>
                {cursor}
                {enabled
                  ? <Text color="#3fb950" backgroundColor={rowBg}>{'● '}</Text>
                  : <Text color="#f85149" backgroundColor={rowBg}>{'○ '}</Text>}
                <Text color={enabled ? '#f0f6fc' : '#8b949e'} backgroundColor={rowBg}>
                  {item.label.padEnd(nameW)}
                </Text>
                <Text color={enabled ? '#3fb950' : '#f85149'} backgroundColor={rowBg}>
                  {(enabled ? ' enabled' : ' disabled').padEnd(statusW)}
                </Text>
                {isEditingThis ? (
                  <Text color="#e3b341" backgroundColor="#2d1b00">
                    {` ${(labelBuffer + '▏').padEnd(labelW)}`}
                  </Text>
                ) : (
                  <Text color="#58a6ff" backgroundColor={rowBg}>
                    {customLabel ? ` ${customLabel}`.padEnd(labelW) : ''.padEnd(labelW)}
                  </Text>
                )}
                <Text backgroundColor={rowBg}>{pad}</Text>
              </Text>
            );
          }

          return (
            <Text key={item.id} backgroundColor={rowBg}>
              {cursor}
              <Text color="#58a6ff" backgroundColor={rowBg}>{'◆ '}</Text>
              <Text color="#f0f6fc" backgroundColor={rowBg}>
                {item.label.padEnd(nameW)}
              </Text>
              <Text color="#58a6ff" backgroundColor={rowBg}>
                {` ${item.value}`.padEnd(statusW)}
              </Text>
              <Text backgroundColor={rowBg}>{''.padEnd(labelW)}</Text>
              <Text backgroundColor={rowBg}>{pad}</Text>
            </Text>
          );
        })}
      </Box>

      <Box height={1} />
      <Box paddingX={2}>
        <Text color="#8b949e">
          {editingLabel
            ? 'type label  ⏎ save  Esc cancel'
            : '↑↓ navigate  ⏎ toggle  e label  c/Esc close'}
        </Text>
      </Box>
    </Box>
  );
});

export { PREVIEW_OPTIONS };
