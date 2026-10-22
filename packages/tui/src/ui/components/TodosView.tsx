import React from 'react';
import { Box, Text } from 'ink';
import {
  attachmentTarget,
  dueHint,
  dueLabel,
  dueTone,
  folderColor,
  nextTodoStatus,
  normalizeFolder,
  todoFilterLabel,
  TODO_STATUS_COLOR,
  TODO_STATUS_ICON,
  TODO_STATUS_LABEL,
  type Todo,
  type TodoRow,
} from '@fomo/core';
import { TODO_FIELDS, TODO_FOLDER_COLOR, TODO_ITEM_COLOR, type PathSuggestions, type TodoField, type TodosViewState } from '../hooks/useTodos.js';
import { pathMatchName } from '../../pathComplete.js';
import {
  ACCENT,
  ColorChip,
  DARK,
  DETAILS_H,
  DetailsBox,
  ERROR,
  FolderFormBox,
  FolderLine,
  MUTED,
  RenameLine,
  SearchLine,
  TEXT,
  promptLines,
  truncate,
  visibleRows,
  type FormFieldSpec,
} from './FolderTree.js';

interface Props extends TodosViewState {
  height: number;
  columns: number;
}

const SOON = '#e3b341';

const FIELD_LABEL: Record<TodoField, string> = {
  subject: 'Subject',
  due: 'Due',
  folder: 'Folder',
  description: 'Notes',
  attachments: 'Attachments',
  color: 'Color',
};

const PLACEHOLDER: Partial<Record<TodoField, string>> = {
  due: '(none) — 2026-03-06, today, fri, +3, 2w',
  folder: '(top level)',
  description: '(optional)',
  attachments: 'One URL or file path per line (optional)',
};

/** How the due date being typed was read: `→ 2026-03-06 · in 3d`, or that it isn't a date. */
function DueHint({ text }: { text: string }) {
  const hint = dueHint(text);
  return hint ? <Text color={hint.error ? ERROR : MUTED}>{hint.text}</Text> : null;
}

const DUE_COLOR = { overdue: ERROR, soon: SOON, later: MUTED } as const;

function dueColor(todo: Todo): string {
  return DUE_COLOR[dueTone(todo)];
}

/** Under Attachments: the files and folders Tab completes the path being typed to. */
function PathHint({ suggestions }: { suggestions: PathSuggestions }) {
  const { matches, current } = suggestions;
  if (!matches.length) return <Text color={MUTED}>⇥ no matching file or folder</Text>;
  // Keep the entry Tab cycled to in view; the row is truncated at its end.
  const first = Math.max(0, current - 1);
  return (
    <Text>
      <Text color={MUTED}>{`⇥ ${matches.length > 1 ? `(${matches.length}) ` : ''}${first > 0 ? '… ' : ''}`}</Text>
      {matches.slice(first, first + 40).map((match, i) => {
        const selected = first + i === current;
        return (
          <React.Fragment key={match}>
            {i > 0 ? <Text>{'  '}</Text> : null}
            <Text color={selected ? DARK : /[\\/]$/.test(match) ? ACCENT : TEXT} backgroundColor={selected ? ACCENT : undefined}>
              {pathMatchName(match)}
            </Text>
          </React.Fragment>
        );
      })}
    </Text>
  );
}

function Form({ form, folderMatches, folderColors, pathSuggestions, columns, height }: Pick<Props, 'form' | 'folderMatches' | 'folderColors' | 'pathSuggestions' | 'columns' | 'height'>) {
  if (!form) return null;
  const inherited = folderColor(folderColors, normalizeFolder(form.values.folder));
  const fields: FormFieldSpec<TodoField>[] = TODO_FIELDS.map((field) => ({
    field,
    label: FIELD_LABEL[field],
    placeholder: PLACEHOLDER[field],
    hint: field === 'due' ? <DueHint text={form.values.due} />
      : field === 'attachments' && pathSuggestions ? <PathHint suggestions={pathSuggestions} />
      : undefined,
    lines: field === 'description' || field === 'attachments' ? Math.max(1, Math.min(5, Math.floor((height - 13) / 2))) : undefined,
  }));
  return (
    <FolderFormBox
      title={form.id ? 'Edit todo' : 'Add todo'}
      form={form}
      fields={fields}
      folderMatches={folderMatches}
      folderColor={TODO_FOLDER_COLOR}
      colorFallback={inherited ?? TODO_ITEM_COLOR}
      colorFallbackLabel={inherited ? 'folder color' : 'none'}
      footer="[Tab] field  [^S] save  [Esc] cancel  [^U] clear · Notes/Attachments: ↵ new line, arrows edit · Tab completes paths"
      columns={columns}
    />
  );
}

