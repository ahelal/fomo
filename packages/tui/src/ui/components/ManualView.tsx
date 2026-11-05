import React from 'react';
import { Box, Text } from 'ink';
import { formatDate, type Update } from '@fomo/core';
import { type ManualViewState } from '../hooks/useManual.js';

const ACCENT = '#58a6ff';
const MUTED = '#8b949e';
const TEXT = '#c9d1d9';
const ERROR = '#f85149';

interface Props extends ManualViewState {
  height: number;
  columns: number;
}

function cursorText(value: string, cursor: number) {
  return `${value.slice(0, cursor)}▏${value.slice(cursor)}`;
}

function EntryRow({ entry, selected, columns }: { entry: Update; selected: boolean; columns: number }) {
  const title = entry.title.length > columns - 26 ? `${entry.title.slice(0, Math.max(1, columns - 27))}…` : entry.title;
  return (
    <Box width={columns}>
      <Text backgroundColor={selected ? ACCENT : undefined} color={selected ? '#0d1117' : TEXT} wrap="truncate-end">
        {selected ? '› ' : '  '}
        <Text color={selected ? '#0d1117' : entry.status === 'unread' ? ACCENT : MUTED}>{entry.status === 'unread' ? '● ' : '○ '}</Text>
        {title}
        <Text color={selected ? '#0d1117' : MUTED}>{`  ${formatDate(entry.dateAdded)}`}</Text>
      </Text>
    </Box>
  );
}

export function ManualView({ entries, selectedIndex, form, confirmDelete, loading, height, columns }: Props) {
  const active = entries[selectedIndex];
  const leftW = Math.max(28, Math.floor(columns * 0.4));
  const rightW = columns - leftW - 1;
  const header = (
    <Box width={columns} borderStyle="single" borderBottom borderTop={false} borderLeft={false} borderRight={false} borderColor="gray">
      <Text color={ACCENT} bold>{' 📖 Learning Manual'}</Text>
      <Text color={MUTED}>{` · ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}${loading ? ' · loading…' : ''}`}</Text>
      {!form && <Text color={MUTED} wrap="truncate-end">{'   [a] add  [e/↵] edit  [d d] delete  [↑↓/jk] select'}</Text>}
    </Box>
  );

  if (form) {
    return (
      <Box flexDirection="column" height={height} width={columns}>
        {header}
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          <Text color={form.field === 'title' ? ACCENT : MUTED}>Title</Text>
          <Text color={TEXT}>{cursorText(form.title, form.field === 'title' ? form.cursor : form.title.length)}</Text>
          <Text color={form.field === 'body' ? ACCENT : MUTED}>Body</Text>
          <Text color={TEXT} wrap="truncate-end">{cursorText(form.body || '', form.field === 'body' ? form.cursor : form.body.length)}</Text>
          {form.error && <Text color={ERROR}>{form.error}</Text>}
          <Text color={MUTED}>{form.saving ? 'Saving…' : '[Tab] title/body  [Ctrl+S] save  [Enter] new line in body  [Esc] cancel'}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={height} width={columns}>
      {header}
      <Box flexDirection="row" flexGrow={1} minHeight={0}>
        <Box flexDirection="column" width={leftW} borderStyle="single" borderColor="gray" borderTop={false} borderBottom={false} borderLeft={false}>
          {entries.length === 0
            ? <Text color={MUTED}>{loading ? ' Loading…' : ' No entries. Press a to add one.'}</Text>
            : entries.map((entry, i) => <EntryRow key={entry.id} entry={entry} selected={i === selectedIndex} columns={leftW} />)}
        </Box>
        <Box flexDirection="column" width={rightW} paddingX={1}>
          {active ? (
            <>
              <Text bold color="#f0f6fc" wrap="truncate">{active.title}</Text>
              <Text color={MUTED}>{`Manual · ${active.status} · added ${formatDate(active.dateAdded)}`}</Text>
              <Text color={TEXT} wrap="truncate-end">{active.content}</Text>
              {confirmDelete === active.id && <Text color={ERROR}>Press d again to delete, any other key cancels.</Text>}
            </>
          ) : <Text color={MUTED}>Your manually added reading appears here and in the regular Unread list.</Text>}
        </Box>
      </Box>
    </Box>
  );
}
