import type { DigestEntry, Reference, Status, Todo, TodoStatus, Update } from './types.js';
import { importanceRank } from './digest/view.js';

export type SortDir = 'asc' | 'desc';

export interface Sort<K extends string = string> {
  key: K;
  dir: SortDir;
}

export type UpdateSortKey = 'date' | 'source' | 'title' | 'status';
export type TopicSortKey = 'importance' | 'date' | 'title' | 'size';
export type ReferenceSortKey = 'title' | 'added';
export type TodoSortKey = 'status' | 'due' | 'created' | 'subject';

export type UpdateSort = Sort<UpdateSortKey>;
export type TopicSort = Sort<TopicSortKey>;
export type ReferenceSort = Sort<ReferenceSortKey>;
export type TodoSort = Sort<TodoSortKey>;

/** A sort `s` can cycle to, with the label shown when it is picked. */
export interface SortOption<K extends string = string> extends Sort<K> {
  label: string;
}

/** Plain update lists; the first option is the default order. Status is only offered where the view mixes read and unread. */
export const UPDATE_SORTS: readonly SortOption<UpdateSortKey>[] = [
  { key: 'date', dir: 'desc', label: 'Newest first' },
  { key: 'date', dir: 'asc', label: 'Oldest first' },
  { key: 'source', dir: 'asc', label: 'Source A→Z' },
  { key: 'source', dir: 'desc', label: 'Source Z→A' },
  { key: 'title', dir: 'asc', label: 'Title A→Z' },
  { key: 'title', dir: 'desc', label: 'Title Z→A' },
  { key: 'status', dir: 'asc', label: 'Unread first' },
];

/** Topic views (Unread / Pending grouped by topic). */
export const TOPIC_SORTS: readonly SortOption<TopicSortKey>[] = [
  { key: 'importance', dir: 'desc', label: 'Most important first' },
  { key: 'importance', dir: 'asc', label: 'Least important first' },
  { key: 'date', dir: 'desc', label: 'Newest first' },
  { key: 'date', dir: 'asc', label: 'Oldest first' },
  { key: 'title', dir: 'asc', label: 'Title A→Z' },
  { key: 'title', dir: 'desc', label: 'Title Z→A' },
  { key: 'size', dir: 'desc', label: 'Most updates first' },
];

/** Links within each References folder (folders stay alphabetical). */
export const REFERENCE_SORTS: readonly SortOption<ReferenceSortKey>[] = [
  { key: 'title', dir: 'asc', label: 'Title A→Z' },
  { key: 'title', dir: 'desc', label: 'Title Z→A' },
  { key: 'added', dir: 'desc', label: 'Newest first' },
  { key: 'added', dir: 'asc', label: 'Oldest first' },
];

export const TODO_SORTS: readonly SortOption<TodoSortKey>[] = [
  { key: 'status', dir: 'asc', label: 'By status' },
  { key: 'due', dir: 'asc', label: 'Due soonest' },
  { key: 'due', dir: 'desc', label: 'Due latest' },
  { key: 'created', dir: 'desc', label: 'Newest first' },
  { key: 'subject', dir: 'asc', label: 'Subject A→Z' },
];

/** Sort options of a plain update list: Unread and Read hold one status, so they skip “Unread first”. */
export function updateSorts(view: Status | 'all' | 'saved'): readonly SortOption<UpdateSortKey>[] {
  return view === 'unread' || view === 'read' ? UPDATE_SORTS.filter((o) => o.key !== 'status') : UPDATE_SORTS;
}

/** The option after `current` (wrapping); unset counts as the default (first) option, and one not offered starts over. */
export function nextSort<K extends string>(options: readonly SortOption<K>[], current: Sort<K> | undefined): SortOption<K> {
  if (!current) return options[1 % options.length]!;
  const idx = options.findIndex((o) => o.key === current.key && o.dir === current.dir);
  return options[(idx + 1) % options.length]!;
}

