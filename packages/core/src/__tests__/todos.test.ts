import { describe, it, expect } from 'vitest';
import {
  buildTodoRows,
  daysUntil,
  dueDateError,
  dueHint,
  dueLabel,
  dueTone,
  isOverdue,
  matchesTodo,
  matchesTodoFilter,
  nextTodoFilter,
  nextTodoStatus,
  parseDueDate,
  toIsoDate,
  todoCounts,
  todoFilterLabel,
  type TodoRow,
} from '../todos.js';
import { TodoStore } from '../store/tables.js';
import type { Todo } from '../types.js';

function todo(id: string, folder: string, extra: Partial<Todo> = {}): Todo {
  return { id, subject: id, description: '', status: 'pending', folder, createdAt: '2026-01-01', updatedAt: 't', ...extra };
}

// Wednesday 4 March 2026, mid-afternoon local time.
const NOW = new Date(2026, 2, 4, 15, 30);

describe('todo status and filter', () => {
  it('cycles the status', () => {
    expect(nextTodoStatus('pending')).toBe('in_progress');
    expect(nextTodoStatus('in_progress')).toBe('done');
    expect(nextTodoStatus('done')).toBe('pending');
  });

  it('cycles the filter', () => {
    expect(nextTodoFilter('all')).toBe('open');
    expect(nextTodoFilter('open')).toBe('in_progress');
    expect(nextTodoFilter('in_progress')).toBe('done');
    expect(nextTodoFilter('done')).toBe('all');
    expect(todoFilterLabel('in_progress')).toBe('In progress');
    expect(todoFilterLabel('nope' as any)).toBe('All');
  });

  it('filters by status, open being anything not done', () => {
    const [pending, doing, done] = [todo('a', ''), todo('b', '', { status: 'in_progress' }), todo('c', '', { status: 'done' })];
    expect([pending, doing, done].map((t) => matchesTodoFilter(t, 'open'))).toEqual([true, true, false]);
    expect([pending, doing, done].map((t) => matchesTodoFilter(t, 'in_progress'))).toEqual([false, true, false]);
    expect([pending, doing, done].map((t) => matchesTodoFilter(t, 'done'))).toEqual([false, false, true]);
    expect([pending, doing, done].map((t) => matchesTodoFilter(t))).toEqual([true, true, true]);
  });

  it('searches the subject, description and folder', () => {
    const t = todo('x', 'work', { subject: 'Write report', description: 'Q3 numbers' });
    expect(matchesTodo(t, 'REPORT q3')).toBe(true);
    expect(matchesTodo(t, 'work write')).toBe(true);
    expect(matchesTodo(t, 'report home')).toBe(false);
    expect(matchesTodo(t, '  ')).toBe(true);
  });

  it('searches multiline notes and attachment references', () => {
    const t = todo('x', '', { description: 'First line\nSecond line', attachments: ['https://example.com/report', '~/Documents/budget.pdf'] });
    expect(matchesTodo(t, 'first second')).toBe(true);
    expect(matchesTodo(t, 'REPORT budget')).toBe(true);
    expect(matchesTodo(t, 'missing.pdf')).toBe(false);
  });
});

