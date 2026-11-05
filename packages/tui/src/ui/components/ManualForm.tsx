import React from 'react';
import { Box, Text } from 'ink';
import type { ManualViewState } from '../hooks/useManual.js';

interface Props {
  form: NonNullable<ManualViewState>;
  height: number;
  columns: number;
}

function cursorText(value: string, cursor: number) {
  return `${value.slice(0, cursor)}▏${value.slice(cursor)}`;
}

export function ManualForm({ form, height, columns }: Props) {
  return (
    <Box flexDirection="column" height={height} width={columns} paddingX={2} paddingY={1}>
      <Text color="#58a6ff" bold>Add manual item</Text>
      <Text color="#8b949e">Source: Manual · starts unread</Text>
      <Text color={form.field === 'title' ? '#58a6ff' : '#8b949e'}>Title</Text>
      <Text>{cursorText(form.title, form.field === 'title' ? form.cursor : form.title.length)}</Text>
      <Text color={form.field === 'body' ? '#58a6ff' : '#8b949e'}>Body</Text>
      <Text wrap="truncate-end">{cursorText(form.body, form.field === 'body' ? form.cursor : form.body.length)}</Text>
      {form.error && <Text color="#f85149">{form.error}</Text>}
      <Text color="#8b949e">{form.saving ? 'Saving…' : '[Tab] title/body  [Ctrl+S] save  [Enter] new line in body  [Esc] cancel'}</Text>
    </Box>
  );
}