/** Label of `sort` among `options` (the first option's when unset or not offered). */
export function sortLabel<K extends string>(options: readonly SortOption<K>[], sort: Sort<K> | undefined): string {
  const match = sort && options.find((o) => o.key === sort.key && o.dir === sort.dir);
  return (match ?? options[0]!).label;
}

/** True when `sort` is unset or the default (first) option. */
export function isDefaultSort<K extends string>(options: readonly SortOption<K>[], sort: Sort<K> | undefined): boolean {
  return !sort || (sort.key === options[0]!.key && sort.dir === options[0]!.dir);
}

export function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

const flip = (dir: SortDir, n: number) => (dir === 'desc' ? -n : n);
const newestFirst = (a: string, b: string) => b.localeCompare(a);

/** Comparator for updates; ties fall back to newest first. */
export function compareUpdates(sort: UpdateSort = UPDATE_SORTS[0]!): (a: Update, b: Update) => number {
  const byDate = (a: Update, b: Update) => newestFirst(a.datePublished, b.datePublished);
  switch (sort.key) {
    case 'date':
      return (a, b) => flip(sort.dir, a.datePublished.localeCompare(b.datePublished));
    case 'source':
      return (a, b) => flip(sort.dir, compareText(a.source, b.source)) || byDate(a, b);
    case 'title':
      return (a, b) => flip(sort.dir, compareText(a.title, b.title)) || byDate(a, b);
    case 'status': {
      const rank = (u: Update) => (u.status === 'unread' ? 0 : 1);
      return (a, b) => flip(sort.dir, rank(a) - rank(b)) || byDate(a, b);
    }
  }
}

/** Digest entries in `sort` order (a new array); ties fall back to newest first. */
export function sortDigestEntries(entries: DigestEntry[], sort: TopicSort = TOPIC_SORTS[0]!): DigestEntry[] {
  const byDate = (a: DigestEntry, b: DigestEntry) => newestFirst(a.latestDate, b.latestDate) || Number(a.synthetic) - Number(b.synthetic);
  const primary = (a: DigestEntry, b: DigestEntry): number => {
    switch (sort.key) {
      case 'importance': return importanceRank(a.topic.importance) - importanceRank(b.topic.importance);
      case 'date': return a.latestDate.localeCompare(b.latestDate);
      case 'title': return compareText(a.topic.title, b.topic.title);
      case 'size': return a.items.length - b.items.length;
    }
  };
  return [...entries].sort((a, b) => flip(sort.dir, primary(a, b)) || byDate(a, b));
}

/** Comparator for links within a References folder; ties fall back to title. */
export function compareReferences(sort: ReferenceSort = REFERENCE_SORTS[0]!): (a: Reference, b: Reference) => number {
  if (sort.key === 'added') return (a, b) => flip(sort.dir, a.createdAt.localeCompare(b.createdAt)) || compareText(a.title, b.title);
  return (a, b) => flip(sort.dir, compareText(a.title, b.title));
}

const TODO_STATUS_ORDER: Record<TodoStatus, number> = { pending: 0, in_progress: 1, done: 2 };

/** Todos in `sort` order (a new array). The default is pending → in progress → done, then due date. */
export function sortTodos(todos: Todo[], sort: TodoSort = TODO_SORTS[0]!): Todo[] {
  const byDue = (a: Todo, b: Todo, dir: SortDir) => {
    if (a.dueDate && b.dueDate) return flip(dir, a.dueDate.localeCompare(b.dueDate));
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  };
  const compare = (a: Todo, b: Todo): number => {
    switch (sort.key) {
      case 'status':
        return flip(sort.dir, TODO_STATUS_ORDER[a.status] - TODO_STATUS_ORDER[b.status])
          || byDue(a, b, 'asc') || a.createdAt.localeCompare(b.createdAt);
      case 'due':
        return byDue(a, b, sort.dir) || a.createdAt.localeCompare(b.createdAt);
      case 'created':
        return flip(sort.dir, a.createdAt.localeCompare(b.createdAt));
      case 'subject':
        return flip(sort.dir, compareText(a.subject, b.subject)) || a.createdAt.localeCompare(b.createdAt);
    }
  };
  return [...todos].sort(compare);
}