describe('buildTodoRows', () => {
  const todos = [
    todo('report', 'work', { dueDate: '2026-03-10' }),
    todo('bug', 'work/eng', { status: 'in_progress' }),
    todo('ship', 'work/eng', { status: 'done' }),
    todo('groceries', '', { description: 'milk eggs' }),
    todo('taxes', 'home', { status: 'done' }),
  ];
  const show = (rows: TodoRow[]) =>
    rows.map((r) => (r.kind === 'folder' ? `${'  '.repeat(r.depth)}${r.name}/ ${r.done}/${r.count}${r.open ? ' ▾' : ''}` : `${'  '.repeat(r.depth)}${r.item.id}`));

  it('lists folders with their progress, then todos by status', () => {
    expect(show(buildTodoRows(todos, new Set(['work'])))).toEqual([
      'home/ 1/1',
      'work/ 1/3 ▾',
      '  eng/ 1/2',
      '  report',
      'groceries',
    ]);
    expect(show(buildTodoRows(todos, new Set(['work', 'work/eng'])))).toContain('    bug');
  });

  it('lists only the todos of a filter, dropping folders left empty', () => {
    expect(show(buildTodoRows(todos, new Set(['work', 'work/eng']), { filter: 'open' }))).toEqual([
      'work/ 0/2 ▾',
      '  eng/ 0/1 ▾',
      '    bug',
      '  report',
      'groceries',
    ]);
    expect(buildTodoRows(todos, new Set(), { filter: 'done' }).map((r) => r.key)).toEqual(['folder:home', 'folder:work']);
  });

  it('opens every folder holding a match while searching', () => {
    expect(buildTodoRows(todos, new Set(), { search: 'milk' }).map((r) => r.key)).toEqual(['todo:groceries']);
    expect(show(buildTodoRows(todos, new Set(), { search: 'eng' }))).toEqual(['work/ 1/2 ▾', '  eng/ 1/2 ▾', '    bug', '    ship']);
    expect(show(buildTodoRows(todos, new Set(), { search: 'eng', filter: 'done' }))).toEqual(['work/ 1/1 ▾', '  eng/ 1/1 ▾', '    ship']);
  });

  it('orders the todos of a folder by the chosen sort', () => {
    const rows = buildTodoRows(todos, new Set(['work', 'work/eng']), { sort: { key: 'subject', dir: 'desc' } });
    expect(rows.filter((r) => r.kind === 'item').map((r) => r.key)).toEqual(['todo:ship', 'todo:bug', 'todo:report', 'todo:groceries']);
  });
});

