import { useCallback, useEffect, useMemo, useState } from 'react';
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
  matchesTodoKindFilter,
  nextTodoKindFilter,
  nextSort,
  nextTodoFilter,
  nextTodoStatus,
  normalizeFolder,
  parseAttachments,
  parseDueDate,
  rowFolder,
  sortLabel,
  shortcutKey,
  TODO_SORTS,
  TODO_STATUS_ICON,
  TODO_STATUS_LABEL,
  todoCounts,
  todoFilterLabel,
  todoKind,
  todoKindFilterLabel,
  type Todo,
  type FolderMetadataMap,
  type TodoFilter,
  type TodoKind,
  type TodoKindFilter,
  type TodoSort,
  type TodoStatus,
} from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import type { AuditLog } from '../../audit.js';
import { completePath, isPathInput, nextPathCompletion, type PathCycle } from '../../pathComplete.js';
import { cursorLine } from '../editText.js';
import { applyFormColor, formKey, setFormValue, type FolderForm } from './folderForm.js';
import { errorText, useFolderTree, type TreeKeyHandler } from './useFolderTree.js';
import type { OpenColorPicker } from './useColorPicker.js';
import { useFolderEditor } from './useFolderEditor.js';

export type TodoField = 'kind' | 'subject' | 'due' | 'folder' | 'description' | 'attachments' | 'color';
/** The form's fields in Tab order. */
export const TODO_FIELDS: TodoField[] = ['subject', 'due', 'folder', 'description', 'attachments', 'color', 'kind'];
const MULTILINE_FIELDS: TodoField[] = ['description', 'attachments'];

/** Folder color when neither a folder nor its parents have one. */
export const TODO_FOLDER_COLOR = DEFAULT_FOLDER_COLOR;
/** A todo's color when neither it nor its folders have one. */
export const TODO_ITEM_COLOR = DEFAULT_ITEM_COLOR;

export type TodoForm = FolderForm<TodoField> & {
  originalKind?: TodoKind;
  /** Tab cycling through the paths that complete an attachment line. */
  pathCycle?: PathCycle;
};

function fieldsFor(form: TodoForm): TodoField[] {
  return form.values.kind === 'idea' ? TODO_FIELDS.filter((field) => field !== 'due') : TODO_FIELDS;
}

/** Paths completing the attachment line at the cursor; `current` is the one Tab cycled to. */
export interface PathSuggestions {
  matches: string[];
  current: number;
}

interface Options {
  service: FomoDirectService;
  audit: AuditLog;
  /** Opens the color picker popup. */
  pickColor?: OpenColorPicker;
  /** Show a message in the main status bar. */
  notify(message: string, ms?: number): void;
  openAttachment(target: string): Promise<void>;
  /** Rows Shift+↑/↓ moves (5, or 10 on a tall terminal). */
  jump: number;
}

function newForm(values: Partial<Record<TodoField, string>>, extra: Partial<TodoForm> = {}): TodoForm {
  const all = { kind: 'todo', subject: '', due: '', folder: '', description: '', attachments: '', color: '', ...values };
  return { values: all, field: 'subject', touched: new Set(), folderQuery: all.folder, pick: -1, saving: false, ...extra };
}

function editForm(todo: Todo): TodoForm {
  return newForm(
    { kind: todoKind(todo), subject: todo.subject, due: todo.dueDate ?? '', folder: todo.folder ?? '', description: todo.description, attachments: todo.attachments?.join('\n') ?? '', color: todo.color ?? '' },
    { id: todo.id, originalKind: todoKind(todo) },
  );
}

