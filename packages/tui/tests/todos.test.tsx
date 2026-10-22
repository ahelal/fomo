import React, { act } from 'react';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLOR_PALETTE,
  DEFAULT_SETTINGS,
  isInFolder,
  moveFolderColors,
  moveFolderPath,
  moveInGrid,
  paletteIndex,
  setFolderColor,
  toIsoDate,
  type CreateTodoRequest,
  type FolderColorMap,
  type Todo,
  type UpdateTodoRequest,
} from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import { App } from '../src/ui/App.js';
import { createMemoryAuditLog } from '../src/audit.js';
import { TODO_FOLDER_COLOR, TODO_ITEM_COLOR } from '../src/ui/hooks/useTodos.js';
import { openTodoAttachment } from '../src/attachments.js';

vi.mock('../src/attachments.js', () => ({ openTodoAttachment: vi.fn() }));

type FakeStdin = PassThrough & { isTTY: boolean; setRawMode(on: boolean): void; ref(): void; unref(): void };

const ENTER = '\r';
const ESC = '\u001B';
const TAB = '\t';
const DOWN = '\u001B[B';
const RIGHT = '\u001B[C';
const LEFT = '\u001B[D';
const CTRL_U = '\u0015';
const CTRL_S = '\u0013';
const UP = '\u001B[A';

/** The color the picker lands on after one → from `start`. */
const rightOf = (start: string) => COLOR_PALETTE[moveInGrid(paletteIndex(start), 'right')]!;

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

function todo(id: string, subject: string, folder: string, extra: Partial<Todo> = {}): Todo {
  return { id, subject, folder, description: '', status: 'pending', createdAt: `2026-10-0${id.slice(-1)}T00:00:00Z`, updatedAt: 't', ...extra };
}

function fakeService(initial: Todo[], initialColors: FolderColorMap = {}) {
  let todos = [...initial];
  let folderColors = { ...initialColors };
  return {
    getSettings: async () => ({ ...DEFAULT_SETTINGS }),
    getSources: async () => [],
    getDigest: async () => ({ entries: [], pending: 0 }),
    listUpdates: vi.fn(async (_query: { status?: string; saved?: boolean }) => ({ updates: [], total: 0 })),
    getStats: async () => ({ total: 0, byStatus: { unread: 0, read: 0 }, bySource: {}, saved: 0 }),
    listTodos: vi.fn(async () => ({ todos, folderColors })),
    createTodo: vi.fn(async (req: CreateTodoRequest) => {
      const created = todo(`n${todos.length + 1}`, req.subject, req.folder ?? '', { ...req, folder: req.folder ?? '', description: req.description ?? '' });
      todos = [...todos, created];
      return created;
    }),
    updateTodo: vi.fn(async (id: string, patch: UpdateTodoRequest) => {
      todos = todos.map((t) => (t.id === id ? { ...t, ...patch, color: patch.color === '' ? undefined : patch.color ?? t.color } : t));
      return todos.find((t) => t.id === id)!;
    }),
    deleteTodo: vi.fn(async (id: string) => { todos = todos.filter((t) => t.id !== id); }),
    moveTodoFolder: vi.fn(async (from: string, to: string) => {
      const moved = todos.filter((t) => isInFolder(t.folder, from)).length;
      todos = todos.map((t) => ({ ...t, folder: moveFolderPath(t.folder, from, to) }));
      folderColors = moveFolderColors(folderColors, from, to);
      return moved;
    }),
    setTodoFolderColor: vi.fn(async (folder: string, color: string) => {
      folderColors = setFolderColor(folderColors, folder, color);
      return folderColors;
    }),
  };
}

let columns: PropertyDescriptor | undefined;
let terminalRows: PropertyDescriptor | undefined;
let unmount: (() => void) | undefined;

beforeEach(() => {
  vi.mocked(openTodoAttachment).mockReset().mockResolvedValue(undefined);
  columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  terminalRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  Object.defineProperty(process.stdout, 'columns', { value: 160, configurable: true });
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  if (columns) Object.defineProperty(process.stdout, 'columns', columns);
  else delete (process.stdout as { columns?: number }).columns;
  if (terminalRows) Object.defineProperty(process.stdout, 'rows', terminalRows);
  else delete (process.stdout as { rows?: number }).rows;
});

