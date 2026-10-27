import React from 'react';
import { Text } from 'ink';
import { folderColorFallback, type FolderColorMap } from '@fomo/core';
import type { FolderEditForm } from '../hooks/useFolderEditor.js';
import { ACCENT, BRIGHT, ColorChip, Cursor, DetailsBox, ERROR, MUTED } from './FolderTree.js';

export function FolderEditorForm({ form, columns, folderColors }: { form: FolderEditForm; columns: number; folderColors: FolderColorMap }) {
  const fields = [
    ['name', 'Folder'],
    ['localPath', 'Local directory'],
    ['githubRepo', 'GitHub repository'],
  ] as const;
  return (
    <DetailsBox columns={columns}>
      <Text color={ACCENT} bold wrap="truncate-end">{` Edit folder · ${form.path}/`}</Text>
      {fields.map(([field, label]) => (
        <Text key={field} color={form.field === field ? BRIGHT : MUTED} wrap="truncate-end">
          {`${form.field === field ? '›' : ' '} ${label}: `}
          <Text color={BRIGHT}>{form.values[field]}</Text>
          {form.field === field ? <Cursor /> : null}
        </Text>
      ))}
      <Text color={form.field === 'color' ? BRIGHT : MUTED}>
        {`${form.field === 'color' ? '›' : ' '} Color: `}
        <ColorChip color={form.values.color} {...folderColorFallback(form.values.name, folderColors)} />
        {form.field === 'color' ? '  [↵/space] pick  [⌫] reset' : ''}
      </Text>
      {form.error ? <Text color={ERROR} wrap="truncate-end">{` ⚠ ${form.error}`}</Text> : null}
      <Text color={MUTED} wrap="truncate-end">
        {form.saving ? ' Saving…' : ' [Tab/↑↓] field  [↵/^S] save  [Esc] cancel · renaming moves subfolders too; directory and repo are metadata only'}
      </Text>
    </DetailsBox>
  );
}
