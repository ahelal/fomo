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
  nextTodoKindFilter,
  nextSort,
  nextTodoFilter,
  nextTodoStatus,
  rowFolder,
  sortLabel,
  todoCounts,
  todoFilterLabel,
  todoKind,
  todoKindFilterLabel,
  todoKindTitle,
  TODO_KIND_TITLE_LIST,
  formatDate,
  type FomoService,
  type FolderMetadataMap,
  type Todo,
  type TodoFilter,
  type TodoKindFilter,
  type TodoSort,
  type TodoStatus,
} from '@fomo/core';
import { ColorButton } from './ColorPicker.js';
import { DeleteButton, FolderDetails, FolderTreeList, Pill, Progress, RenameBar, TreeMessage, TreeSearch } from './FolderTree.js';
import { TodoDialog, type TodoDraft } from './TodoDialog.js';
import { DeleteFolderDialog, FolderDialog, FolderMetadataEditor } from './FolderDialog.js';
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
let lastKindFilter: TodoKindFilter = 'all';

/** Space on a todo: pending → in progress → done → pending; x: done, or reopened when done. */
const doneOrReopen = (todo: Todo): TodoStatus => (todo.status === 'done' ? 'pending' : 'done');

/** Todos filed into folders, like Bookmarks: browse, search, filter, add, edit, color, move folders and delete. */
export function TodosPane({ service, active }: Props) {
  const [dialog, setDialog] = useState<DialogState | undefined>();
  const [attachmentTodo, setAttachmentTodo] = useState<Todo | undefined>();
  const [folderDialog, setFolderDialog] = useState<string | undefined>();
  const [sort, setSort] = useState<TodoSort | undefined>(lastSort);
  const [filter, setFilterState] = useState<TodoFilter>(lastFilter);
  const [kindFilter, setKindFilterState] = useState<TodoKindFilter>(lastKindFilter);
  const setFilter = (next: TodoFilter) => setFilterState((lastFilter = next));
  const setKindFilter = (next: TodoKindFilter) => setKindFilterState((lastKindFilter = next));
  const buildRows = useCallback(
    (todos: Todo[], expanded: ReadonlySet<string>, search: string, folderMetadata?: FolderMetadataMap) =>
      buildTodoRows(todos, expanded, { search, sort, filter, kindFilter, folderMetadata }),
    [sort, filter, kindFilter],
  );
  const tree = useFolderTree<Todo>({
    noun: NOUN,
    itemKey: (todo) => `todo:${todo.id}`,
    itemName: (todo) => todo.subject,
    buildRows,
    fetch: async () => {
      const { todos, folderColors, folderMetadata } = await service.listTodos();
      return { items: todos, folderColors, folderMetadata };
    },
    moveFolder: (from, to) => service.moveTodoFolder(from, to),
    deleteFolder: (folder, mode) => service.deleteTodoFolder(folder, mode),
    saveFolderColor: (folder, color) => service.setTodoFolderColor(folder, color),
    saveFolderMetadata: (folder, metadata) => service.setTodoFolderMetadata(folder, metadata),
    saveItemColor: (todo, color) => service.updateTodo(todo.id, { color }),
    remove: (todo) => service.deleteTodo(todo.id),
  });
  const { load, say, row, rows, search, items } = tree;

  useEffect(() => { void load(); }, [load, service]);

  const addTodo = (folder: string) => setDialog({ initial: { folder } });
  const addIdea = (folder: string) => setDialog({ initial: { folder, kind: 'idea' } });
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

  const cycleKindFilter = () => {
    tree.keep(row?.key);
    const next = nextTodoKindFilter(kindFilter);
    setKindFilter(next);
    say(`Showing: ${todoKindFilterLabel(next)}`);
  };

  const setStatus = (todo: Todo, status: TodoStatus) => {
    if (todoKind(todo) === 'idea') return;
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

  const convertToTodo = async (idea: Todo) => {
    try {
      const todo = await service.updateTodo(idea.id, { kind: 'todo' });
      tree.setItems((list) => list?.map((item) => item.id === todo.id ? todo : item));
      tree.keep(`todo:${todo.id}`);
      say(`✓ Converted “${todo.subject}” to a todo`);
    } catch (err) {
      tree.fail(err);
      void load();
    }
  };

  const onKey: PaneKeyHandler<Todo> = (k, r) => {
    if (k === 'a') { addTodo(rowFolder(r)); return true; }
    if (k === 's') { cycleSort(); return true; }
    if (k === 'v') { cycleFilter(); return true; }
    if (k === '6') { cycleKindFilter(); return true; }
    if (r?.kind === 'folder' && (k === 'Enter' || k === 'e' || k === 'm')) { setFolderDialog(r.path); return true; }
    if (r?.kind !== 'item') return false;
    if (k === ' ' && todoKind(r.item) === 'todo') { setStatus(r.item, nextTodoStatus(r.item.status)); return true; }
    if (k === 'x' && todoKind(r.item) === 'todo') { setStatus(r.item, doneOrReopen(r.item)); return true; }
    if (k === 'e' || k === 'Enter') { editTodo(r.item); return true; }
    if (k === 'o') { showAttachments(r.item); return true; }
    return false;
  };
  useWindowKeys(active && !dialog && !folderDialog && !attachmentTodo, (e) => tree.handleKey(e, onKey));

  const onFolderSaved = (path: string, moved: number | undefined) => {
    setFolderDialog(undefined);
    tree.revealFolder(path);
    void load();
    say(moved === undefined ? `✓ Saved ${path}/` : `✓ Moved ${plural(moved, NOUN)} to ${path || 'the top level'}`);
  };

  const onSaved = (saved: Todo, created: boolean) => {
    setDialog(undefined);
    if (!matchesTodoFilter(saved, filter) || (kindFilter !== 'all' && todoKind(saved) !== (kindFilter === 'ideas' ? 'idea' : 'todo'))) {
      setFilter('all');
      setKindFilter('all');
    }
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
        ? `No ${todoKindFilterLabel(kindFilter).toLowerCase()} matching ${todoFilterLabel(filter).toLowerCase()} — 6 or v changes filters.`
        : 'No todos yet. Press a to add one.';

  return (
    <div className="tree-pane">
      <div className="tree-header">
        <span className="tree-title">
          ✓{' '}
          <span className="tree-title-slot">
            {TODO_KIND_TITLE_LIST.map((title) => (
              <span key={title} aria-hidden={title !== todoKindTitle(kindFilter)} className={title === todoKindTitle(kindFilter) ? undefined : 'tree-title-slot__hidden'}>{title}</span>
            ))}
          </span>{' '}
          <span className="tree-count">
            {counts ? (
              <>
                · {counts.open} open
                {counts.overdue > 0 && <> · <span className="todo-due--overdue">{counts.overdue} overdue</span></>}
                {' '}· {counts.done} done
                {counts.ideas > 0 && <> · {counts.ideas} ideas</>}
              </>
            ) : '· loading…'}
          </span>
        </span>
        <TreeSearch inputRef={tree.searchRef} value={search} placeholder="/ search todos and ideas" matches={matches} onChange={tree.setSearch} />
        <Pill active={filter !== 'all'} title="Which todos are shown (v)" onClick={cycleFilter}>
          ◐ {todoFilterLabel(filter)}
        </Pill>
        <Pill active={kindFilter !== 'all'} title="Show todos, ideas, or both (6)" onClick={cycleKindFilter}>
          ✧ {todoKindFilterLabel(kindFilter)}
        </Pill>
        <Pill active={!isDefaultSort(TODO_SORTS, sort)} title="Change the order of the todos (s)" onClick={cycleSort}>
          ↕ {sortLabel(TODO_SORTS, sort)}
        </Pill>
        <button type="button" className="tree-add" onClick={() => addTodo(rowFolder(row))}>+ Add todo</button>
        <button type="button" className="tree-add" onClick={() => addIdea(rowFolder(row))}>+ Add idea</button>
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
        label="Todos and ideas"
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
          const idea = todoKind(todo) === 'idea';
          const next = nextTodoStatus(todo.status);
          const color = tree.colorOf(todo);
          return (
            <>
              <span className="todo-row__bar" style={{ backgroundColor: color ?? 'transparent' }} aria-hidden="true" />
              {idea ? <span className="todo-row__kind" aria-label="Idea">✧ Idea</span> : <button
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
              </button>}
              <span
                className={`todo-row__subject${!idea && todo.status === 'done' ? ' todo-row__subject--done' : ''}${idea ? ' todo-row__subject--idea' : ''}`}
                style={color && (idea || todo.status !== 'done') ? { color } : undefined}
              >
                {todo.subject}
              </span>
              {!idea && todo.dueDate && <span className={`todo-due todo-due--${dueTone(todo)}`}>{dueLabel(todo.dueDate)}</span>}
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
                  count={row.progressCount}
                  label={`${row.done} of ${plural(row.progressCount, NOUN)} done${tree.searching || filter !== 'all' ? ' (listed)' : ''}`}
                />
              )}
              onColor={() => tree.pickFolderColor(row.path)}
            >
              <button type="button" className="btn" onClick={() => addTodo(row.path)}>a · Add todo here</button>
              <button type="button" className="btn" onClick={() => addIdea(row.path)}>Add idea here</button>
              <button type="button" className="btn" onClick={() => setFolderDialog(row.path)}>↵ · Edit folder</button>
              <button type="button" className="btn" onClick={() => tree.startFolderDelete(row.path)}>d · Delete folder</button>
              <FolderMetadataEditor
                key={row.path}
                path={row.path}
                metadata={tree.folderMetadata[row.path]}
                onSave={(metadata) => tree.saveFolderMetadata(row.path, metadata)}
              />
            </FolderDetails>
          ) : (
            <TodoDetails
              todo={row.item}
              color={tree.colorOf(row.item)}
              actions={(
                <>
                  {todoKind(row.item) === 'idea' ? (
                    <button type="button" className="btn btn--primary" onClick={() => void convertToTodo(row.item)}>Convert to todo</button>
                  ) : (
                    <>
                      <button type="button" className="btn btn--primary" onClick={() => setStatus(row.item, nextTodoStatus(row.item.status))}>
                        Space · {row.item.status === 'done' ? 'Reopen' : TODO_STATUS_LABEL[nextTodoStatus(row.item.status)]}
                      </button>
                      {doneOrReopen(row.item) !== nextTodoStatus(row.item.status) && (
                        <button type="button" className="btn" onClick={() => setStatus(row.item, doneOrReopen(row.item))}>
                          x · {row.item.status === 'done' ? 'Reopen' : 'Done'}
                        </button>
                      )}
                    </>
                  )}
                  <button type="button" className="btn" onClick={() => editTodo(row.item)}>e · Edit</button>
                  {!!row.item.attachments?.length && (
                    <button type="button" className="btn" onClick={() => showAttachments(row.item)}>o · Attachments ({row.item.attachments.length})</button>
                  )}
                  <ColorButton
                    {...tree.itemColorButton(row.item.folder, row.item.color)}
                    title={`c · Color the ${todoKind(row.item)}`}
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
      {folderDialog !== undefined && (
        <FolderDialog
          moveFolder={(from, to) => service.moveTodoFolder(from, to)}
          saveMetadata={(path, metadata) => service.setTodoFolderMetadata(path, metadata)}
          saveColor={(path, color) => service.setTodoFolderColor(path, color)}
          path={folderDialog}
          metadata={tree.folderMetadata[folderDialog]}
          folders={tree.folders}
          folderColors={tree.folderColors}
          onSaved={onFolderSaved}
          onMoved={(path) => { tree.revealFolder(path); void load(); }}
          onClose={() => setFolderDialog(undefined)}
        />
      )}
      {tree.picker.element}
      {tree.folderDelete && (
        <DeleteFolderDialog
          prompt={tree.folderDelete}
          noun={NOUN}
          onDelete={(mode) => void tree.submitFolderDelete(mode)}
          onClose={tree.cancelFolderDelete}
        />
      )}
      {attachmentTodo && <TodoAttachments todo={attachmentTodo} onClose={() => setAttachmentTodo(undefined)} />}
    </div>
  );
}

/** The selected todo or idea: subject, notes, workflow, due date and folder. */
export function TodoDetails({ todo, color, actions }: { todo: Todo; color?: string; actions?: React.ReactNode }) {
  const idea = todoKind(todo) === 'idea';
  const statusColor = TODO_STATUS_COLOR[todo.status];
  return (
    <>
      <p className="tree-details__title" style={color ? { color } : undefined}>{todo.subject}</p>
      {todo.description
        ? <p className="tree-details__desc">{todo.description}</p>
        : <p className="tree-details__desc tree-details__desc--none">No notes — e to add them.</p>}
      <p className="tree-details__meta">
        {idea ? <span className="todo-chip todo-chip--idea">✧ Idea</span> : (
          <>
            <span className="todo-chip" style={{ color: statusColor, borderColor: statusColor }}>
              {TODO_STATUS_ICON[todo.status]} {TODO_STATUS_LABEL[todo.status]}
            </span>
            {' · '}
            {todo.dueDate
              ? <span className={`todo-due--${dueTone(todo)}`}>due {formatDate(todo.dueDate)} ({dueLabel(todo.dueDate)})</span>
              : 'no due date'}
          </>
        )}
        {' · '}
        {todo.folder ? `${todo.folder}/` : 'top level'}
      </p>
      {actions && <div className="tree-details__actions">{actions}</div>}
    </>
  );
}