async function renderApp(todos: Todo[], folderColors?: FolderColorMap) {
  const svc = fakeService(todos, folderColors);
  const stdin = new PassThrough() as FakeStdin;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = new PassThrough();
  let frame = '';
  stdout.on('data', (chunk: Buffer) => { frame = chunk.toString(); });
  await act(async () => {
    const instance = render(
      <App
        service={svc as unknown as FomoDirectService}
        config={{}}
        onConfigChange={() => undefined}
        audit={createMemoryAuditLog()}
        auditFile="/tmp/audit.log"
      />,
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: new PassThrough() as unknown as NodeJS.WriteStream,
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
    unmount = () => instance.unmount();
  });
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      await act(async () => {
        stdin.write(key);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  };
  return { svc, press, frame: () => frame };
}

const LIST = [
  todo('t1', 'Write report', 'work'),
  todo('t2', 'Ship release', 'work', { status: 'done' }),
  todo('t3', 'Buy milk', '', { dueDate: daysFromNow(-2) }),
];

describe('6 Todos view', () => {
  it('keeps the tab and folder state when pressing 6, Esc or Backspace again', async () => {
    const { press, frame } = await renderApp(LIST);
    await press('6');
    expect(frame()).toContain('✓ Todos');
    expect(frame()).toContain('2 open');
    expect(frame()).toContain('1 overdue');
    expect(frame()).toContain('1 done');
    expect(frame()).toMatch(/▾ work\/\s+1\/2/);
    expect(frame()).toContain('2d overdue');
    await press(ENTER); // closes the work folder
    expect(frame()).toMatch(/▸ work\//);
    expect(frame()).not.toContain('Write report');
    await press('6', ESC, '\u007f', '\u001b[3~');
    expect(frame()).toContain('✓ Todos');
    expect(frame()).toMatch(/▸ work\//);
    expect(frame()).not.toContain('[6] close');
  });

  it('switches straight to another view with its number, but types it in the form', async () => {
    const { svc, press, frame } = await renderApp(LIST);
    await press('6', 'a', '1', ENTER);
    expect(svc.createTodo).toHaveBeenCalledWith(expect.objectContaining({ subject: '1' }));
    expect(frame()).toContain('✓ Todos');
    svc.listUpdates.mockClear();
    await press('1');
    expect(frame()).not.toContain('✓ Todos');
    expect(svc.listUpdates).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'all' }));
  });

  it('steps into and out of folders with → and ←', async () => {
    const { press, frame } = await renderApp(LIST);
    await press('6');
    expect(frame()).toContain('work/ · 1 of 2 done');
    await press(RIGHT); // into the open work/ folder
    expect(frame()).toMatch(/\[↵\] → /);
    await press(LEFT); // back up to work/
    expect(frame()).toContain('work/ · 1 of 2 done');
    await press(LEFT); // and close it
    expect(frame()).toMatch(/▸ work\//);
    expect(frame()).not.toContain('Write report');
    await press(RIGHT); // open it again
    expect(frame()).toMatch(/▾ work\//);
    expect(frame()).toContain('Write report');
  });

  it('steps the status with ↵ and toggles done with x', async () => {
    const { svc, press, frame } = await renderApp(LIST);
    await press('6', DOWN); // work/ → Write report
    await press(ENTER);
    expect(svc.updateTodo).toHaveBeenLastCalledWith('t1', { status: 'in_progress' });
    expect(frame()).toContain('In progress: “Write report”');
    await press('x');
    expect(svc.updateTodo).toHaveBeenLastCalledWith('t1', { status: 'done' });
    await press('X');
    expect(svc.updateTodo).toHaveBeenLastCalledWith('t1', { status: 'pending' });
  });

  it('shows open, in-progress or done todos with v', async () => {
    const { press, frame } = await renderApp(LIST);
    await press('6', 'v');
    expect(frame()).toContain('showing Open');
    expect(frame()).toContain('Write report');
    expect(frame()).not.toContain('Ship release');
    await press('v', 'v');
    expect(frame()).toContain('showing Done');
    expect(frame()).toContain('Ship release');
    expect(frame()).not.toContain('Buy milk');
    await press('v');
    expect(frame()).not.toContain('showing');
    expect(frame()).toContain('Buy milk');
  });

  it('renames a folder with its todos and its color', async () => {
    const { svc, press, frame } = await renderApp(LIST, { work: '#3fb950' });
    await press('6', 'e', CTRL_U, ...'job', ENTER);
    expect(svc.moveTodoFolder).toHaveBeenCalledWith('work', 'job');
    expect(frame()).toContain('Moved 2 todos to job');
    expect(frame()).toMatch(/▾ job\//);
  });

  it('deletes a todo only on the second d', async () => {
    const { svc, press, frame } = await renderApp([todo('t1', 'Old chore', '')]);
    await press('6', 'd');
    expect(frame()).toContain('d again to delete “Old chore”');
    expect(svc.deleteTodo).not.toHaveBeenCalled();
    await press('d');
    expect(svc.deleteTodo).toHaveBeenCalledWith('t1');
    expect(frame()).toContain('No todos yet');
  });

  it('searches todos with /', async () => {
    const { press, frame } = await renderApp(LIST);
    await press('6', '/', ...'milk', ENTER);
    expect(frame()).toContain('Buy milk');
    expect(frame()).not.toContain('Write report');
    await press('6');
    expect(frame()).not.toContain('Write report');
    await press(ESC);
    expect(frame()).toContain('Write report');
    await press(ESC);
    expect(frame()).toContain('✓ Todos');
  });

  it('cancels add and rename prompts without leaving the Todos tab', async () => {
    const { press, frame } = await renderApp(LIST);
    await press('6', 'a', ESC);
    expect(frame()).toContain('✓ Todos');
    expect(frame()).not.toContain('Add todo');
    await press('e', ESC);
    expect(frame()).toContain('Write report');
    expect(frame()).not.toContain('Move work/ to:');
  });
});

describe('c colors folders and todos with the picker', () => {
  it('colors a folder, then a todo with a typed hex, then resets the todo', async () => {
    const { svc, press, frame } = await renderApp(LIST);
    await press('6', 'c');
    expect(frame()).toContain('Pick a color · folder work/');
    await press(RIGHT, ENTER);
    expect(svc.setTodoFolderColor).toHaveBeenCalledWith('work', rightOf(TODO_FOLDER_COLOR));
    expect(frame()).toContain('✓ Colored work/');
    expect(frame()).not.toContain('Pick a color');

    await press(DOWN, 'c');
    expect(frame()).toContain('Pick a color · “Write report”');
    expect(frame()).toContain('folder color');
    await press('#', CTRL_U, ...'#123456', ENTER);
    expect(svc.updateTodo).toHaveBeenLastCalledWith('t1', { color: '#123456' });
    expect(frame()).toContain('✓ Colored “Write report”');

    await press('c', 'd');
    expect(svc.updateTodo).toHaveBeenLastCalledWith('t1', { color: '' });
    expect(frame()).toContain('“Write report” has no color of its own now');
  });

  it('cancels with Esc, and q in the picker does not quit', async () => {
    const { svc, press, frame } = await renderApp(LIST);
    await press('6', 'c', 'q', RIGHT, ESC);
    expect(frame()).not.toContain('Pick a color');
    expect(frame()).toContain('✓ Todos'); // Esc only closed the picker
    expect(svc.setTodoFolderColor).not.toHaveBeenCalled();
  });
});

describe('a adds a todo', () => {
  it('in the selected folder, with a due date read from text and a picked color', async () => {
    const { svc, press, frame } = await renderApp(LIST);
    await press('6', 'a');
    expect(frame()).toContain('Add todo');
    await press(...'Plan sprint quickly', TAB, ...'tomorrow');
    expect(frame()).toContain(`→ ${daysFromNow(1)} · tomorrow`);
    await press(TAB); // folder, prefilled from the selected folder
    expect(frame()).toMatch(/Folder:\s+work/);
    await press(TAB, ...'notes', TAB, TAB, ENTER);
    expect(frame()).toContain('Pick a color · “Plan sprint quickly”');
    await press(RIGHT, ENTER);
    expect(frame()).toContain('Add todo');
    expect(frame()).toMatch(/›Subject:/); // focus moved on, so ↵ saves
    await press(ENTER);
    expect(svc.createTodo).toHaveBeenCalledWith({
      subject: 'Plan sprint quickly',
      description: 'notes',
      folder: 'work',
      dueDate: daysFromNow(1),
      color: rightOf(TODO_ITEM_COLOR),
    });
    expect(frame()).toContain('✓ Added in work');
    expect(frame()).toContain('Plan sprint quickly');
  });

  it('refuses a due date it cannot read', async () => {
    const { svc, press, frame } = await renderApp([]);
    await press('6');
    expect(frame()).toContain('No todos yet. Press a to add one.');
    await press('a', ...'Call', TAB, ...'someday');
    expect(frame()).toContain('not a date');
    await press(ENTER);
    expect(frame()).toContain('Not a date: someday');
    expect(svc.createTodo).not.toHaveBeenCalled();
  });

  it('edits a todo with e, keeping what is not changed', async () => {
    const { svc, press } = await renderApp([todo('t1', 'Draft', 'notes', { dueDate: '2026-12-01', color: '#3fb950' })]);
    await press('6', DOWN, 'e', ...' v2', ENTER);
    expect(svc.updateTodo).toHaveBeenCalledWith('t1', {
      subject: 'Draft v2',
      description: '',
      folder: 'notes',
      dueDate: '2026-12-01',
      color: '#3fb950',
      attachments: [],
    });
  });

  it('preserves multiline notes and saves URL/path references with Ctrl+S', async () => {
    const { svc, press, frame } = await renderApp([]);
    await press('6', 'a', 'Report', TAB, TAB, TAB, 'First line', ENTER, 'Second line');
    expect(svc.createTodo).not.toHaveBeenCalled();
    expect(frame()).toContain('First line');
    expect(frame()).toContain('Second line');
    await press(TAB, 'https://example.com/report', ENTER, '~/Documents/a file.pdf', CTRL_S);
    expect(svc.createTodo).toHaveBeenCalledWith({
      subject: 'Report', folder: '', description: 'First line\nSecond line',
      attachments: ['https://example.com/report', '~/Documents/a file.pdf'],
    });
    expect(frame()).toContain('✓ Added in top level');
  });

  it('pastes multiline notes without flattening them and edits at the cursor', async () => {
    const { svc, press } = await renderApp([]);
    await press('6', 'a', 'Notes', TAB, TAB, TAB, 'first\nsecond', UP, '\u0001', 'intro ', CTRL_S);
    expect(svc.createTodo).toHaveBeenCalledWith(expect.objectContaining({ description: 'intro first\nsecond' }));
  });

  it('clears optional notes and attachments without changing the other fields', async () => {
    const { svc, press } = await renderApp([todo('t1', 'Report', '', { description: 'old\nnotes', attachments: ['~/old.pdf'] })]);
    await press('6', 'e', TAB, TAB, TAB, CTRL_U, TAB, CTRL_U, CTRL_S);
    expect(svc.updateTodo).toHaveBeenCalledWith('t1', {
      subject: 'Report', description: '', attachments: [], folder: '', dueDate: '', color: '',
    });
  });

  it('keeps invalid attachment input in the form with a visible error', async () => {
    const { svc, press, frame } = await renderApp([]);
    await press('6', 'a', 'Report', TAB, TAB, TAB, TAB, 'javascript:alert(1)', CTRL_S);
    expect(frame()).toContain('Attachments support http://, https:// and file paths only');
    expect(frame()).toContain('javascript:alert(1)');
    expect(svc.createTodo).not.toHaveBeenCalled();
  });

  it('keeps long notes within a short terminal and follows the editing cursor', async () => {
    Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true });
    const description = Array.from({ length: 60 }, (_, i) => `note line ${i + 1}`).join('\n');
    const { press, frame } = await renderApp([todo('t1', 'Long notes', '', { description })]);
    await press('6', 'e', TAB, TAB, TAB);
    expect(frame()).toContain('note line 60');
    expect(frame()).not.toContain('note line 1\n');
    expect(frame().trimEnd().split('\n').length).toBeLessThanOrEqual(24);
    await press(...Array.from({ length: 59 }, () => UP));
    expect(frame()).toContain('note line 1');
    expect(frame()).not.toContain('note line 60');
    expect(frame().trimEnd().split('\n').length).toBeLessThanOrEqual(24);
  });
});

describe('Tab completes attachment paths', () => {
  let dir: string;
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fomo-todo-paths-'));
    await mkdir(join(dir, 'notebook'));
    await writeFile(join(dir, 'notes.md'), '');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists matches as you type, extends the common prefix, then cycles', async () => {
    const { svc, press, frame } = await renderApp([]);
    await press('6', 'a', 'Report', TAB, TAB, TAB, TAB, ...`${dir}/no`);
    await settle();
    expect(frame()).toContain('⇥ (2) notebook/  notes.md');
    await press(TAB);
    await settle();
    expect(frame()).toContain(`${dir}/note`);
    await press(TAB);
    await settle();
    expect(frame()).toContain(`${dir}/notebook/`);
    await press(TAB);
    await settle();
    await press(CTRL_S);
    expect(svc.createTodo).toHaveBeenCalledWith(expect.objectContaining({ attachments: [`${dir}/notes.md`] }));
  });

  it('moves to the next field once the path is complete', async () => {
    const { svc, press, frame } = await renderApp([]);
    await press('6', 'a', 'Report', TAB, TAB, TAB, TAB, ...`${dir}/notes.m`, TAB);
    await settle();
    expect(frame()).toContain(`${dir}/notes.md`);
    await press(TAB);
    await settle();
    expect(frame()).toContain('↵ pick');
    await press(CTRL_S);
    expect(svc.createTodo).toHaveBeenCalledWith(expect.objectContaining({ attachments: [`${dir}/notes.md`] }));
  });

  it('leaves URL lines to Tab field navigation', async () => {
    const { press, frame } = await renderApp([]);
    await press('6', 'a', 'Report', TAB, TAB, TAB, TAB, ...'https://exa', TAB);
    await settle();
    expect(frame()).toContain('↵ pick');
  });
});

