import React from 'react';
import { Box, Text } from 'ink';
import { colorName, normalizeHexColor, type FolderRow, type FolderTreeRow } from '@fomo/core';
import { COLOR_FIELD, FOLDER_FIELD, type FolderForm } from '../hooks/folderForm.js';
import type { FolderDeletePrompt, FolderRename } from '../hooks/useFolderTree.js';
import { textRows } from '../text.js';

export const ACCENT = '#58a6ff';
export const MUTED = '#8b949e';
export const TEXT = '#c9d1d9';
export const BRIGHT = '#f0f6fc';
export const DARK = '#0d1117';
export const ERROR = '#f85149';
export const DONE = '#3fb950';
export const HINT = '#d2a8ff';
/** Lines under the list with the selected row's details. */
export const DETAILS_H = 4;

export function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

export const Cursor = () => <Text backgroundColor={ACCENT} color={DARK}>▋</Text>;

/** `■ Blue #58a6ff`, or the fallback's name when there's no color of its own. */
export function ColorChip({ color, fallback, fallbackLabel = 'default' }: { color?: string; fallback?: string; fallbackLabel?: string }) {
  const own = normalizeHexColor(color);
  if (own) return <Text><Text color={own}>{'■■ '}</Text><Text color={TEXT}>{`${colorName(own)} `}</Text><Text color={MUTED}>{own}</Text></Text>;
  return (
    <Text color={MUTED}>
      {fallback ? <Text color={fallback}>{'□□ '}</Text> : null}
      {`(${fallbackLabel})`}
    </Text>
  );
}

/** Done of total as `▰▰▰▱▱`. */
export function progressBar(done: number, total: number, width = 5): [string, string] {
  const filled = total > 0 ? Math.round((done / total) * width) : 0;
  return ['▰'.repeat(filled), '▱'.repeat(width - filled)];
}

/** A folder row: `▾ name/` in the folder's color, then its count (or done/total and a bar). */
export function FolderLine({ row, selected, columns, color, progress }: {
  row: FolderRow;
  selected: boolean;
  columns: number;
  color: string;
  /** Show done/total with a progress bar instead of the count. */
  progress?: boolean;
}) {
  const indent = '  '.repeat(row.depth);
  const label = `${indent}${row.open ? '▾' : '▸'} ${row.name}/`;
  const fg = (c: string) => (selected ? DARK : c);
  if (progress) {
    const [filled, empty] = progressBar(row.done, row.progressCount);
    const tail = `  ${row.done}/${row.count} ${filled}${empty}`;
    return (
      <Box width={columns}>
        <Text backgroundColor={selected ? ACCENT : undefined} color={fg(color)} bold wrap="truncate-end">
          {' '}{truncate(label, columns - tail.length - 2)}
          <Text color={fg(MUTED)} bold={false}>{`  ${row.done}/${row.progressCount} `}</Text>
          <Text color={fg(DONE)} bold={false}>{filled}</Text>
          <Text color={fg('#30363d')} bold={false}>{empty}</Text>
        </Text>
      </Box>
    );
  }
  const count = ` ${row.count}`;
  return (
    <Box width={columns}>
      <Text backgroundColor={selected ? ACCENT : undefined} color={fg(color)} bold wrap="truncate-end">
        {' '}{truncate(label, columns - count.length - 2)}
        <Text color={fg(MUTED)} bold={false}>{count}</Text>
      </Text>
    </Box>
  );
}

/** The search prompt being typed, or the search in use. */
export function SearchLine({ search, searchDraft, matches, color }: { search: string; searchDraft?: string; matches: number; color: string }) {
  if (searchDraft !== undefined) {
    return (
      <Text wrap="truncate-start">
        <Text color={color} bold>{' / '}</Text>
        <Text color={BRIGHT}>{searchDraft}</Text>
        <Cursor />
        <Text color={MUTED}>{'   ↵ search · Esc cancel · ^U clear'}</Text>
      </Text>
    );
  }
  if (!search) return null;
  return (
    <Text wrap="truncate-end">
      <Text color={color} inverse>{` /${search} `}</Text>
      <Text color={MUTED}>{` ${matches} match(es) · Esc clears`}</Text>
    </Text>
  );
}