function Row({ row, selected, columns, colorOf, folderColorOf }: {
  row: TodoRow;
  selected: boolean;
  columns: number;
  colorOf(todo: Todo): string | undefined;
  folderColorOf(path: string): string;
}) {
  if (row.kind === 'folder') return <FolderLine row={row} selected={selected} columns={columns} color={folderColorOf(row.path)} progress />;
  const todo = row.item;
  const indent = '  '.repeat(row.depth);
  const color = colorOf(todo);
  const done = todo.status === 'done';
  const due = dueLabel(todo.dueDate);
  const dueText = due ? `  ${due} ` : ' ';
  const subjectW = Math.max(10, columns - indent.length - 4 - dueText.length);
  const fg = (c: string) => (selected ? DARK : c);
  return (
    <Box width={columns}>
      <Text backgroundColor={selected ? ACCENT : undefined} color={fg(TEXT)} wrap="truncate-end">
        {' '}{indent}
        <Text color={fg(color ?? TEXT)}>{color ? '▎' : ' '}</Text>
        <Text color={fg(TODO_STATUS_COLOR[todo.status])}>{TODO_STATUS_ICON[todo.status]}</Text>
        {' '}
        <Text color={fg(done ? MUTED : (color ?? TEXT))} strikethrough={done}>{truncate(todo.subject, subjectW)}</Text>
        {' '.repeat(Math.max(0, subjectW - Math.min(todo.subject.length, subjectW)))}
        <Text color={fg(dueColor(todo))}>{dueText}</Text>
      </Text>
    </Box>
  );
}

function Details({ row, columns, confirmDelete, folderColors, folderColorOf }: {
  row?: TodoRow;
  columns: number;
  confirmDelete?: string;
  folderColors: Props['folderColors'];
  folderColorOf(path: string): string;
}) {
  const lines: React.ReactNode[] = [];
  if (!row) lines.push(<Text key="none" color={MUTED}> </Text>);
  else if (row.kind === 'folder') {
    lines.push(
      <Text key="f" color={folderColorOf(row.path)} wrap="truncate-end">
        {` ${row.path}/`}
        <Text color={MUTED}>{` · ${row.done} of ${row.count} done`}</Text>
      </Text>,
      <Text key="h" color={MUTED} wrap="truncate-end">{' [↵/→/←] open · close  [e] rename or move  [c] color  [a] add a todo here'}</Text>,
    );
  } else {
    const todo = row.item;
    const notes = todo.description.split(/\r\n?|\n/);
    const due = todo.dueDate ? `due ${todo.dueDate} (${dueLabel(todo.dueDate)})` : 'no due date';
    const inherited = folderColor(folderColors, todo.folder);
    lines.push(
      <Text key="d" color={TEXT} wrap="truncate-end">
        {` ${notes[0] || '(no notes — e to add them)'}`}
        {notes.length > 1 ? <Text color={MUTED}>{` · ${notes.length} lines (e to read/edit)`}</Text> : null}
      </Text>,
      <Text key="s" color={MUTED} wrap="truncate-end">
        {' '}
        <Text color={TODO_STATUS_COLOR[todo.status]}>{`${TODO_STATUS_ICON[todo.status]} ${TODO_STATUS_LABEL[todo.status]}`}</Text>
        {' · '}
        <Text color={dueColor(todo)}>{due}</Text>
        {` · ${todo.folder || 'top level'} · `}
        <ColorChip color={todo.color} fallback={inherited} fallbackLabel={inherited ? 'folder color' : 'no color'} />
        {todo.attachments?.length ? ` · ${todo.attachments.length} attachment(s)` : ''}
      </Text>,
      <Text key="k" color={confirmDelete === todo.id ? ERROR : MUTED} wrap="truncate-end">
        {confirmDelete === todo.id
          ? ' d again to delete · any other key cancels'
          : ` [↵] → ${TODO_STATUS_LABEL[nextTodoStatus(todo.status)]}  [x] ${todo.status === 'done' ? 'reopen' : 'done'}  [e] edit  [o] attachments  [c] color  [d] delete`}
      </Text>,
    );
  }
  return <DetailsBox columns={columns}>{lines}</DetailsBox>;
}

