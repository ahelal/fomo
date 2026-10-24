import React, { useCallback, useEffect, useState } from 'react';
import {
  TODO_SORTS,
  TODO_STATUS_COLOR,
  TODO_STATUS_ICON,
  TODO_STATUS_LABEL,
  buildTodoRows,
  dueLabel,
  dueTone,
  isDefaultSort,
  matchesTodoFilter,
  nextSort,
  nextTodoFilter,
  nextTodoStatus,
  rowFolder,
  sortLabel,
  todoCounts,
  todoFilterLabel,
  formatDate,
  type FomoService,
  type Todo,
  type TodoFilter,
  type TodoSort,
  type TodoStatus,
} from '@fomo/core';
import { ColorButton } from './ColorPicker.js';
import { DeleteButton, FolderDetails, FolderTreeList, Pill, Progress, RenameBar, TreeMessage, TreeSearch } from './FolderTree.js';
import { TodoDialog, type TodoDraft } from './TodoDialog.js';
import { TodoAttachments } from './TodoAttachments.js';
import { plural, useFolderTree, type PaneKeyHandler } from '../hooks/useFolderTree.js';
import { useWindowKeys } from '../hooks/useKeys.js';

interface Props {
  service: FomoService;
  /** Keyboard shortcuts are on (no overlay is open above the pane). */
  active: boolean;
}

interface DialogState {
  todo?: Todo;
  initial?: Partial<TodoDraft>;
}

const NOUN = ['todo', 'todos'] as const;

/** The Todos sort and filter survive closing the pane, but not a reload. */
let lastSort: TodoSort | undefined;
let lastFilter: TodoFilter = 'all';

/** ↵ on a todo: pending → in progress → done → pending; x: done, or reopened when done. */
const doneOrReopen = (todo: Todo): TodoStatus => (todo.status === 'done' ? 'pending' : 'done');