describe('due dates', () => {
  it('writes local dates', () => {
    expect(toIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('counts the days until a due date', () => {
    expect(daysUntil('2026-03-04', NOW)).toBe(0);
    expect(daysUntil('2026-03-01', NOW)).toBe(-3);
    expect(daysUntil('2026-04-04', NOW)).toBe(31);
    expect(daysUntil('2026-02-30', NOW)).toBeUndefined();
    expect(daysUntil(undefined, NOW)).toBeUndefined();
  });

  it('flags open todos past their due date', () => {
    expect(isOverdue({ dueDate: '2026-03-03', status: 'pending' }, NOW)).toBe(true);
    expect(isOverdue({ dueDate: '2026-03-03', status: 'done' }, NOW)).toBe(false);
    expect(isOverdue({ dueDate: '2026-03-04', status: 'in_progress' }, NOW)).toBe(false);
    expect(isOverdue({ status: 'pending' }, NOW)).toBe(false);
  });

  it('labels a due date relative to today', () => {
    expect(dueLabel('2026-03-01', NOW)).toBe('3d overdue');
    expect(dueLabel('2026-03-04', NOW)).toBe('today');
    expect(dueLabel('2026-03-05', NOW)).toBe('tomorrow');
    expect(dueLabel('2026-03-17', NOW)).toBe('in 13d');
    expect(dueLabel('2026-03-18', NOW)).toBe('Mar 18');
    expect(dueLabel('2027-01-02', NOW)).toBe("Jan 2 '27");
    expect(dueLabel(undefined, NOW)).toBe('');
    expect(dueLabel('soon', NOW)).toBe('');
  });

  it('understands dates, offsets and weekdays', () => {
    expect(parseDueDate(' 2026-03-20 ', NOW)).toBe('2026-03-20');
    expect(parseDueDate('Today', NOW)).toBe('2026-03-04');
    expect(parseDueDate('tom', NOW)).toBe('2026-03-05');
    expect(parseDueDate('tmr', NOW)).toBe('2026-03-05');
    expect(parseDueDate('3', NOW)).toBe('2026-03-07');
    expect(parseDueDate('+3', NOW)).toBe('2026-03-07');
    expect(parseDueDate('30d', NOW)).toBe('2026-04-03');
    expect(parseDueDate('2w', NOW)).toBe('2026-03-18');
    expect(parseDueDate('fri', NOW)).toBe('2026-03-06');
    expect(parseDueDate('Monday', NOW)).toBe('2026-03-09');
    expect(parseDueDate('wed', NOW)).toBe('2026-03-11');
    expect(parseDueDate('  ', NOW)).toBe('');
  });

  it('rejects what it does not understand', () => {
    expect(parseDueDate('2026-02-30', NOW)).toBeUndefined();
    expect(parseDueDate('th', NOW)).toBeUndefined();
    expect(parseDueDate('someday', NOW)).toBeUndefined();
    expect(parseDueDate('3x', NOW)).toBeUndefined();
  });

  it('tells how pressing a due date is', () => {
    expect(dueTone({ dueDate: '2026-03-01', status: 'pending' }, NOW)).toBe('overdue');
    expect(dueTone({ dueDate: '2026-03-04', status: 'in_progress' }, NOW)).toBe('soon');
    expect(dueTone({ dueDate: '2026-03-05', status: 'pending' }, NOW)).toBe('soon');
    expect(dueTone({ dueDate: '2026-03-06', status: 'pending' }, NOW)).toBe('later');
    expect(dueTone({ dueDate: '2026-03-01', status: 'done' }, NOW)).toBe('later');
    expect(dueTone({ status: 'pending' }, NOW)).toBe('later');
  });

  it('hints how a typed due date is read', () => {
    expect(dueHint('  ', NOW)).toBeUndefined();
    expect(dueHint('fri', NOW)).toEqual({ text: '→ 2026-03-06 · in 2d' });
    expect(dueHint(' 2026-03-05 ', NOW)).toEqual({ text: '· tomorrow' });
    expect(dueHint('someday', NOW)).toEqual({ text: 'not a date', error: true });
    expect(dueDateError(' someday ')).toBe('Not a date: someday — try 2026-03-06, fri, +3 or 2w');
  });
});

describe('todoCounts', () => {
  it('counts open, done and overdue todos', () => {
    const todos = [
      todo('late', '', { dueDate: '2026-03-01' }),
      todo('busy', '', { status: 'in_progress', dueDate: '2026-03-02' }),
      todo('soon', 'work', { dueDate: '2026-03-05' }),
      todo('shipped', 'work', { status: 'done', dueDate: '2026-02-01' }),
    ];
    expect(todoCounts(todos, NOW)).toEqual({ open: 3, done: 1, overdue: 2 });
    expect(todoCounts([], NOW)).toEqual({ open: 0, done: 0, overdue: 0 });
  });
});

describe('TodoStore folders and colors', () => {
  const conn = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=dGVzdA==;TableEndpoint=http://localhost:10002/devstoreaccount1;';

  function storeWith(rows: Record<string, unknown>[]) {
    const store = new TodoStore(conn as any);
    const calls = { created: [] as any[], updated: [] as any[] };
    (store as any).client = {
      listEntities: () => (async function* () { yield* rows; })(),
      getEntity: async (_pk: string, rk: string) => ({ ...rows.find((r) => r.rowKey === rk), etag: 'e1' }),
      createEntity: async (e: any) => { calls.created.push(e); },
      updateEntity: async (e: any, mode: string) => { calls.updated.push({ ...e, mode }); },
    };
    return { store, calls };
  }

  const row = (rowKey: string, folder?: string, extra: Record<string, unknown> = {}) => ({
    partitionKey: 'todo', rowKey, subject: rowKey, description: '', dueDate: '', status: 'pending',
    ...(folder === undefined ? {} : { folder }), createdAt: 't', updatedAt: 't', ...extra,
  });

  it('files a new todo in a clean folder, with a clean color', async () => {
    const { store, calls } = storeWith([]);
    const created = await store.createTodo({ subject: 'S', folder: ' work / eng ', color: '#ABC' });
    expect(created).toMatchObject({ folder: 'work/eng', color: '#aabbcc', status: 'pending' });
    expect(calls.created[0]).toMatchObject({ partitionKey: 'todo', folder: 'work/eng', color: '#aabbcc' });
    expect(await store.createTodo({ subject: 'Plain' })).not.toHaveProperty('color');
    await expect(store.createTodo({ subject: 'Bad', color: 'red' })).rejects.toThrow(/Not a color/);
  });

  it('reads todos stored before folders at the top level', async () => {
    const { store } = storeWith([row('old'), row('new', 'home', { color: '#ff0000' })]);
    const { todos } = await store.listTodos();
    expect(todos.map((t) => [t.id, t.folder, t.color])).toEqual([['old', '', undefined], ['new', 'home', '#ff0000']]);
    expect(todos[0]).not.toHaveProperty('attachments');
  });

  it('stores multiline notes and attachment references, not file contents', async () => {
    const { store, calls } = storeWith([]);
    const description = 'First line\n\n  Indented second line';
    const attachments = ['https://example.com/report', '~/Documents/a file.pdf'];
    const created = await store.createTodo({ subject: 'Report', description, attachments });
    expect(created).toMatchObject({ description, attachments });
    expect(calls.created[0]).toMatchObject({ description, attachments: JSON.stringify(attachments) });
    await expect(store.createTodo({ subject: 'Bad', attachments: ['javascript:alert(1)'] })).rejects.toThrow(/support/);
    expect(calls.created).toHaveLength(1);
  });

  it('reads, replaces, preserves and clears attachments independently of other fields', async () => {
    const attachments = ['https://example.com/report', '/tmp/report.pdf'];
    const { store, calls } = storeWith([row('a', 'work', { attachments: JSON.stringify(attachments), description: 'Line 1\nLine 2' })]);
    expect(await store.getTodo('a')).toMatchObject({ attachments, description: 'Line 1\nLine 2' });
    expect((await store.listTodos()).todos[0]).toMatchObject({ attachments });
    expect(await store.updateTodo('a', { status: 'done' })).toMatchObject({ attachments, description: 'Line 1\nLine 2' });
    expect(await store.updateTodo('a', { attachments: ['~/new.txt'] })).toMatchObject({ attachments: ['~/new.txt'] });
    expect(await store.updateTodo('a', { attachments: [], description: '' })).not.toHaveProperty('attachments');
    expect(calls.updated.at(-1)).toMatchObject({ attachments: '[]', description: '', mode: 'Replace' });
  });

  it('reports corrupted stored attachment data instead of silently losing it', async () => {
    for (const attachments of ['not JSON', '{"path":"a"}', '[42]', '["javascript:alert(1)"]']) {
      const { store } = storeWith([row('bad', '', { attachments })]);
      await expect(store.getTodo('bad')).rejects.toThrow();
    }
  });

  it('moves, recolors and clears through an update', async () => {
    const { store, calls } = storeWith([row('a', 'work', { color: '#ff0000' })]);
    const updated = await store.updateTodo('a', { folder: 'home/', color: '' });
    expect(updated.folder).toBe('home');
    expect(updated).not.toHaveProperty('color');
    expect(calls.updated[0]).toMatchObject({ folder: 'home', color: '', mode: 'Replace' });
    const kept = await store.updateTodo('a', { subject: 'Renamed' });
    expect(kept).toMatchObject({ subject: 'Renamed', folder: 'work', color: '#ff0000' });
  });

  it('moves a folder with its subfolders', async () => {
    const { store, calls } = storeWith([row('a', 'work'), row('b', 'work/eng'), row('c', 'workshop'), row('d', '')]);
    expect(await store.moveFolder('work', 'job')).toBe(2);
    expect(calls.updated.map((u) => `${u.rowKey}:${u.folder}:${u.mode}`)).toEqual(['a:job:Merge', 'b:job/eng:Merge']);
    expect(await store.moveFolder('work', ' work ')).toBe(0);
    await expect(store.moveFolder('work', 'work/sub')).rejects.toThrow(/into itself/);
    await expect(store.moveFolder('', 'x')).rejects.toThrow(/Pick a folder/);
  });
});
