import { useCallback, useMemo, useState } from 'react';
import type { Key } from 'ink';
import {
  buildTodoRows,
  DEFAULT_FOLDER_COLOR,
  DEFAULT_ITEM_COLOR,
  dueDateError,
  folderMatches,
  isDefaultSort,
  itemColorRequest,
  matchesTodoFilter,
  nextSort,
  nextTodoFilter,
  nextTodoStatus,
  normalizeFolder,
  parseDueDate,
  rowFolder,
  sortLabel,
  TODO_SORTS,
  TODO_STATUS_ICON,
  TODO_STATUS_LABEL,
  todoCounts,
  todoFilterLabel,
  type Todo,
  type TodoFilter,
  type TodoSort,
  type TodoStatus,
} from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import type { AuditLog } from '../../audit.js';
import { applyFormColor, formKey, type FolderForm } from './folderForm.js';
import { errorText, useFolderTree, type TreeKeyHandler } from './useFolderTree.js';
import type { OpenColorPicker } from './useColorPicker.js';

export type TodoField = 'subject' | 'due' | 'folder' | 'description' | 'color';
/** The form's fields in Tab order. */
export const TODO_FIELDS: TodoField[] = ['subject', 'due', 'folder', 'description', 'color'];

/** Folder color when neither a folder nor its parents have one. */
export const TODO_FOLDER_COLOR = DEFAULT_FOLDER_COLOR;
/** A todo's color when neither it nor its folders have one. */
export const TODO_ITEM_COLOR = DEFAULT_ITEM_COLOR;

export type TodoForm = FolderForm<TodoField>;

interface Options {
  service: FomoDirectService;
  audit: AuditLog;
  /** Opens the color picker popup. */
  pickColor?: OpenColorPicker;
  /** Show a message in the main status bar. */
  notify(message: string, ms?: number): void;
  /** Rows Shift+↑/↓ moves (5, or 10 on a tall terminal). */
  jump: number;
}

function newForm(values: Partial<Record<TodoField, string>>, extra: Partial<TodoForm> = {}): TodoForm {
  const all = { subject: '', due: '', folder: '', description: '', color: '', ...values };
  return { values: all, field: 'subject', touched: new Set(), folderQuery: all.folder, pick: -1, saving: false, ...extra };
}

function editForm(todo: Todo): TodoForm {
  return newForm(
    { subject: todo.subject, due: todo.dueDate ?? '', folder: todo.folder ?? '', description: todo.description, color: todo.color ?? '' },
    { id: todo.id },
  );
}

