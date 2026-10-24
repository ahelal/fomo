import type { Todo, TodoStatus } from './types.js';
import { searchTerms } from './search.js';
import { compareTodos, type TodoSort } from './sort.js';
import { buildFolderRows, type FolderTreeRow } from './folders.js';

export type TodoRow = FolderTreeRow<Todo>;

export const TODO_STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'done'];

export const TODO_STATUS_LABEL: Record<TodoStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done',
};

export const TODO_STATUS_ICON: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◑',
  done: '●',
};

export const TODO_STATUS_COLOR: Record<TodoStatus, string> = {
  pending: '#8b949e',
  in_progress: '#e3b341',
  done: '#3fb950',
};

/** The status ↵ moves a todo to: pending → in progress → done → pending. */
export function nextTodoStatus(status: TodoStatus): TodoStatus {
  return TODO_STATUSES[(TODO_STATUSES.indexOf(status) + 1) % TODO_STATUSES.length]!;
}

/** Which todos are listed (cycled with v). */
export type TodoFilter = 'all' | 'open' | 'in_progress' | 'done';

export const TODO_FILTERS: readonly { value: TodoFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

export function nextTodoFilter(filter: TodoFilter): TodoFilter {
  const i = TODO_FILTERS.findIndex((f) => f.value === filter);
  return TODO_FILTERS[(i + 1) % TODO_FILTERS.length]!.value;
}

export function todoFilterLabel(filter: TodoFilter): string {
  return TODO_FILTERS.find((f) => f.value === filter)?.label ?? 'All';
}

/** True when `todo` is listed under `filter` (`open` is anything not done). */
export function matchesTodoFilter(todo: Todo, filter: TodoFilter = 'all'): boolean {
  if (filter === 'all') return true;
  if (filter === 'open') return todo.status !== 'done';
  return todo.status === filter;
}

/** True when every word is in the subject, notes, folder or attachments (case-insensitive). */
export function matchesTodo(todo: Todo, query: string | undefined): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const text = [todo.subject, todo.description, todo.folder, ...(todo.attachments ?? [])].join('\n').toLowerCase();
  return terms.every((t) => text.includes(t));
}

export interface TodoRowOptions {
  search?: string;
  sort?: TodoSort;
  filter?: TodoFilter;
}

export interface TodoCounts {
  open: number;
  done: number;
  /** Open todos past their due date. */
  overdue: number;
}

/** How many todos are open, done and overdue (the Todos header). */
export function todoCounts(todos: readonly Todo[], now = new Date()): TodoCounts {
  let done = 0;
  let overdue = 0;
  for (const todo of todos) {
    if (todo.status === 'done') done++;
    else if (isOverdue(todo, now)) overdue++;
  }
  return { open: todos.length - done, done, overdue };
}

/**
 * The Todos folder tree as display rows: subfolders first (by name), then todos (by `sort`). Folders
 * count their done todos for a progress bar. With `search` set every folder is opened.
 */
export function buildTodoRows(todos: Todo[], expanded: ReadonlySet<string>, { search, sort, filter = 'all' }: TodoRowOptions = {}): TodoRow[] {
  const searching = searchTerms(search).length > 0;
  return buildFolderRows(todos, expanded, {
    folder: (todo) => todo.folder,
    key: (todo) => `todo:${todo.id}`,
    compare: compareTodos(sort),
    include: searching || filter !== 'all'
      ? (todo) => matchesTodoFilter(todo, filter) && matchesTodo(todo, search)
      : undefined,
    openAll: searching,
    isDone: (todo) => todo.status === 'done',
  });
}

// ─── Due dates ───────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** `date` as a local `YYYY-MM-DD`. */
export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDay(iso: string): Date | undefined {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return toIsoDate(d) === iso ? d : undefined;
}

function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Whole days from today until `dueDate` (negative once it passed); undefined without a valid date. */
export function daysUntil(dueDate: string | undefined, now = new Date()): number | undefined {
  const due = dueDate ? localDay(dueDate) : undefined;
  if (!due) return undefined;
  return Math.round((due.getTime() - startOfDay(now).getTime()) / DAY_MS);
}

/** True when `todo` isn't done and its due date has passed. */
export function isOverdue(todo: Pick<Todo, 'dueDate' | 'status'>, now = new Date()): boolean {
  const days = daysUntil(todo.dueDate, now);
  return todo.status !== 'done' && days !== undefined && days < 0;
}

/** How pressing a todo's due date is: `overdue`, `soon` (today or tomorrow), else `later`. Done todos are never pressing. */
export type DueTone = 'overdue' | 'soon' | 'later';

export function dueTone(todo: Pick<Todo, 'dueDate' | 'status'>, now = new Date()): DueTone {
  const days = daysUntil(todo.dueDate, now);
  if (todo.status === 'done' || days === undefined || days > 1) return 'later';
  return days < 0 ? 'overdue' : 'soon';
}

/** Short due text: `3d overdue`, `today`, `tomorrow`, `in 5d`, or the date (`Mar 4`, `Jan 2 '27` in another year) further out. */
export function dueLabel(dueDate: string | undefined, now = new Date()): string {
  const days = daysUntil(dueDate, now);
  if (days === undefined) return '';
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days}d`;
  const due = localDay(dueDate!)!;
  const label = `${MONTHS[due.getMonth()]} ${due.getDate()}`;
  return due.getFullYear() === now.getFullYear() ? label : `${label} '${String(due.getFullYear() % 100).padStart(2, '0')}`;
}

/**
 * A due date typed in by hand, as `YYYY-MM-DD`: a date, `today`, `tomorrow`, `+3` / `3d` (days),
 * `2w` (weeks) or a weekday (`fri`, the next one). `''` when blank; undefined when not understood.
 */
export function parseDueDate(text: string, now = new Date()): string | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return localDay(t) ? t : undefined;
  const today = startOfDay(now);
  const plus = (days: number) => toIsoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
  if (t === 'today' || t === 'tod') return plus(0);
  if (t === 'tomorrow' || t === 'tom' || t === 'tmr') return plus(1);
  const rel = t.match(/^\+?(\d{1,3})\s*([dw]?)$/);
  if (rel) return plus(Number(rel[1]) * (rel[2] === 'w' ? 7 : 1));
  if (t.length >= 3) {
    const day = WEEKDAYS.findIndex((w) => w.startsWith(t));
    if (day >= 0) return plus(((day - today.getDay() + 6) % 7) + 1);
  }
  return undefined;
}

/**
 * How a due date being typed is read, shown next to the field: `→ 2026-03-06 · in 2d` (just
 * `· in 2d` when typed as a date), or `not a date` (`error`). Undefined while blank.
 */
export function dueHint(text: string, now = new Date()): { text: string; error?: true } | undefined {
  if (!text.trim()) return undefined;
  const date = parseDueDate(text, now);
  if (date === undefined) return { text: 'not a date', error: true };
  const label = dueLabel(date, now);
  return { text: date === text.trim() ? `· ${label}` : `→ ${date} · ${label}` };
}

/** The error shown when a todo is saved with a due date that isn't one. */
export function dueDateError(text: string): string {
  return `Not a date: ${text.trim()} — try 2026-03-06, fri, +3 or 2w`;
}
