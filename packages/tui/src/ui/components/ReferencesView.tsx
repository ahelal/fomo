import React from 'react';
import { Box, Text } from 'ink';
import type { ReferenceRow } from '@fomo/core';
import { REF_FIELDS, type RefField, type ReferencesViewState } from '../hooks/useReferences.js';

interface Props extends ReferencesViewState {
  height: number;
  columns: number;
}

const ACCENT = '#58a6ff';
const MUTED = '#8b949e';
const TEXT = '#c9d1d9';
const FOLDER = '#e3b341';

const FIELD_LABEL: Record<RefField, string> = {
  title: 'Title',
  url: 'URL',
  folder: 'Folder',
  description: 'Description',
};
const LABEL_W = 13;

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

const Cursor = () => <Text backgroundColor={ACCENT} color="#0d1117">▋</Text>;

function Form({ form, folderMatches, canSuggest, columns }: Pick<Props, 'form' | 'folderMatches' | 'canSuggest' | 'columns'>) {
  if (!form) return null;
  const width = columns - 2;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#1c7cd6" paddingX={1} width={width}>
      <Text color={ACCENT} bold>{form.id ? ' Edit bookmark' : ' File in Bookmarks'}</Text>
      {REF_FIELDS.map((field) => {
        const active = form.field === field;
        return (
          <React.Fragment key={field}>
            <Box>
              <Box width={LABEL_W} flexShrink={0}>
                <Text color={active ? '#f0f6fc' : MUTED} bold={active}>{`${FIELD_LABEL[field]}:`}</Text>
              </Box>
              <Box width={Math.max(10, width - 4 - LABEL_W)}>
                {/* Value lives in its own <Text>: Ink 5 skips re-measuring when a bare string is inserted before the cursor. */}
                <Text color="#f0f6fc" wrap="wrap">
                  <Text>{form.values[field]}</Text>
                  {!form.values[field] && field === 'folder' && !active ? <Text color={MUTED}>(top level)</Text> : null}
                  {active ? <Cursor /> : null}
                </Text>
              </Box>
            </Box>
            {field === 'folder' && active && folderMatches.length > 0 && (
              <Box paddingLeft={LABEL_W}>
                <Text wrap="truncate-end">
                  <Text color={MUTED}>{'↑↓ '}</Text>
                  {folderMatches.map((f, i) => (
                    <React.Fragment key={f}>
                      {i > 0 && <Text color={MUTED}>{'  '}</Text>}
                      <Text color={i === form.pick ? '#0d1117' : FOLDER} backgroundColor={i === form.pick ? FOLDER : undefined}>
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
      {form.suggesting && <Text color="#d2a8ff">{' ✨ Copilot is suggesting a folder and description…'}</Text>}
      {!form.suggesting && form.note && <Text color="#d2a8ff">{` ${form.note}`}</Text>}
      {form.error && <Text color="#f85149">{` ⚠ ${form.error}`}</Text>}
      {form.saving && <Text color={MUTED}>{' Saving…'}</Text>}
      <Text color={MUTED} wrap="truncate-end">
        {` [Tab/↑↓] field  [↵] save  [Esc] cancel  [^U] clear field${canSuggest ? '  [^G] ask Copilot' : ''}  · folders nest with /`}
      </Text>
    </Box>
  );
}

function Row({ row, selected, columns }: { row: ReferenceRow; selected: boolean; columns: number }) {
  const bg = selected ? ACCENT : undefined;
  const indent = '  '.repeat(row.depth);
  if (row.kind === 'folder') {
    const label = `${indent}${row.open ? '▾' : '▸'} ${row.name}/`;
    const count = ` ${row.count}`;
    return (
      <Box width={columns}>
        <Text backgroundColor={bg} color={selected ? '#0d1117' : FOLDER} bold wrap="truncate-end">
          {' '}{truncate(label, columns - count.length - 2)}
          <Text color={selected ? '#0d1117' : MUTED} bold={false}>{count}</Text>
        </Text>
      </Box>
    );
  }
  const site = host(row.ref.url);
  const siteText = site ? `  ${site}` : '';
  const titleW = Math.max(10, columns - 2 - indent.length - 2 - siteText.length);
  return (
    <Box width={columns}>
      <Text backgroundColor={bg} color={selected ? '#0d1117' : TEXT} wrap="truncate-end">
        {' '}{indent}{'• '}{truncate(row.ref.title, titleW)}
        <Text color={selected ? '#0d1117' : MUTED}>{siteText}</Text>
      </Text>
    </Box>
  );
}

function Details({ row, columns, confirmDelete }: { row?: ReferenceRow; columns: number; confirmDelete?: string }) {
  const lines: React.ReactNode[] = [];
  if (!row) lines.push(<Text key="none" color={MUTED}> </Text>);
  else if (row.kind === 'folder') {
    lines.push(
      <Text key="f" color={FOLDER} wrap="truncate-end">{` ${row.path}/`}<Text color={MUTED}>{` · ${row.count} link${row.count === 1 ? '' : 's'}`}</Text></Text>,
      <Text key="h" color={MUTED} wrap="truncate-end">{' [↵/→/←] open · close  [e] rename or move  [a] add a link here'}</Text>,
    );
  } else {
    const { ref } = row;
    lines.push(
      <Text key="d" color={TEXT} wrap="truncate-end">{` ${ref.description || '(no description — e to add one)'}`}</Text>,
      <Text key="u" color={ACCENT} wrap="truncate-end">{` ${ref.url}`}</Text>,
      <Text key="m" color={confirmDelete === ref.id ? '#f85149' : MUTED} wrap="truncate-end">
        {confirmDelete === ref.id
          ? ' d again to delete · any other key cancels'
          : ` ${ref.folder || 'top level'} · added ${ref.createdAt.slice(0, 10)}  [↵/o] open  [y] copy link  [e] edit  [d] delete`}
      </Text>,
    );
  }
  return (
    <Box flexDirection="column" width={columns} borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray">
      {lines}
    </Box>
  );
}

export const DETAILS_H = 4;

export function ReferencesView(props: Props) {
  const { rows, total, selectedIndex, loading, search, searchDraft, form, rename, message, height, columns } = props;

  const header = (
    <Box width={columns} borderStyle="single" borderBottom borderTop={false} borderLeft={false} borderRight={false} borderColor="gray">
      <Text color={ACCENT} bold> 🔖 Bookmarks </Text>
      <Text color={MUTED}>{` · ${total} link${total === 1 ? '' : 's'}${loading ? ' · loading…' : ''} `}</Text>
      {!form && <Text color={MUTED} wrap="truncate-end">{' [a] add  [e] edit  [d] delete  [o] open  [/] search  [s] sort  [5] close'}</Text>}
    </Box>
  );

  if (form) {
    return (
      <Box flexDirection="column" width={columns} height={height}>
        {header}
        <Form form={form} folderMatches={props.folderMatches} canSuggest={props.canSuggest} columns={columns} />
      </Box>
    );
  }

  const searchLine = searchDraft !== undefined ? (
    <Text wrap="truncate-start">
      <Text color={FOLDER} bold>{' / '}</Text>
      <Text color="#f0f6fc">{searchDraft}</Text>
      <Cursor />
      <Text color={MUTED}>{'   ↵ search · Esc cancel · ^U clear'}</Text>
    </Text>
  ) : search ? (
    <Text wrap="truncate-end">
      <Text color={FOLDER} inverse>{` /${search} `}</Text>
      <Text color={MUTED}>{` ${rows.filter((r) => r.kind === 'ref').length} match(es) · Esc clears`}</Text>
    </Text>
  ) : null;
  const renameLine = rename ? (
    <Box flexDirection="column">
      <Text wrap="truncate-start">
        <Text color={FOLDER} bold>{` Move ${rename.from}/ to: `}</Text>
        <Text color="#f0f6fc">{rename.value}</Text>
        <Cursor />
        <Text color={MUTED}>{'   ↵ move · Esc cancel · ^U clear'}</Text>
      </Text>
      {rename.error && <Text color="#f85149">{` ⚠ ${rename.error}`}</Text>}
    </Box>
  ) : null;

  const extra = (searchLine ? 1 : 0) + (rename ? (rename.error ? 2 : 1) : 0) + (message ? 1 : 0);
  const listH = Math.max(1, height - 2 - DETAILS_H - extra);
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(listH / 2), rows.length - listH));
  const visible = rows.slice(start, start + listH);

  return (
    <Box flexDirection="column" width={columns} height={height}>
      {header}
      {searchLine}
      {renameLine}
      {message && <Text color={FOLDER}>{` ${message}`}</Text>}
      <Box flexDirection="column" height={listH}>
        {rows.length === 0 ? (
          <Box height={listH} alignItems="center" justifyContent="center">
            <Text color={MUTED}>
              {loading ? 'Loading…' : search ? 'Nothing matches the search.' : 'No bookmarks yet. Press B on any update to file it, or a to add a link.'}
            </Text>
          </Box>
        ) : (
          visible.map((row, i) => <Row key={row.key} row={row} selected={start + i === selectedIndex} columns={columns} />)
        )}
      </Box>
      <Details row={rows[selectedIndex]} columns={columns} confirmDelete={props.confirmDelete} />
    </Box>
  );
}
