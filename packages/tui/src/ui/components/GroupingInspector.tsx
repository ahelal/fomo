import React from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { formatDateTime } from '@fomo/core';
import type { DigestInspection } from '@fomo/core/digest';

export function inspectionText(inspection: DigestInspection | undefined, inputs: boolean): string {
  if (!inspection) return 'No grouping run recorded. Press r to regroup unread and pending items.';
  const titles = new Map(inspection.items.map((item) => [item.id, item.title]));
  const lines = [
    `Run started: ${formatDateTime(inspection.startedAt) || inspection.startedAt}`,
    `Frozen guidance: ${inspection.guidance || '(none)'}`,
    'Similarity scores are lexical overlap, not confidence. Rationales are model statements, not internal reasoning.',
    '',
  ];
  for (const call of inspection.calls) {
    lines.push(`${call.label}: ${call.state}${call.error ? ` - ${call.error}` : ''}`);
    for (const group of call.groups ?? []) {
      lines.push(`  ${group.title} (${group.itemIds.length})`,
        `  Model rationale: ${group.rationale || '(not supplied)'}`,
        ...group.itemIds.map((id) => `    - ${titles.get(id) ?? id}`));
    }
    if (inputs) {
      lines.push('SYSTEM:', call.system, 'INPUT (includes lexical clues and item excerpts):', call.prompt);
      if (call.response !== undefined) lines.push('RAW RESPONSE (before validation):', JSON.stringify(call.response, null, 2));
    }
    lines.push('');
  }
  return lines.join('\n');
}

interface Props {
  inspection?: DigestInspection;
  guidance: string;
  inputs: boolean;
  offset: number;
  height: number;
  columns: number;
  editing?: 'feedback' | 'guidance';
  buffer: string;
  cursor: number;
  busy: boolean;
  historyLabel?: string;
}

export function groupingLines(text: string, columns: number): string[] {
  const width = Math.max(10, columns - 4);
  return text.split('\n').flatMap((line) => {
    const lines: string[] = [];
    let current = '';
    let used = 0;
    for (const char of line) {
      const size = stringWidth(char);
      if (used + size > width) { lines.push(current); current = ''; used = 0; }
      current += char;
      used += size;
    }
    return [...lines, current];
  });
}

export function GroupingInspector({ inspection, guidance, inputs, offset, height, columns, editing, buffer, cursor, busy, historyLabel }: Props) {
  const editLabel = editing === 'feedback' ? 'Describe what should change; Copilot will suggest reusable guidance.' : 'Review/edit guidance. Ctrl+S saves; it applies to the NEXT run only.';
  const text = editing
    ? `${editLabel}\n\n${buffer.slice(0, cursor)}|${buffer.slice(cursor)}`
    : `Current guidance: ${guidance || '(none)'}\n\n${inspectionText(inspection, inputs)}`;
  const lines = groupingLines(text, columns);
  const page = Math.max(1, height - 5);
  const cursorLine = groupingLines(`${editLabel}\n\n${buffer.slice(0, cursor)}|`, columns).length - 1;
  const start = editing ? Math.max(0, cursorLine - page + 1) : Math.min(offset, Math.max(0, lines.length - page));
  return (
    <Box flexDirection="column" height={height} width={columns} paddingX={2}>
      <Text bold color="#58a6ff">Behind the grouping (experimental)</Text>
      <Text dimColor>{busy ? 'Working - live inspection available; guidance and rerun wait until idle.' : `${historyLabel ?? 'No saved runs'} - [ older / ] newer. Saved requests marked running may have been interrupted.`}</Text>
      <Box flexDirection="column" height={page} overflowY="hidden">
        {lines.slice(start, start + page).map((line, i) => <Text key={i}>{line || ' '}</Text>)}
      </Box>
      <Text dimColor>{editing ? 'Ctrl+S submit / save   Esc cancel   Ctrl+U clear' : 'Up/Down scroll   [/] history   i inputs   f feedback   e guidance   r regroup   Esc close'}</Text>
    </Box>
  );
}