/** State and keys of the Todos view (6): todos filed in folders, like Bookmarks. */
export function useTodos({ service, audit, pickColor, notify, jump }: Options) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<TodoSort | undefined>();
  const [filter, setFilter] = useState<TodoFilter>('all');
  const [form, setForm] = useState<TodoForm | undefined>();

  const buildRows = useCallback(
    (todos: Todo[], expanded: ReadonlySet<string>, search: string) => buildTodoRows(todos, expanded, { search, sort, filter }),
    [sort, filter],
  );
  const tree = useFolderTree<Todo>({
    area: 'todo',
    noun: ['todo', 'todos'],
    itemKey: (todo) => `todo:${todo.id}`,
    itemName: (todo) => todo.subject,
    buildRows,
    fetch: async () => {
      const { todos, folderColors } = await service.listTodos();
      return { items: todos.map((t) => ({ ...t, folder: t.folder ?? '' })), folderColors };
    },
    moveFolder: (from, to) => service.moveTodoFolder(from, to),
    saveFolderColor: (folder, color) => service.setTodoFolderColor(folder, color),
    saveItemColor: (todo, color) => service.updateTodo(todo.id, { color }),
    remove: (todo) => service.deleteTodo(todo.id),
    pickColor,
    defaultFolderColor: TODO_FOLDER_COLOR,
    defaultItemColor: TODO_ITEM_COLOR,
    audit,
    notify,
    jump,
  });
  const { load, reveal, say, fail, keep, folders, folderColors, items } = tree;
  const matches = useMemo(() => (form ? folderMatches(folders, form.folderQuery) : []), [folders, form]);

  const openView = useCallback(() => {
    setOpen(true);
    void load();
  }, [load]);

  const close = useCallback(() => {
    setForm(undefined);
    tree.reset();
    setOpen(false);
  }, [tree.reset]);

  const setStatus = (todo: Todo, status: TodoStatus) => {
    if (todo.status === status) return;
    tree.setItems((list) => list.map((t) => (t.id === todo.id ? { ...t, status } : t)));
    if (matchesTodoFilter({ ...todo, status }, filter)) keep(`todo:${todo.id}`);
    say(`${TODO_STATUS_ICON[status]} ${TODO_STATUS_LABEL[status]}: “${todo.subject}”`);
    service.updateTodo(todo.id, { status }).catch((err) => {
      fail(`“${todo.subject}” → ${status}`, err);
      void load();
    });
  };

  const save = async (current: TodoForm) => {
    const { subject, due, folder, description, color } = current.values;
    if (!subject.trim()) { setForm({ ...current, error: 'Subject is required', field: 'subject' }); return; }
    const dueDate = parseDueDate(due);
    if (dueDate === undefined) {
      setForm({ ...current, error: dueDateError(due), field: 'due' });
      return;
    }
    setForm({ ...current, saving: true, error: undefined });
    try {
      const req = { subject: subject.trim(), description: description.trim(), folder: normalizeFolder(folder) };
      const saved = current.id
        ? await service.updateTodo(current.id, { ...req, dueDate, color })
        : await service.createTodo({ ...req, ...(dueDate ? { dueDate } : {}), ...(color ? { color } : {}) });
      setForm(undefined);
      if (!matchesTodoFilter(saved, filter)) setFilter('all');
      reveal(saved);
      await load();
      say(`✓ ${current.id ? 'Updated' : 'Added'} in ${saved.folder || 'top level'}`);
    } catch (err) {
      audit.error('todo', `save “${subject}”: ${errorText(err)}`);
      setForm((f) => f && { ...f, saving: false, error: errorText(err) });
    }
  };

  const pickFormColor = (f: TodoForm) => {
    if (!pickColor) return;
    const subject = f.values.subject.trim();
    pickColor(itemColorRequest({
      title: subject ? `“${subject}”` : 'this todo',
      sample: subject || 'Todo',
      folder: f.values.folder,
      color: f.values.color,
      onPick: (color) => setForm((cur) => cur && applyFormColor(cur, TODO_FIELDS, color)),
    }, folderColors, TODO_ITEM_COLOR));
  };

  const formInput = (f: TodoForm, raw: string, key: Key) => {
    const step = formKey(f, TODO_FIELDS, matches, raw, key);
    if (!step) return;
    if ('form' in step) setForm(step.form);
    else if (step.action === 'cancel') setForm(undefined);
    else if (step.action === 'save') void save(f);
    else if (step.action === 'color') pickFormColor(f);
  };

  const onKey: TreeKeyHandler<Todo> = (input, key, row) => {
    if (input === '6') { close(); return true; }
    if (input === 's') {
      const next = nextSort(TODO_SORTS, sort);
      keep(row?.key);
      setSort(next);
      say(`Sort: ${next.label}`);
      return true;
    }
    if (input === 'v') {
      const next = nextTodoFilter(filter);
      keep(row?.key);
      setFilter(next);
      say(`Showing: ${todoFilterLabel(next)}`);
      return true;
    }
    if (input === 'a') { setForm(newForm({ folder: rowFolder(row) })); return true; }
    if (row?.kind !== 'item') return false;
    const todo = row.item;
    if (key.return) { setStatus(todo, nextTodoStatus(todo.status)); return true; }
    if (input === 'x') { setStatus(todo, todo.status === 'done' ? 'pending' : 'done'); return true; }
    if (input === 'e') { setForm(editForm(todo)); return true; }
    return false;
  };

  /** Handle a key while Todos (or its form) is shown; `raw` keeps its case for typing. */
  const handleInput = (raw: string, key: Key) => {
    if (form) { formInput(form, raw, key); return; }
    if (tree.handleInput(raw, key, onKey) === 'close') close();
  };

  const counts = useMemo(() => todoCounts(items), [items]);

  return {
    /** The Todos view is shown. */
    active: open,
    /** Keys are text (form, rename or search prompt), so global keys like q must not fire. */
    typing: form !== undefined || tree.typing,
    openView,
    close,
    handleInput,
    /** The todos' sort, when it isn't the default order. */
    sortLabel: isDefaultSort(TODO_SORTS, sort) ? undefined : sortLabel(TODO_SORTS, sort),
    view: {
      ...tree.view,
      form,
      folderMatches: matches,
      filter,
      counts,
    },
  };
}

export type TodosViewState = ReturnType<typeof useTodos>['view'];
