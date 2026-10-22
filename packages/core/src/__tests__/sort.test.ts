import { describe, it, expect } from 'vitest';
import {
  REFERENCE_SORTS,
  TODO_SORTS,
  TOPIC_SORTS,
  UPDATE_SORTS,
  compareUpdates,
  isDefaultSort,
  nextSort,
  sortDigestEntries,
  sortLabel,
  sortTodos,
  updateSorts,
} from '../sort.js';
import { buildReferenceRows } from '../references.js';
import type { DigestEntry, Reference, Todo, TopicImportance, Update } from '../types.js';

function upd(id: string, extra: Partial<Update> = {}): Update {
  return {
    id, source: 'src', title: id, url: `https://x/${id}`, datePublished: '2026-01-01', dateAdded: '2026-01-01',
    status: 'unread', saved: false, content: '', ...extra,
  };
}

function entry(id: string, latestDate: string, items: number, importance?: TopicImportance, title = id): DigestEntry {
  return {
    topic: { id, title, summary: '', highlights: [], createdAt: 't', updatedAt: 't', ...(importance ? { importance } : {}) },
    items: Array.from({ length: items }, (_, i) => upd(`${id}${i}`)),
    latestDate,
    sources: ['src'],
    synthetic: false,
  };
}

describe('nextSort', () => {
  it('cycles through the options and wraps', () => {
    // Unset is the default order, so the first press moves to the second option.
    let s = nextSort(UPDATE_SORTS, undefined);
    expect(s).toMatchObject({ key: 'date', dir: 'asc' });
    const seen = [UPDATE_SORTS[0]!.label, s.label];
    for (let i = 2; i < UPDATE_SORTS.length; i++) seen.push((s = nextSort(UPDATE_SORTS, s)).label);
    expect(seen).toEqual(UPDATE_SORTS.map((o) => o.label));
    expect(nextSort(UPDATE_SORTS, s)).toBe(UPDATE_SORTS[0]);
  });

  it('starts over when the current sort is not offered', () => {
    const unread = updateSorts('unread');
    expect(unread.some((o) => o.key === 'status')).toBe(false);
    expect(nextSort(unread, { key: 'status', dir: 'asc' })).toBe(unread[0]);
    expect(updateSorts('saved').some((o) => o.key === 'status')).toBe(true);
  });

  it('labels and detects the default', () => {
    expect(sortLabel(TOPIC_SORTS, undefined)).toBe('Most important first');
    expect(sortLabel(UPDATE_SORTS, { key: 'title', dir: 'desc' })).toBe('Title Z→A');
    expect(isDefaultSort(UPDATE_SORTS, { key: 'date', dir: 'desc' })).toBe(true);
    expect(isDefaultSort(UPDATE_SORTS, { key: 'date', dir: 'asc' })).toBe(false);
  });
});

describe('compareUpdates', () => {
  const list = [
    upd('a', { source: 'beta', title: 'Zed', datePublished: '2026-01-02', status: 'read' }),
    upd('b', { source: 'alpha', title: 'apple', datePublished: '2026-01-03' }),
    upd('c', { source: 'beta', title: 'Mango', datePublished: '2026-01-01' }),
  ];
  const ids = (sort?: Parameters<typeof compareUpdates>[0]) => [...list].sort(compareUpdates(sort)).map((u) => u.id);

  it('sorts by date both ways', () => {
    expect(ids()).toEqual(['b', 'a', 'c']);
    expect(ids({ key: 'date', dir: 'asc' })).toEqual(['c', 'a', 'b']);
  });

  it('sorts by source, newest first within a source', () => {
    expect(ids({ key: 'source', dir: 'asc' })).toEqual(['b', 'a', 'c']);
    expect(ids({ key: 'source', dir: 'desc' })).toEqual(['a', 'c', 'b']);
  });

  it('sorts by title ignoring case', () => {
    expect(ids({ key: 'title', dir: 'asc' })).toEqual(['b', 'c', 'a']);
    expect(ids({ key: 'title', dir: 'desc' })).toEqual(['a', 'c', 'b']);
  });

  it('puts unread first', () => {
    expect(ids({ key: 'status', dir: 'asc' })).toEqual(['b', 'c', 'a']);
  });
});

