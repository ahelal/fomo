import React from 'react';
import { Box, Text } from 'ink';
import { folderColor, formatDate, normalizeFolder, type Reference, type ReferenceRow } from '@fomo/core';
import { REF_FIELDS, REF_FOLDER_COLOR, type RefField, type ReferencesViewState } from '../hooks/useReferences.js';
import {
  ACCENT,
  DARK,
  DETAILS_H,
  DetailsBox,
  ERROR,
  FolderFormBox,
  FolderLine,
  HINT,
  MUTED,
  RenameLine,
  SearchLine,
  TEXT,
  promptLines,
  truncate,
  visibleRows,
  type FormFieldSpec,
} from './FolderTree.js';

export { DETAILS_H };

interface Props extends ReferencesViewState {
  height: number;
  columns: number;
}

const FIELD_LABEL: Record<RefField, string> = {
  title: 'Title',
  url: 'URL',
  folder: 'Folder',
  description: 'Description',
  color: 'Color',
};
const FIELDS: FormFieldSpec<RefField>[] = REF_FIELDS.map((field) => ({
  field,
  label: FIELD_LABEL[field],
  placeholder: field === 'folder' ? '(top level)' : undefined,
}));

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function Form({ form, folderMatches, folderColors, canSuggest, columns }: Pick<Props, 'form' | 'folderMatches' | 'folderColors' | 'canSuggest' | 'columns'>) {
  if (!form) return null;
  const inherited = folderColor(folderColors, normalizeFolder(form.values.folder));
  const status = form.suggesting
    ? <Text color={HINT}>{' ✨ Copilot is suggesting a folder and description…'}</Text>
    : form.note ? <Text color={HINT}>{` ${form.note}`}</Text> : null;
  return (
    <FolderFormBox
      title={form.id ? 'Edit bookmark' : 'File in Bookmarks'}
      form={form}
      fields={FIELDS}
      folderMatches={folderMatches}
      folderColor={REF_FOLDER_COLOR}
      colorFallback={inherited}
      colorFallbackLabel={inherited ? 'folder color' : 'none'}
      status={status}
      footer={`[Tab/↑↓] field  [↵] save  [Esc] cancel  [^U] clear field${canSuggest ? '  [^G] ask Copilot' : ''}  · folders nest with /`}
      columns={columns}
    />
  );
}

function Row({ row, selected, columns, colorOf, folderColorOf }: {
  row: ReferenceRow;
  selected: boolean;
  columns: number;
  colorOf(ref: Reference): string | undefined;
  folderColorOf(path: string): string;
}) {
  if (row.kind === 'folder') return <FolderLine row={row} selected={selected} columns={columns} color={folderColorOf(row.path)} />;
  const indent = '  '.repeat(row.depth);
  const ref = row.item;
  const color = colorOf(ref);
  const site = host(ref.url);
  const siteText = site ? `  ${site}` : '';
  const titleW = Math.max(10, columns - 2 - indent.length - 2 - siteText.length);
  const fg = (c: string) => (selected ? DARK : c);
  return (
    <Box width={columns}>
      <Text backgroundColor={selected ? ACCENT : undefined} color={fg(TEXT)} wrap="truncate-end">
        {' '}{indent}
        <Text color={fg(color ?? TEXT)}>{color ? '● ' : '• '}</Text>
        <Text color={fg(color ?? TEXT)}>{truncate(ref.title, titleW)}</Text>
        <Text color={fg(MUTED)}>{siteText}</Text>
      </Text>
    </Box>
  );
}

function Details({ row, columns, confirmDelete, folderColorOf }: { row?: ReferenceRow; columns: number; confirmDelete?: string; folderColorOf(path: string): string }) {
  const lines: React.ReactNode[] = [];
  if (!row) lines.push(<Text key="none" color={MUTED}> </Text>);
  else if (row.kind === 'folder') {
    lines.push(
      <Text key="f" color={folderColorOf(row.path)} wrap="truncate-end">{` ${row.path}/`}<Text color={MUTED}>{` · ${row.count} link${row.count === 1 ? '' : 's'}`}</Text></Text>,
      <Text key="h" color={MUTED} wrap="truncate-end">{' [↵/→/←] open · close  [e] rename or move  [c] color  [a] add a link here'}</Text>,
    );
  } else {
    const ref = row.item;
    lines.push(
      <Text key="d" color={TEXT} wrap="truncate-end">{` ${ref.description || '(no description — e to add one)'}`}</Text>,
      <Text key="u" color={ACCENT} wrap="truncate-end">{` ${ref.url}`}</Text>,
      <Text key="m" color={confirmDelete === ref.id ? ERROR : MUTED} wrap="truncate-end">
        {confirmDelete === ref.id
          ? ' d again to delete · any other key cancels'
          : ` ${ref.folder || 'top level'} · added ${formatDate(ref.createdAt)}  [↵/o] open  [y] copy link  [e] edit  [c] color  [d] delete`}
      </Text>,
    );
  }
  return <DetailsBox columns={columns}>{lines}</DetailsBox>;
}

export function ReferencesView(props: Props) {
  const { rows, total, selectedIndex, loading, search, searchDraft, form, rename, folderColors, height, columns } = props;
  const folderColorOf = (path: string) => folderColor(folderColors, path) ?? REF_FOLDER_COLOR;
  const colorOf = (ref: Reference) => ref.color || folderColor(folderColors, ref.folder);

  const header = (
    <Box width={columns} borderStyle="single" borderBottom borderTop={false} borderLeft={false} borderRight={false} borderColor="gray">
      <Box flexShrink={0}>
        <Text color={ACCENT} bold>{' 🔖 Bookmarks'}</Text>
        <Text color={MUTED}>{` · ${total} link${total === 1 ? '' : 's'}${loading ? ' · loading…' : ''}`}</Text>
      </Box>
      {!form && <Text color={MUTED} wrap="truncate-end">{'   [a] add  [e] edit  [d] delete  [c] color  [o] open  [/] search  [s] sort'}</Text>}
    </Box>
  );

  if (form) {
    return (
      <Box flexDirection="column" width={columns} height={height}>
        {header}
        <Form form={form} folderMatches={props.folderMatches} folderColors={folderColors} canSuggest={props.canSuggest} columns={columns} />
      </Box>
    );
  }

  const listH = Math.max(1, height - 2 - DETAILS_H - promptLines(props));
  const { start, visible } = visibleRows(rows, selectedIndex, listH);

  return (
    <Box flexDirection="column" width={columns} height={height}>
      {header}
      <SearchLine search={search} searchDraft={searchDraft} matches={rows.filter((r) => r.kind === 'item').length} color={REF_FOLDER_COLOR} />
      <RenameLine rename={rename} color={REF_FOLDER_COLOR} />
      <Box flexDirection="column" height={listH}>
        {rows.length === 0 ? (
          <Box height={listH} alignItems="center" justifyContent="center">
            <Text color={MUTED}>
              {loading ? 'Loading…' : search ? 'Nothing matches the search.' : 'No bookmarks yet. Press B on any update to file it, or a to add a link.'}
            </Text>
          </Box>
        ) : (
          visible.map((row, i) => (
            <Row key={row.key} row={row} selected={start + i === selectedIndex} columns={columns} colorOf={colorOf} folderColorOf={folderColorOf} />
          ))
        )}
      </Box>
      <Details row={rows[selectedIndex]} columns={columns} confirmDelete={props.confirmDelete} folderColorOf={folderColorOf} />
    </Box>
  );
}