export function RenameLine({ rename, color }: { rename?: FolderRename; color: string }) {
  if (!rename) return null;
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-start">
        <Text color={color} bold>{` Move ${rename.from}/ to: `}</Text>
        <Text color={BRIGHT}>{rename.value}</Text>
        <Cursor />
        <Text color={MUTED}>{'   ↵ move · Esc cancel · ^U clear'}</Text>
      </Text>
      {rename.error && <Text color={ERROR}>{` ⚠ ${rename.error}`}</Text>}
    </Box>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** How to delete a folder: p lifts its contents into the parent, a deletes everything. */
export function DeleteFolderLine({ prompt, noun, color }: { prompt?: FolderDeletePrompt; noun: readonly [string, string]; color: string }) {
  if (!prompt) return null;
  const parent = prompt.path.includes('/') ? `${prompt.path.slice(0, prompt.path.lastIndexOf('/'))}/` : 'the top level';
  const inside = [plural(prompt.count, noun[0], noun[1]), ...(prompt.subfolders ? [plural(prompt.subfolders, 'subfolder', 'subfolders')] : [])].join(', ');
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={color} bold>{` Delete ${prompt.path}/ `}</Text>
        <Text color={MUTED}>{`(${inside})  `}</Text>
        {prompt.busy
          ? <Text color={MUTED}>{'deleting…'}</Text>
          : (
            <Text>
              <Text color={HINT} bold>p</Text><Text color={TEXT}>{` move contents to ${parent}  `}</Text>
              <Text color={ERROR} bold>a</Text><Text color={ERROR}>{' delete all  '}</Text>
              <Text color={MUTED}>{'Esc cancel'}</Text>
            </Text>
          )}
      </Text>
      {prompt.error && <Text color={ERROR}>{` ⚠ ${prompt.error}`}</Text>}
    </Box>
  );
}

/** Lines the search, rename and delete-folder prompts take. */
export function promptLines(view: { search: string; searchDraft?: string; rename?: FolderRename; folderDelete?: FolderDeletePrompt }): number {
  return (view.searchDraft !== undefined || view.search ? 1 : 0)
    + (view.rename ? (view.rename.error ? 2 : 1) : 0)
    + (view.folderDelete ? (view.folderDelete.error ? 2 : 1) : 0);
}

/** The visible slice of `rows`, keeping the selected one near the middle. */
export function visibleRows<T>(rows: readonly FolderTreeRow<T>[], selectedIndex: number, height: number) {
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(height / 2), rows.length - height));
  return { start, visible: rows.slice(start, start + height) };
}

export function DetailsBox({ columns, children }: { columns: number; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" width={columns} borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray">
      {children}
    </Box>
  );
}

export interface FormFieldSpec<F extends string> {
  field: F;
  label: string;
  /** Shown (muted) while the field is empty and not being typed in. */
  placeholder?: string;
  /** Shown after the value, e.g. how a typed due date was read; under a multiline field while it's focused. */
  hint?: React.ReactNode;
  /** A fixed-height, scrolling multiline input. */
  lines?: number;
}

const LABEL_W = 14;

function MultilineField({ value, cursor, active, placeholder, hint, width, height }: {
  value: string; cursor?: number; active: boolean; placeholder?: string; hint?: React.ReactNode; width: number; height: number;
}) {
  const rows = textRows(value, Math.max(1, width - 1));
  const position = Math.min(cursor ?? value.length, value.length);
  let selected = rows.findIndex((row, i) => position <= row.end && rows[i + 1]?.start !== position);
  if (selected < 0) selected = rows.length - 1;
  const start = active ? Math.max(0, Math.min(selected - height + 1, rows.length - height)) : 0;
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="column" height={height}>
        {rows.slice(start, start + height).map((row, i) => (
          <Text key={row.start} color={BRIGHT} wrap="truncate-end">
            {active && start + i === selected ? (
              <>
                <Text>{value.slice(row.start, position)}</Text>
                <Cursor />
                <Text>{value.slice(position, row.end)}</Text>
              </>
            ) : <Text>{row.text || ' '}</Text>}
            {!value && i === 0 && placeholder ? <Text color={MUTED}>{placeholder}</Text> : null}
          </Text>
        ))}
      </Box>
      <Text color={MUTED} wrap="truncate-end">
        {active && hint ? hint : (
          <>
            {active ? `line ${value.slice(0, position).split('\n').length}/${value.split('\n').length} · ↵ new line · ^S save` : `${value ? value.split('\n').length : 0} lines`}
            {rows.length > height ? ` · showing ${start + 1}–${Math.min(rows.length, start + height)}/${rows.length} rows` : ''}
          </>
        )}
      </Text>
    </Box>
  );
}