export function TodosView(props: Props) {
  const { rows, total, selectedIndex, loading, search, searchDraft, form, attachmentPicker, rename, folderColors, filter, counts, height, columns } = props;
  const folderColorOf = (path: string) => folderColor(folderColors, path) ?? TODO_FOLDER_COLOR;
  const colorOf = (todo: Todo) => todo.color || folderColor(folderColors, todo.folder);

  const header = (
    <Box width={columns} borderStyle="single" borderBottom borderTop={false} borderLeft={false} borderRight={false} borderColor="gray">
      <Box flexShrink={0}>
        <Text color={ACCENT} bold>{' ✓ Todos'}</Text>
        <Text color={MUTED}>
          {` · ${counts.open} open`}
          {counts.overdue > 0 ? <Text color={ERROR}>{` · ${counts.overdue} overdue`}</Text> : null}
          {` · ${counts.done} done`}
          {filter !== 'all' ? <Text color={SOON}>{` · showing ${todoFilterLabel(filter)}`}</Text> : null}
          {loading ? ' · loading…' : ''}
        </Text>
      </Box>
      {!form && !attachmentPicker && <Text color={MUTED} wrap="truncate-end">{'   [a] add  [↵] status  [x] done  [e] edit  [o] attachments  [c] color  [v] show  [/] search  [s] sort'}</Text>}
    </Box>
  );

  if (form) {
    return (
      <Box flexDirection="column" width={columns} height={height}>
        {header}
        <Form form={form} folderMatches={props.folderMatches} folderColors={folderColors} pathSuggestions={props.pathSuggestions} columns={columns} height={height - 2} />
      </Box>
    );
  }

  if (attachmentPicker) {
    const targets = attachmentPicker.todo.attachments ?? [];
    const room = Math.max(1, height - 7);
    const start = Math.max(0, Math.min(attachmentPicker.index - Math.floor(room / 2), targets.length - room));
    return (
      <Box flexDirection="column" width={columns} height={height}>
        {header}
        <Text color={ACCENT} bold wrap="truncate-end">{` Attachments · ${attachmentPicker.todo.subject}`}</Text>
        <Text color={MUTED}>{' Files open on this computer; relative paths use the TUI working directory.'}</Text>
        <Box flexDirection="column" height={room}>
          {targets.slice(start, start + room).map((target, i) => {
            const selected = start + i === attachmentPicker.index;
            return (
              <Text key={`${start + i}:${target}`} color={selected ? DARK : TEXT} backgroundColor={selected ? ACCENT : undefined} wrap="truncate-end">
                {` ${selected ? '›' : ' '} ${attachmentTarget(target).kind === 'url' ? 'URL ' : 'FILE'}  ${target}`}
              </Text>
            );
          })}
        </Box>
        <Text color={MUTED} wrap="truncate-end">{` ${attachmentPicker.index + 1}/${targets.length}  [↑↓/j/k] select  [↵/o] open  [e] edit  [Esc] back`}</Text>
      </Box>
    );
  }

  const listH = Math.max(1, height - 2 - DETAILS_H - promptLines(props));
  const { start, visible } = visibleRows(rows, selectedIndex, listH);
  const empty = loading
    ? 'Loading…'
    : search
      ? 'Nothing matches the search.'
      : total > 0
        ? `No ${todoFilterLabel(filter).toLowerCase()} todos — v shows the others.`
        : 'No todos yet. Press a to add one.';

  return (
    <Box flexDirection="column" width={columns} height={height}>
      {header}
      <SearchLine search={search} searchDraft={searchDraft} matches={rows.filter((r) => r.kind === 'item').length} color={TODO_FOLDER_COLOR} />
      <RenameLine rename={rename} color={TODO_FOLDER_COLOR} />
      <Box flexDirection="column" height={listH}>
        {rows.length === 0 ? (
          <Box height={listH} alignItems="center" justifyContent="center">
            <Text color={MUTED}>{empty}</Text>
          </Box>
        ) : (
          visible.map((row, i) => (
            <Row key={row.key} row={row} selected={start + i === selectedIndex} columns={columns} colorOf={colorOf} folderColorOf={folderColorOf} />
          ))
        )}
      </Box>
      <Details row={rows[selectedIndex]} columns={columns} confirmDelete={props.confirmDelete} folderColors={folderColors} folderColorOf={folderColorOf} />
    </Box>
  );
}