/** Todos filed into folders, like Bookmarks: browse, search, filter, add, edit, color, move folders and delete. */
export function TodosPane({ service, active }: Props) {
  const [dialog, setDialog] = useState<DialogState | undefined>();
  const [attachmentTodo, setAttachmentTodo] = useState<Todo | undefined>();
  const [sort, setSort] = useState<TodoSort | undefined>(lastSort);
  const [filter, setFilterState] = useState<TodoFilter>(lastFilter);
  const setFilter = (next: TodoFilter) => setFilterState((lastFilter = next));
  const buildRows = useCallback(
    (todos: Todo[], expanded: ReadonlySet<string>, search: string) => buildTodoRows(todos, expanded, { search, sort, filter }),
    [sort, filter],
  );
  const tree = useFolderTree<Todo>({
    noun: NOUN,
    itemKey: (todo) => `todo:${todo.id}`,
    itemName: (todo) => todo.subject,
    buildRows,
    fetch: async () => {
      const { todos, folderColors } = await service.listTodos();
      return { items: todos, folderColors };
    },
    moveFolder: (from, to) => service.moveTodoFolder(from, to),
    saveFolderColor: (folder, color) => service.setTodoFolderColor(folder, color),
    saveItemColor: (todo, color) => service.updateTodo(todo.id, { color }),
    remove: (todo) => service.deleteTodo(todo.id),
  });
  const { load, say, row, rows, search, items } = tree;

  useEffect(() => { void load(); }, [load, service]);

  const addTodo = (folder: string) => setDialog({ initial: { folder } });
  const editTodo = (todo: Todo) => setDialog({ todo });
  const showAttachments = (todo: Todo) => {
    if (todo.attachments?.length) setAttachmentTodo(todo);
    else say('No attachments — e to add URLs or file paths');
  };

  const cycleSort = () => {
    tree.keep(row?.key);
    const next = nextSort(TODO_SORTS, sort);
    setSort((lastSort = next));
    say(`Sort: ${next.label}`);
  };

  const cycleFilter = () => {
    tree.keep(row?.key);
    const next = nextTodoFilter(filter);
    setFilter(next);
    say(`Showing: ${todoFilterLabel(next)}`);
  };

  const setStatus = (todo: Todo, status: TodoStatus) => {
    const updated = { ...todo, status };
    tree.setItems((list) => list?.map((t) => (t.id === todo.id ? updated : t)));
    // It stays selected as it moves, unless the filter hides it now.
    if (matchesTodoFilter(updated, filter)) tree.keep(`todo:${todo.id}`);
    say(`${TODO_STATUS_ICON[status]} ${TODO_STATUS_LABEL[status]}: “${todo.subject}”`);
    service.updateTodo(todo.id, { status }).catch((err) => {
      tree.fail(err);
      void load();
    });
  };

  const onKey: PaneKeyHandler<Todo> = (k, r) => {
    if (k === 'a') { addTodo(rowFolder(r)); return true; }
    if (k === 's') { cycleSort(); return true; }
    if (k === 'v') { cycleFilter(); return true; }
    if (r?.kind !== 'item') return false;
    if (k === 'Enter') { setStatus(r.item, nextTodoStatus(r.item.status)); return true; }
    if (k === 'x') { setStatus(r.item, doneOrReopen(r.item)); return true; }
    if (k === 'e') { editTodo(r.item); return true; }
    if (k === 'o') { showAttachments(r.item); return true; }
    return false;
  };
  useWindowKeys(active && !dialog && !attachmentTodo, (e) => tree.handleKey(e, onKey));

  const onSaved = (saved: Todo, created: boolean) => {
    setDialog(undefined);
    if (!matchesTodoFilter(saved, filter)) setFilter('all');
    tree.reveal(saved);
    void load();
    say(`✓ ${created ? 'Added' : 'Updated'} in ${saved.folder || 'the top level'}`);
  };

  const counts = items && todoCounts(items);
  const matches = tree.searching ? rows.filter((r) => r.kind === 'item').length : undefined;
  const empty = !items
    ? 'Loading…'
    : tree.searching
      ? 'Nothing matches the search.'
      : items.length > 0
        ? `No ${todoFilterLabel(filter).toLowerCase()} todos — v shows the others.`
        : 'No todos yet. Press a to add one.';

  return (
    <div className="tree-pane">
      <div className="tree-header">
        <span className="tree-title">
          ✓ Todos{' '}
          <span className="tree-count">
            {counts ? (
              <>
                · {counts.open} open
                {counts.overdue > 0 && <> · <span className="todo-due--overdue">{counts.overdue} overdue</span></>}
                {' '}· {counts.done} done
              </>
            ) : '· loading…'}
          </span>
        </span>
        <TreeSearch inputRef={tree.searchRef} value={search} placeholder="/ search todos" matches={matches} onChange={tree.setSearch} />
        <Pill active={filter !== 'all'} title="Which todos are shown (v)" onClick={cycleFilter}>
          ◐ {todoFilterLabel(filter)}
        </Pill>
        <Pill active={!isDefaultSort(TODO_SORTS, sort)} title="Change the order of the todos (s)" onClick={cycleSort}>
          ↕ {sortLabel(TODO_SORTS, sort)}
        </Pill>
        <button type="button" className="tree-add" onClick={() => addTodo(rowFolder(row))}>+ Add todo</button>
      </div>

      <TreeMessage status={tree.status} />
      {tree.error && <p className="tree-error">⚠ {tree.error}</p>}

      {tree.rename && (
        <RenameBar
          rename={tree.rename}
          folders={tree.folders}
          onChange={tree.editRename}
          onSubmit={() => void tree.submitRename()}
          onCancel={tree.cancelRename}
        />
      )}

      <FolderTreeList<Todo>
        label="Todos"
        rows={rows}
        index={tree.index}
        empty={empty}
        progress
        folderColorOf={tree.folderColorOf}
        rowRef={tree.rowRef}
        onSelect={tree.select}
        onToggle={tree.setOpen}
        onActivate={editTodo}
        itemTitle={(todo) => todo.description || undefined}
        renderItem={(todo) => {
          const next = nextTodoStatus(todo.status);
          const color = tree.colorOf(todo);
          return (
            <>
              <span className="todo-row__bar" style={{ backgroundColor: color ?? 'transparent' }} aria-hidden="true" />
              <button
                type="button"
                tabIndex={-1}
                className="todo-row__status"
                style={{ color: TODO_STATUS_COLOR[todo.status] }}
                title={`${TODO_STATUS_LABEL[todo.status]} — click for ${TODO_STATUS_LABEL[next]}`}
                aria-label={`${TODO_STATUS_LABEL[todo.status]}: mark ${TODO_STATUS_LABEL[next].toLowerCase()}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setStatus(todo, next)}
              >
                {TODO_STATUS_ICON[todo.status]}
              </button>
              <span
                className={`todo-row__subject${todo.status === 'done' ? ' todo-row__subject--done' : ''}`}
                style={color && todo.status !== 'done' ? { color } : undefined}
              >
                {todo.subject}
              </span>
              {todo.dueDate && <span className={`todo-due todo-due--${dueTone(todo)}`}>{dueLabel(todo.dueDate)}</span>}
            </>
          );
        }}
      />

      {row && (
        <div className="tree-details">
          {row.kind === 'folder' ? (
            <FolderDetails
              path={row.path}
              color={tree.folderColorOf(row.path)}
              colorButton={tree.folderColorButton(row.path)}
              meta={(
                <Progress
                  done={row.done}
                  count={row.count}
                  label={`${row.done} of ${plural(row.count, NOUN)} done${tree.searching || filter !== 'all' ? ' (listed)' : ''}`}
                />
              )}
              onColor={() => tree.pickFolderColor(row.path)}
            >
              <button type="button" className="btn" onClick={() => addTodo(row.path)}>a · Add todo here</button>
              <button type="button" className="btn" onClick={() => tree.startRename(row.path)}>e · Rename / move</button>
            </FolderDetails>
          ) : (
            <TodoDetails
              todo={row.item}
              color={tree.colorOf(row.item)}
              actions={(
                <>
                  <button type="button" className="btn btn--primary" onClick={() => setStatus(row.item, nextTodoStatus(row.item.status))}>
                    ↵ · {row.item.status === 'done' ? 'Reopen' : TODO_STATUS_LABEL[nextTodoStatus(row.item.status)]}
                  </button>
                  {doneOrReopen(row.item) !== nextTodoStatus(row.item.status) && (
                    <button type="button" className="btn" onClick={() => setStatus(row.item, doneOrReopen(row.item))}>
                      x · {row.item.status === 'done' ? 'Reopen' : 'Done'}
                    </button>
                  )}
                  <button type="button" className="btn" onClick={() => editTodo(row.item)}>e · Edit</button>
                  {!!row.item.attachments?.length && (
                    <button type="button" className="btn" onClick={() => showAttachments(row.item)}>o · Attachments ({row.item.attachments.length})</button>
                  )}
                  <ColorButton
                    {...tree.itemColorButton(row.item.folder, row.item.color)}
                    title="c · Color the todo"
                    onClick={() => tree.pickItemColor(row.item)}
                  />
                  <DeleteButton armed={tree.confirmDelete === row.item.id} onClick={() => tree.askDelete(row.item)} />
                </>
              )}
            />
          )}
        </div>
      )}

      {dialog && (
        <TodoDialog
          service={service}
          todo={dialog.todo}
          initial={dialog.initial}
          folders={tree.folders}
          folderColors={tree.folderColors}
          onSaved={onSaved}
          onClose={() => setDialog(undefined)}
        />
      )}
      {tree.picker.element}
      {attachmentTodo && <TodoAttachments todo={attachmentTodo} onClose={() => setAttachmentTodo(undefined)} />}
    </div>
  );
}

/** The selected todo: subject, description, status, due date and folder, then what can be done with it. */
export function TodoDetails({ todo, color, actions }: { todo: Todo; color?: string; actions?: React.ReactNode }) {
  const statusColor = TODO_STATUS_COLOR[todo.status];
  return (
    <>
      <p className="tree-details__title" style={color ? { color } : undefined}>{todo.subject}</p>
      {todo.description
        ? <p className="tree-details__desc">{todo.description}</p>
        : <p className="tree-details__desc tree-details__desc--none">No notes — e to add them.</p>}
      <p className="tree-details__meta">
        <span className="todo-chip" style={{ color: statusColor, borderColor: statusColor }}>
          {TODO_STATUS_ICON[todo.status]} {TODO_STATUS_LABEL[todo.status]}
        </span>
        {' · '}
        {todo.dueDate
          ? <span className={`todo-due--${dueTone(todo)}`}>due {formatDate(todo.dueDate)} ({dueLabel(todo.dueDate)})</span>
          : 'no due date'}
        {' · '}
        {todo.folder ? `${todo.folder}/` : 'top level'}
      </p>
      {actions && <div className="tree-details__actions">{actions}</div>}
    </>
  );
}
