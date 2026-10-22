import React from 'react';
import { Box, Text } from 'ink';
import type { AuditEntry } from '../../audit.js';
import { tildify } from '../../config.js';

interface Props {
  file: string;
  /** Newest first, already filtered. */
  entries: AuditEntry[];
  focusIndex: number;
  errorsOnly: boolean;
  height: number;
  columns: number;
}

const DETAIL_H = 4;
const ACTION_W = 16;

const stamp = (ts: string) => {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(0, 14).padEnd(14);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${d.toTimeString().slice(0, 8)}`;
};

const firstLine = (text = '') => text.split('\n').find((l) => l.trim())?.trim() ?? '';

export function AuditView({ file, entries, focusIndex, errorsOnly, height, columns }: Props) {
  const listH = Math.max(1, height - 7 - DETAIL_H);
  const start = Math.max(0, Math.min(focusIndex - Math.floor(listH / 2), entries.length - listH));
  const visible = entries.slice(start, start + listH);
  const focused = entries[focusIndex];
  const errors = entries.filter((e) => e.level === 'error').length;
  const summary = errorsOnly
    ? `${entries.length} error${entries.length !== 1 ? 's' : ''}`
    : `${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'} · ${errors} error${errors !== 1 ? 's' : ''}`;

  return (
    <Box flexDirection="column" height={height} width={columns} paddingX={2} paddingTop={1}>
      <Text color="#f0f6fc" bold>{`🧾 Audit trail${errorsOnly ? ' · errors only' : ''}`}</Text>
      <Text color="#8b949e" wrap="truncate">{`${tildify(file)} · ${summary} · newest first`}</Text>
      <Box height={1} />
      <Box flexDirection="column" height={listH} overflowY="hidden">
        {entries.length === 0 ? (
          <Text color="#8b949e">{errorsOnly ? 'No errors recorded.' : 'Nothing recorded yet.'}</Text>
        ) : visible.map((e, i) => {
          const isFocused = start + i === focusIndex;
          const bg = isFocused ? '#1c2d4f' : '#0d1117';
          const isError = e.level === 'error';
          return (
            <Text key={`${start + i}-${e.ts}`} wrap="truncate">
              <Text color="#1c7cd6" backgroundColor={bg}>{isFocused ? '▸ ' : '  '}</Text>
              <Text color="#8b949e" backgroundColor={bg}>{`${stamp(e.ts)}  `}</Text>
              <Text color={isError ? '#f85149' : '#3fb950'} backgroundColor={bg}>{isError ? '✗ ' : '· '}</Text>
              <Text color={isError ? '#f85149' : '#58a6ff'} backgroundColor={bg}>{e.action.padEnd(ACTION_W)}</Text>
              {e.profile ? <Text color="#d2a8ff" backgroundColor={bg}>{` [${e.profile}]`}</Text> : null}
              <Text color="#c9d1d9" backgroundColor={bg}>{` ${firstLine(e.detail)}`}</Text>
            </Text>
          );
        })}
      </Box>
      <Box height={1} />
      <Box flexDirection="column" height={DETAIL_H} overflowY="hidden">
        {focused?.detail ? (
          <Text color={focused.level === 'error' ? '#f85149' : '#c9d1d9'} wrap="wrap">{focused.detail}</Text>
        ) : null}
      </Box>
      <Box height={1} />
      <Text color="#8b949e">
        <Text color="#58a6ff" bold>↑/↓</Text>{' move   '}
        <Text color="#58a6ff" bold>e</Text>{errorsOnly ? ' show all   ' : ' errors only   '}
        <Text color="#58a6ff" bold>Esc</Text>{' close'}
      </Text>
    </Box>
  );
}