describe('o opens todo attachments', () => {
  const attached = todo('t1', 'Report', '', { attachments: ['https://example.com/report', '~/Documents/a file.pdf'] });

  it('selects and opens individual references only after confirmation', async () => {
    const { svc, press, frame } = await renderApp([attached]);
    await press('6', 'o');
    expect(frame()).toContain('Attachments · Report');
    expect(openTodoAttachment).not.toHaveBeenCalled();
    await press('6');
    expect(frame()).toContain('Attachments · Report');
    await press(DOWN, ENTER);
    expect(openTodoAttachment).toHaveBeenLastCalledWith('~/Documents/a file.pdf');
    await press(UP, ENTER);
    expect(openTodoAttachment).toHaveBeenLastCalledWith('https://example.com/report');
    expect(svc.updateTodo).not.toHaveBeenCalled();
    await press(ESC);
    expect(frame()).not.toContain('Attachments · Report');
    expect(frame()).toContain('✓ Todos');
  });

  it('reports failed file launches and keeps the picker usable', async () => {
    const { press, frame } = await renderApp([attached]);
    vi.mocked(openTodoAttachment).mockRejectedValueOnce(new Error('File not found'));
    await press('6', 'o', DOWN, ENTER);
    expect(frame()).toContain('Error: File not found');
    expect(frame()).toContain('Attachments · Report');
  });

  it('does not hijack view-number shortcuts', async () => {
    const { svc, press, frame } = await renderApp([attached]);
    await press('6', 'o', '1');
    expect(frame()).not.toContain('Attachments · Report');
    expect(svc.listUpdates).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'all' }));
  });

  it('explains how to add attachments when there are none', async () => {
    const { press, frame } = await renderApp([todo('t1', 'Plain', '')]);
    await press('6', 'o');
    expect(frame()).toContain('No attachments — e to add URLs or file paths');
    expect(openTodoAttachment).not.toHaveBeenCalled();
  });
});