describe('sortDigestEntries', () => {
  const entries = [
    entry('low', '2026-01-03', 1, 'low', 'Charlie'),
    entry('high', '2026-01-01', 2, 'high', 'alpha'),
    entry('mid', '2026-01-02', 3, undefined, 'Bravo'),
  ];
  const ids = (sort?: Parameters<typeof sortDigestEntries>[1]) => sortDigestEntries(entries, sort).map((e) => e.topic.id);

  it('orders by importance (unrated counts as medium)', () => {
    expect(ids()).toEqual(['high', 'mid', 'low']);
    expect(ids({ key: 'importance', dir: 'asc' })).toEqual(['low', 'mid', 'high']);
  });

  it('orders by date, title and size', () => {
    expect(ids({ key: 'date', dir: 'desc' })).toEqual(['low', 'mid', 'high']);
    expect(ids({ key: 'date', dir: 'asc' })).toEqual(['high', 'mid', 'low']);
    expect(ids({ key: 'title', dir: 'asc' })).toEqual(['high', 'mid', 'low']);
    expect(ids({ key: 'size', dir: 'desc' })).toEqual(['mid', 'high', 'low']);
  });

  it('does not change the input', () => {
    sortDigestEntries(entries, { key: 'title', dir: 'desc' });
    expect(entries.map((e) => e.topic.id)).toEqual(['low', 'high', 'mid']);
  });
});

describe('reference sort', () => {
  const ref = (id: string, title: string, createdAt: string): Reference =>
    ({ id, title, url: `https://x/${id}`, folder: '', description: '', createdAt, updatedAt: createdAt });
  const refs = [ref('1', 'beta', '2026-01-01'), ref('2', 'Alpha', '2026-01-03'), ref('3', 'gamma', '2026-01-02')];
  const ids = (sort?: Parameters<typeof buildReferenceRows>[3]) =>
    buildReferenceRows(refs, new Set(), undefined, sort).map((r) => (r.kind === 'item' ? r.item.id : r.key));

  it('lists links by title, or by date added', () => {
    expect(ids()).toEqual(['2', '1', '3']);
    expect(ids(REFERENCE_SORTS[1])).toEqual(['3', '1', '2']);
    expect(ids({ key: 'added', dir: 'desc' })).toEqual(['2', '3', '1']);
    expect(ids({ key: 'added', dir: 'asc' })).toEqual(['1', '3', '2']);
  });
});

describe('sortTodos', () => {
  const todo = (id: string, extra: Partial<Todo>): Todo =>
    ({ id, subject: id, description: '', status: 'pending', folder: '', createdAt: '2026-01-01', updatedAt: 't', ...extra });
  const todos = [
    todo('done', { status: 'done', dueDate: '2026-02-01', createdAt: '2026-01-03' }),
    todo('noDue', { createdAt: '2026-01-02' }),
    todo('soon', { status: 'in_progress', dueDate: '2026-01-15', subject: 'Alpha' }),
    todo('later', { dueDate: '2026-03-01', subject: 'beta', createdAt: '2026-01-04' }),
  ];
  const ids = (sort?: Parameters<typeof sortTodos>[1]) => sortTodos(todos, sort).map((t) => t.id);

  it('defaults to status, then due date', () => {
    expect(ids()).toEqual(['later', 'noDue', 'soon', 'done']);
  });

  it('sorts by due date with undated todos last', () => {
    expect(ids(TODO_SORTS[1])).toEqual(['soon', 'done', 'later', 'noDue']);
    expect(ids(TODO_SORTS[2])).toEqual(['later', 'done', 'soon', 'noDue']);
  });

  it('sorts by creation and subject', () => {
    expect(ids({ key: 'created', dir: 'desc' })).toEqual(['later', 'done', 'noDue', 'soon']);
    expect(ids({ key: 'subject', dir: 'asc' })).toEqual(['soon', 'later', 'done', 'noDue']);
  });
});
