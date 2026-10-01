import React from 'react';
import { Box, Text } from 'ink';
import { tildify } from '../../config.js';

export interface BackupFile {
  name: string;
  path: string;
  size: number;
  mtime: Date;
}

interface Props {
  dir: string;
  files: BackupFile[];
  focusIndex: number;
  confirming: boolean;
  height: number;
  columns: number;
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function RestorePicker({ dir, files, focusIndex, confirming, height, columns }: Props) {
  const listH = Math.max(1, height - 8);
  const start = Math.max(0, Math.min(focusIndex - Math.floor(listH / 2), files.length - listH));
  const visible = files.slice(start, start + listH);
  const nameW = Math.max(10, Math.min(48, columns - 36));

  return (
    <Box flexDirection="column" height={height} width={columns} paddingX={2} paddingTop={1}>
      <Text color="#f0f6fc" bold>{'⤓ Restore from backup'}</Text>
      <Text color="#8b949e" wrap="truncate">{`${tildify(dir)} · updates in the backup are added back or overwritten; nothing is deleted`}</Text>
      <Box height={1} />
      <Box flexDirection="column" height={listH} overflowY="hidden">
        {visible.map((file, i) => {
          const focused = start + i === focusIndex;
          const bg = focused ? '#1c2d4f' : '#0d1117';
          const name = file.name.length > nameW ? `${file.name.slice(0, nameW - 1)}…` : file.name.padEnd(nameW);
          return (
            <Text key={file.path} wrap="truncate">
              <Text color="#1c7cd6" backgroundColor={bg}>{focused ? '▸ ' : '  '}</Text>
              <Text color="#f0f6fc" backgroundColor={bg}>{name}</Text>
              <Text color="#8b949e" backgroundColor={bg}>{`  ${file.mtime.toLocaleString()}  ${formatSize(file.size).padStart(8)}`}</Text>
            </Text>
          );
        })}
      </Box>
      <Box height={1} />
      {confirming ? (
        <Text color="#e3b341">{`Press ↵ again to restore ${files[focusIndex]?.name ?? ''} · Esc cancel`}</Text>
      ) : (
        <Text color="#8b949e">
          <Text color="#58a6ff" bold>↑/↓</Text>{' choose   '}
          <Text color="#58a6ff" bold>↵</Text>{' restore   '}
          <Text color="#58a6ff" bold>Esc</Text>{' close'}
        </Text>
      )}
    </Box>
  );
}
