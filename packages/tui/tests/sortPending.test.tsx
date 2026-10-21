import React, { act } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type DigestEntry, type ListOptions, type Todo, type Update } from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import { App } from '../src/ui/App.js';
import { createMemoryAuditLog } from '../src/audit.js';

type FakeStdin = PassThrough & { isTTY: boolean; setRawMode(on: boolean): void; ref(): void; unref(): void };

function upd(id: string, title: string, source: string, datePublished: string, extra: Partial<Update> = {}): Update {
  return { id, source, title, url: `https://x/${id}`, datePublished, dateAdded: datePublished, status: 'unread', saved: false, content: 'body', ...extra };
}

const UPDATES = [
  upd('a', 'Banana news', 'zeta', '2026-01-03'),
  upd('b', 'Apple news', 'alpha', '2026-01-01'),
  upd('c', 'Cherry news', 'mid', '2026-01-02'),
];

function solo(u: Update, importance: 'high' | 'low'): DigestEntry {
  return {
    topic: { id: `t-${u.id}`, title: u.title, summary: '', highlights: [], importance, createdAt: 't', updatedAt: 't' },
    items: [u], latestDate: u.datePublished, sources: [u.source], synthetic: false,
  };
}

const TODOS: Todo[] = [
  { id: 't1', subject: 'Zulu task', description: '', status: 'pending', createdAt: '2026-01-01', updatedAt: 't' },
  { id: 't2', subject: 'Alpha task', description: '', status: 'done', createdAt: '2026-01-02', updatedAt: 't' },
];

let columns: PropertyDescriptor | undefined;
let unmount: (() => void) | undefined;

beforeEach(() => {
  columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  Object.defineProperty(process.stdout, 'columns', { value: 200, configurable: true });
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  if (columns) Object.defineProperty(process.stdout, 'columns', columns);
  else delete (process.stdout as { columns?: number }).columns;
});

async function renderApp() {
  const listCalls: ListOptions[] = [];
  const service = {
    getSettings: async () => ({ ...DEFAULT_SETTINGS }),
    getSources: async () => [],
    // Newest first, like the store: Banana (high), Cherry (low), Apple (high)
    getDigest: async () => ({
      entries: [solo(UPDATES[0]!, 'high'), solo(UPDATES[1]!, 'high'), solo(UPDATES[2]!, 'low')],
      pending: 0,
    }),
    listUpdates: vi.fn(async (opts: ListOptions = {}) => {
      listCalls.push(opts);
      const { compareUpdates } = await import('@fomo/core');
      const updates = [...UPDATES].sort(compareUpdates(opts.sort));
      return { updates, total: updates.length, hasMore: false };
    }),
    getStats: async () => ({ total: 3, byStatus: { unread: 3, read: 0 }, bySource: {}, saved: 0 }),
    setSaved: vi.fn(async (id: string, saved: boolean) => ({ ...UPDATES.find((u) => u.id === id)!, saved })),
    fetchContent: vi.fn(async (id: string) => ({ ...UPDATES.find((u) => u.id === id)!, content: 'full' })),
    getUpdate: async (id: string) => UPDATES.find((u) => u.id === id)!,
    listTodos: async () => ({ todos: TODOS }),
  };
  const stdin = new PassThrough() as FakeStdin;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = new PassThrough();
  let frame = '';
  stdout.on('data', (chunk: Buffer) => { frame = chunk.toString(); });
  await act(async () => {
    const instance = render(
      <App
        service={service as unknown as FomoDirectService}
        config={{}}
        onConfigChange={() => undefined}
        audit={createMemoryAuditLog()}
        auditFile="/tmp/audit.log"
        listAccounts={async () => []}
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
  const press = async (key: string) => {
    await act(async () => {
      stdin.write(key);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  };
  /** Titles in the order they appear in the frame. */
  const order = (...titles: string[]) => titles.map((t) => frame.indexOf(t)).every((i, n, all) => i >= 0 && (n === 0 || all[n - 1]! < i));
  return { service, listCalls, press, frame: () => frame, order };
}

describe('Pending (p)', () => {
  it('labels view 4 Pending and toggles the selected update with p in a list', async () => {
    const { service, press, frame } = await renderApp();
    expect(frame()).toContain('4 Pending');
    await press('1');
    await press('p');
    expect(service.setSaved).toHaveBeenCalledWith('a', true);
    expect(frame()).toContain('Marked pending');
  });

  it('marks a single-update topic pending with p', async () => {
    const { service, press } = await renderApp();
    await press('P');
    expect(service.setSaved).toHaveBeenCalledWith('a', true);
  });
});

describe('fetch full content (u)', () => {
  it('fetches with u in the detail view; p no longer does', async () => {
    UPDATES[0]!.content = '';
    try {
      const { service, press } = await renderApp();
      await press('1');
      await press('\r');
      await press('p');
      expect(service.fetchContent).not.toHaveBeenCalled();
      await press('u');
      expect(service.fetchContent).toHaveBeenCalledWith('a');
    } finally {
      UPDATES[0]!.content = 'body';
    }
  });
});

describe('sort (s)', () => {
  it('cycles a list’s sort, reloads it in that order and remembers it per view', async () => {
    const { listCalls, press, frame, order } = await renderApp();
    await press('1');
    expect(order('Banana news', 'Cherry news', 'Apple news')).toBe(true);
    await press('s');
    expect(listCalls.at(-1)?.sort).toMatchObject({ key: 'date', dir: 'asc' });
    expect(frame()).toContain('Oldest first');
    expect(order('Apple news', 'Cherry news', 'Banana news')).toBe(true);
    await press('S');
    await press('s');
    expect(listCalls.at(-1)?.sort).toMatchObject({ key: 'source', dir: 'desc' });

    await press('3');
    expect(listCalls.at(-1)?.sort).toBeUndefined();
    await press('1');
    expect(listCalls.at(-1)?.sort).toMatchObject({ key: 'source', dir: 'desc' });
    expect(frame()).toContain('↕ Source Z→A');
  });

  it('keeps the selected update selected when the order changes', async () => {
    const { service, press } = await renderApp();
    await press('1');
    await press('j'); // Cherry
    await press('s'); // oldest first: Apple, Cherry, Banana
    await press('s'); // source A→Z: alpha (Apple), mid (Cherry), zeta (Banana)
    await press('p');
    expect(service.setSaved).toHaveBeenCalledWith('c', true);
  });

  it('sorts topic views without reloading', async () => {
    const { press, frame, order } = await renderApp();
    expect(order('Banana news', 'Apple news', 'Cherry news')).toBe(true);
    await press('s');
    expect(frame()).toContain('Least important first');
    expect(order('Cherry news', 'Banana news', 'Apple news')).toBe(true);
    await press('s');
    await press('s'); // oldest first
    expect(order('Apple news', 'Cherry news', 'Banana news')).toBe(true);
  });

  it('sorts todos', async () => {
    const { press, order, frame } = await renderApp();
    await press('6');
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(order('Zulu task', 'Alpha task')).toBe(true);
    for (let i = 0; i < 4; i++) await press('s');
    expect(frame()).toContain('Subject A→Z');
    expect(order('Alpha task', 'Zulu task')).toBe(true);
  });
});