/** State and keys of the Todos view (6): todos filed in folders, like Bookmarks. */
export function useTodos({ service, audit, pickColor, notify, openAttachment, jump }: Options) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<TodoSort | undefined>();
  const [filter, setFilter] = useState<TodoFilter>('all');
  const [kindFilter, setKindFilter] = useState<TodoKindFilter>('all');
  const [form, setForm] = useState<TodoForm | undefined>();
  const [attachmentPicker, setAttachmentPicker] = useState<{ todo: Todo; index: number }>();

  const buildRows = useCallback(
    (todos: Todo[], expanded: ReadonlySet<string>, search: string, folderMetadata?: FolderMetadataMap) =>
      buildTodoRows(todos, expanded, { search, sort, filter, kindFilter, folderMetadata }),
    [sort, filter, kindFilter],
  );
  const tree = useFolderTree<Todo>({
    area: 'todo',
    noun: ['todo', 'todos'],
    itemKey: (todo) => `todo:${todo.id}`,
    itemName: (todo) => todo.subject,
    buildRows,
    fetch: async () => {
      const { todos, folderColors, folderMetadata } = await service.listTodos();
      return { items: todos.map((t) => ({ ...t, folder: t.folder ?? '' })), folderColors, folderMetadata };
    },
    moveFolder: (from, to) => service.moveTodoFolder(from, to),
    deleteFolder: (folder, mode) => service.deleteTodoFolder(folder, mode),
    saveFolderColor: (folder, color) => service.setTodoFolderColor(folder, color),
    saveFolderMetadata: (folder, metadata) => service.setTodoFolderMetadata(folder, metadata),
    saveItemColor: (todo, color) => service.updateTodo(todo.id, { color }),
    remove: (todo) => service.deleteTodo(todo.id),
    pickColor,
    defaultFolderColor: TODO_FOLDER_COLOR,
    defaultItemColor: TODO_ITEM_COLOR,
    audit,
    notify,
    jump,
  });
  const { load, reveal, revealFolder, say, fail, keep, folders, folderColors, folderMetadata, items } = tree;
  const folderEditor = useFolderEditor({
    area: 'todo', noun: ['todo', 'todos'], folderMetadata, folderColors, audit, pickColor, revealFolder, load, say,
    moveFolder: (from, to) => service.moveTodoFolder(from, to),
    saveMetadata: (path, metadata) => service.setTodoFolderMetadata(path, metadata),
    saveColor: (path, color) => service.setTodoFolderColor(path, color),
  });
  const folderMetadataForm = folderEditor.form;
  const matches = useMemo(() => (form ? folderMatches(folders, form.folderQuery) : []), [folders, form]);

  const [pathMatches, setPathMatches] = useState<{ line: string; matches: string[] }>();
  const pathLine = form?.field === 'attachments' && !form.saving ? cursorLine(form.values.attachments, form.cursor) : undefined;
  const pathQuery = pathLine && isPathInput(pathLine.text) ? pathLine.text : undefined;
  useEffect(() => {
    if (pathQuery === undefined) { setPathMatches(undefined); return; }
    let live = true;
    const timer = setTimeout(() => {
      void completePath(pathQuery).then((found) => { if (live) setPathMatches({ line: pathQuery, matches: found }); });
    }, 50);
    return () => { live = false; clearTimeout(timer); };
  }, [pathQuery]);
  let pathSuggestions: PathSuggestions | undefined;
  if (pathQuery !== undefined) {
    const cycle = form?.pathCycle;
    if (cycle && cycle.matches[cycle.index] === pathQuery) pathSuggestions = { matches: cycle.matches, current: cycle.index };
    else if (pathMatches?.line === pathQuery) pathSuggestions = { matches: pathMatches.matches, current: -1 };
    else if (pathMatches) {
      // Until the new lookup lands, narrow the previous one instead of flashing the hint away.
      const lower = pathQuery.toLowerCase();
      const narrowed = pathMatches.matches.filter((m) => m.toLowerCase().startsWith(lower));
      if (narrowed.length) pathSuggestions = { matches: narrowed, current: -1 };
    }
  }

  const openView = useCallback(() => {
    setOpen(true);
    void load();
  }, [load]);

  const close = useCallback(() => {
    setForm(undefined);
    folderEditor.close();
    setAttachmentPicker(undefined);
    tree.reset();
    setOpen(false);
  }, [tree.reset, folderEditor.close]);

  const setStatus = (todo: Todo, status: TodoStatus) => {
    if (todoKind(todo) === 'idea') return;
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
    if (current.values.kind !== 'todo' && current.values.kind !== 'idea') {
      setForm({ ...current, error: 'Type must be todo or idea', field: 'kind' });
      return;
    }
    const kind: TodoKind = current.values.kind;
    if (!subject.trim()) { setForm({ ...current, error: 'Subject is required', field: 'subject' }); return; }
    const dueDate = kind === 'todo' ? parseDueDate(due) : '';
    if (kind === 'todo' && dueDate === undefined) {
      setForm({ ...current, error: dueDateError(due), field: 'due' });
      return;
    }
    let attachments: string[];
    try {
      attachments = parseAttachments(current.values.attachments);
    } catch (err) {
      setForm({ ...current, error: errorText(err), field: 'attachments', cursor: undefined });
      return;
    }
    setForm({ ...current, saving: true, error: undefined });
    try {
      const req = {
        subject: subject.trim(),
        description,
        folder: normalizeFolder(folder),
        ...(kind === 'idea' || (current.id && current.originalKind !== kind) ? { kind } : {}),
      };
      const saved = current.id
        ? await service.updateTodo(current.id, { ...req, dueDate: kind === 'todo' ? dueDate ?? '' : '', color, attachments })
        : await service.createTodo({ ...req, ...(attachments.length ? { attachments } : {}), ...(kind === 'todo' && dueDate ? { dueDate } : {}), ...(color ? { color } : {}) });
      setForm(undefined);
      if (!matchesTodoFilter(saved, filter) || !matchesTodoKindFilter(saved, kindFilter)) {
        setFilter('all');
        setKindFilter('all');
      }
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
      onPick: (color) => setForm((cur) => cur && { ...applyFormColor(cur, TODO_FIELDS, color), field: 'subject' }),
    }, folderColors, TODO_ITEM_COLOR));
  };

  /** Tab on an attachment line naming a path completes it; with nothing to complete it moves on. */
  const completeAttachment = (f: TodoForm, raw: string, key: Key): boolean => {
    const line = cursorLine(f.values.attachments, f.cursor);
    if (!line || !isPathInput(line.text)) return false;
    const cycling = f.pathCycle?.matches[f.pathCycle.index] === line.text;
    void (cycling ? Promise.resolve([]) : completePath(line.text)).then((found) => {
      const step = nextPathCompletion(line.text, found, f.pathCycle);
      let next: TodoForm = f;
      if (step) {
        const value = f.values.attachments.slice(0, line.start) + step.text + f.values.attachments.slice(line.end);
        next = { ...setFormValue<TodoField, TodoForm>(f, 'attachments', value), cursor: line.start + step.text.length, pathCycle: step.cycle };
      } else {
        const moved = formKey(f, fieldsFor(f), matches, raw, key, MULTILINE_FIELDS);
        if (moved && 'form' in moved) next = moved.form;
      }
      setForm((cur) => (cur === f ? next : cur));
    });
    return true;
  };

  const formInput = (f: TodoForm, raw: string, key: Key) => {
    if (key.tab && !key.shift && f.field === 'attachments' && !f.saving && completeAttachment(f, raw, key)) return;
    const step = formKey(f, fieldsFor(f), matches, raw, key, MULTILINE_FIELDS);
    if (!step) return;
    if ('form' in step) setForm(step.form);
    else if (step.action === 'cancel') setForm(undefined);
    else if (step.action === 'save') void save(f);
    else if (step.action === 'color') pickFormColor(f);
  };

  const onKey: TreeKeyHandler<Todo> = (input, key, row) => {
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
    if (input === '6') {
      const next = nextTodoKindFilter(kindFilter);
      keep(row?.key);
      setKindFilter(next);
      say(`Showing: ${todoKindFilterLabel(next)}`);
      return true;
    }
    if (input === 'a') { setForm(newForm({ folder: rowFolder(row) })); return true; }
    if (input === 'i') { setForm(newForm({ kind: 'idea', folder: rowFolder(row) })); return true; }
    if (row?.kind === 'folder' && (key.return || input === 'e' || input === 'm')) {
      folderEditor.open(row.path, input === 'm' ? 'localPath' : 'name');
      return true;
    }
    if (row?.kind === 'folder' && (input === 'o' || input === 'g')) {
      const metadata = folderMetadata[row.path];
      const target = input === 'o' ? metadata?.localPath : metadata?.githubRepo ? `https://github.com/${metadata.githubRepo}` : undefined;
      if (!target) say(input === 'o' ? 'No local directory is associated with this folder' : 'No GitHub repository is associated with this folder');
      else void openAttachment(target).then(() => say(`Opened ${target}`), (err) => fail(`open folder association “${target}”`, err));
      return true;
    }
    if (row?.kind !== 'item') return false;
    const todo = row.item;
    if (input === 't' && todoKind(todo) === 'idea') {
      void service.updateTodo(todo.id, { kind: 'todo' }).then((updated) => {
        tree.setItems((list) => list.map((item) => item.id === updated.id ? updated : item));
        keep(`todo:${updated.id}`);
        say(`✓ Converted “${todo.subject}” to a todo`);
      }, (err) => fail(`convert “${todo.subject}”`, err));
      return true;
    }
    if (todoKind(todo) === 'idea') {
      if (input === 'e' || key.return) { setForm(editForm(todo)); return true; }
      if (input === 'o') {
        if (todo.attachments?.length) setAttachmentPicker({ todo, index: 0 });
        else say('No attachments — e to add URLs or file paths');
        return true;
      }
      return false;
    }
    if (input === ' ') { setStatus(todo, nextTodoStatus(todo.status)); return true; }
    if (input === 'x') { setStatus(todo, todo.status === 'done' ? 'pending' : 'done'); return true; }
    if (input === 'e' || key.return) { setForm(editForm(todo)); return true; }
    if (input === 'o') {
      if (todo.attachments?.length) setAttachmentPicker({ todo, index: 0 });
      else say('No attachments — e to add URLs or file paths');
      return true;
    }
    return false;
  };

  /** Handle a key while Todos (or its form) is shown; `raw` keeps its case for typing. */
  const handleInput = (raw: string, key: Key) => {
    if (folderMetadataForm) { folderEditor.handleInput(raw, key); return; }
    if (form) { formInput(form, raw, key); return; }
    if (attachmentPicker) {
      const input = shortcutKey(raw);
      const targets = attachmentPicker.todo.attachments ?? [];
      if (key.escape || key.backspace || key.delete) { setAttachmentPicker(undefined); return; }
      if (input === 'e') { setForm(editForm(attachmentPicker.todo)); setAttachmentPicker(undefined); return; }
      const delta = key.upArrow || input === 'k' ? -1 : key.downArrow || input === 'j' ? 1 : key.pageUp ? -10 : key.pageDown ? 10 : 0;
      if (delta) setAttachmentPicker({ ...attachmentPicker, index: Math.max(0, Math.min(targets.length - 1, attachmentPicker.index + delta)) });
      if (key.return || input === 'o') {
        const target = targets[attachmentPicker.index];
        if (target) void openAttachment(target).then(() => say(`Opened ${target}`), (err) => fail(`open attachment “${target}”`, err));
      }
      return;
    }
    tree.handleInput(raw, key, onKey);
  };

  const counts = useMemo(() => todoCounts(items), [items]);

  return {
    /** The Todos view is shown. */
    active: open,
    /** Keys are text (form, rename or search prompt), so global keys like q must not fire. */
    typing: form !== undefined || folderMetadataForm !== undefined || tree.typing,
    openView,
    close,
    handleInput,
    /** The todos' sort, when it isn't the default order. */
    sortLabel: isDefaultSort(TODO_SORTS, sort) ? undefined : sortLabel(TODO_SORTS, sort),
    view: {
      ...tree.view,
      form,
      folderMetadataForm,
      attachmentPicker,
      pathSuggestions,
      folderMatches: matches,
      filter,
      kindFilter,
      counts,
    },
  };
}

export type TodosViewState = ReturnType<typeof useTodos>['view'];