/** The add / edit form of a folder tree. */
export function FolderFormBox<F extends string>({ title, form, fields, folderMatches, folderColor, colorFallback, colorFallbackLabel, status, footer, columns }: {
  title: string;
  form: FolderForm<F>;
  fields: readonly FormFieldSpec<F>[];
  folderMatches: readonly string[];
  folderColor: string;
  /** The color shown while the color field is empty. */
  colorFallback?: string;
  colorFallbackLabel?: string;
  /** Extra lines between the fields and the footer (Copilot notes). */
  status?: React.ReactNode;
  footer: string;
  columns: number;
}) {
  const width = columns - 2;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#1c7cd6" paddingX={1} width={width}>
      <Text color={ACCENT} bold>{` ${title}`}</Text>
      {fields.map(({ field, label, placeholder, hint, lines }) => {
        const active = form.field === field;
        const value = form.values[field];
        const isColor = field === COLOR_FIELD;
        return (
          <React.Fragment key={field}>
            <Box>
              <Box width={LABEL_W} flexShrink={0}>
                <Text color={active ? BRIGHT : MUTED} bold={active}>{`${active ? '›' : ' '}${label}:`}</Text>
              </Box>
              <Box width={Math.max(10, width - 4 - LABEL_W)}>
                {lines ? (
                  <MultilineField value={value} cursor={form.cursor} active={active} placeholder={placeholder} hint={hint} width={Math.max(10, width - 4 - LABEL_W)} height={lines} />
                ) : isColor ? (
                  <Text wrap="truncate-end">
                    <ColorChip color={value} fallback={colorFallback} fallbackLabel={colorFallbackLabel} />
                    {active ? <Text color={MUTED}>{`   ↵ pick${value ? ' · ⌫ clear' : ''}`}</Text> : null}
                  </Text>
                ) : (
                  // Value lives in its own <Text>: Ink 5 skips re-measuring when a bare string is inserted before the cursor.
                  <Text color={BRIGHT} wrap="wrap">
                    <Text>{value}</Text>
                    {!value && placeholder && !active ? <Text color={MUTED}>{placeholder}</Text> : null}
                    {active ? <Cursor /> : null}
                    {hint ? <Text>{'  '}{hint}</Text> : null}
                  </Text>
                )}
              </Box>
            </Box>
            {field === FOLDER_FIELD && active && folderMatches.length > 0 && (
              <Box paddingLeft={LABEL_W}>
                <Text wrap="truncate-end">
                  <Text color={MUTED}>{'↑↓ '}</Text>
                  {folderMatches.map((f, i) => (
                    <React.Fragment key={f}>
                      {i > 0 && <Text color={MUTED}>{'  '}</Text>}
                      <Text color={i === form.pick ? DARK : folderColor} backgroundColor={i === form.pick ? folderColor : undefined}>
                        {` ${f} `}
                      </Text>
                    </React.Fragment>
                  ))}
                </Text>
              </Box>
            )}
          </React.Fragment>
        );
      })}
      {status}
      {form.error && <Text color={ERROR}>{` ⚠ ${form.error}`}</Text>}
      {form.saving && <Text color={MUTED}>{' Saving…'}</Text>}
      <Text color={MUTED} wrap="truncate-end">{` ${footer}`}</Text>
    </Box>
  );
}
