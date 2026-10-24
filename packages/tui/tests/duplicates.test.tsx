import React, { act, type ComponentProps } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@fomo/core';
import type { DigestEntry, Update } from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import { App } from '../src/ui/App.js';
import { createMemoryAuditLog } from '../src/audit.js';
import { DetailPane, duplicateRows } from '../src/ui/components/DetailPane.js';

const post = (id: string, over: Partial<Update> = {}): Update => ({
  id,
  source: id.slice(0, id.indexOf('__')),
  title: `Post ${id}`,
  url: `https://example.com/${id}`,
  datePublished: '2026-10-01T00:00:00Z',
  dateAdded: '2026-10-01T00:00:00Z',
  status: 'read',
  saved: false,
  content: '',
  summary: '',
  ...over,
});

const ORIGINAL = post('hn__a', { title: 'Alpha original' });
const UNRELATED = post('hn__b', { title: 'Beta unrelated' });
const COPY = post('yt__c', { title: 'Gamma copy', duplicateOf: ORIGINAL.id });
const COPY_2 = post('hn__d', { title: 'Delta copy', duplicateOf: ORIGINAL.id });

const plain = (text: string) => text.replace(/\u001B\[[0-9;]*m/g, '');
const times = (text: string, part: string) => text.split(part).length - 1;

describe('duplicateRows', () => {
  it('takes a divider, two rows per entry and one for the rest', () => {
    expect(duplicateRows(0, 20)).toEqual({ shown: 0, rows: 0 });
    expect(duplicateRows(1, 20)).toEqual({ shown: 1, rows: 3 });
    expect(duplicateRows(2, 20)).toEqual({ shown: 2, rows: 5 });
    expect(duplicateRows(3, 20)).toEqual({ shown: 2, rows: 6 });
  });

  it('lists fewer entries when there is less room, and none when not even one fits', () => {
    expect(duplicateRows(3, 5)).toEqual({ shown: 1, rows: 4 });
    expect(duplicateRows(1, 3)).toEqual({ shown: 1, rows: 3 });
    expect(duplicateRows(1, 2)).toEqual({ shown: 0, rows: 0 });
    expect(duplicateRows(3, 3)).toEqual({ shown: 0, rows: 0 });
  });
});

describe('DetailPane duplicates', () => {
  const labels: Record<string, string> = { hn: 'Hacker News', yt: 'YouTube' };

  function pane(props: Partial<ComponentProps<typeof DetailPane>> & { update: Update }): string {
    const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 40 }) as unknown as NodeJS.WriteStream;
    let out = '';
    stdout.on('data', (chunk) => { out = String(chunk); });
    const app = render(
      <DetailPane height={20} columns={100} labelOf={(s) => labels[s] ?? s} {...props} />,
      { stdout, debug: true, patchConsole: false },
    );
    app.unmount();
    return plain(out);
  }

  const withContent = (update: Update) => ({ ...update, content: 'The body of the post' });

  it('links a copy to its original, with the source and whether d can jump to it', () => {
    const out = pane({ update: withContent(COPY), duplicates: [ORIGINAL], listed: new Set([ORIGINAL.id]) });
    expect(out).toContain('duplicates');
    expect(out).toMatch(/original\s+Hacker News\s+other source\s+26-10-01\s+d jump/);
    expect(out).toContain('Alpha original');
    expect(out).toContain('The body of the post');
  });

  it('links an original to its copies, and says when they are not in this view', () => {
    const out = pane({ update: withContent(ORIGINAL), duplicates: [COPY, COPY_2], listed: new Set([COPY_2.id]) });
    expect(out).toMatch(/duplicate\s+YouTube\s+other source\s+26-10-01\s+not in this view/);
    expect(out).toMatch(/duplicate\s+Hacker News\s+26-10-01\s+d jump/);
    // Only a copy from a source other than the original's is marked
    expect(times(out, 'other source')).toBe(1);
    expect(out).toContain('Gamma copy');
    expect(out).toContain('Delta copy');
  });

  it('counts the entries it has no room for', () => {
    const copies = [COPY, COPY_2, post('yt__e', { title: 'Epsilon copy', duplicateOf: ORIGINAL.id })];
    const out = pane({ update: withContent(ORIGINAL), duplicates: copies });
    expect(out).toContain('Gamma copy');
    expect(out).toContain('Delta copy');
    expect(out).not.toContain('Epsilon copy');
    expect(out).toContain('+1 more');
  });

  it('shows nothing extra without duplicates', () => {
    const out = pane({ update: withContent(ORIGINAL) });
    expect(out).not.toContain('duplicates');
    expect(out).toContain('The body of the post');
  });

  it('drops the block on a pane too short for it, and keeps the preview', () => {
    const out = pane({ update: withContent(COPY), duplicates: [ORIGINAL], height: 8 });
    expect(out).not.toContain('Alpha original');
    expect(out).toContain('The body of the post');
  });

  it('also fits beside the list', () => {
    const out = pane({ update: withContent(COPY), duplicates: [ORIGINAL], position: 'right' });
    expect(out).toContain('Alpha original');
    expect(out).toContain('The body of the post');
  });
});

type FakeStdin = PassThrough & { isTTY: boolean; setRawMode(on: boolean): void; ref(): void; unref(): void };

const entry = (id: string, items: Update[]): DigestEntry => ({
  topic: { id, title: `Topic ${id}`, summary: '' },
  items,
  latestDate: '2026-10-01T00:00:00Z',
  sources: [...new Set(items.map((u) => u.source))],
  synthetic: false,
}) as unknown as DigestEntry;

function makeService(over: Record<string, unknown> = {}) {
  return {
    getSettings: async () => ({ ...DEFAULT_SETTINGS }),
    getSources: async () => [],
    getDigest: async () => ({ entries: [], pending: 0 }),
    listUpdates: async () => ({ updates: [], total: 0 }),
    getStats: async () => ({ total: 0, byStatus: { unread: 0, read: 0 }, bySource: {}, saved: 0 }),
    getUpdate: async (id: string) => ({ ...post(id), content: 'The full text' }),
    getDuplicates: async () => [],
    ...over,
  } as unknown as FomoDirectService;
}

/** The read view is a plain list: it shows `updates`. */
const listOf = (updates: Update[]) => makeService({ listUpdates: async () => ({ updates, total: updates.length }) });

let columns: PropertyDescriptor | undefined;
let rows: PropertyDescriptor | undefined;
let unmount: (() => void) | undefined;

beforeEach(() => {
  columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  Object.defineProperty(process.stdout, 'columns', { value: 200, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: 40, configurable: true });
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  if (columns) Object.defineProperty(process.stdout, 'columns', columns);
  else delete (process.stdout as { columns?: number }).columns;
  if (rows) Object.defineProperty(process.stdout, 'rows', rows);
  else delete (process.stdout as { rows?: number }).rows;
});

async function renderApp(service: FomoDirectService) {
  const audit = createMemoryAuditLog();
  const stdin = new PassThrough() as FakeStdin;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = Object.assign(new PassThrough(), { columns: 200, rows: 40 });
  let last = '';
  stdout.on('data', (chunk: Buffer) => { last = chunk.toString(); });
  await act(async () => {
    const instance = render(
      <App
        service={service}
        config={{}}
        onConfigChange={() => undefined}
        digest={async () => ({ processed: 0, remaining: 0, created: 0, updated: 0, errors: [] })}
        audit={audit}
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
  const press = async (key: string) => {
    await act(async () => {
      stdin.write(key);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  };
  const frame = () => plain(last);
  /** The row with the selection bar. */
  const selected = () => frame().split('\n').find((line) => line.includes('▎')) ?? '';
  return { audit, press, frame, selected };
}

describe('d jumps to the duplicate', () => {
  it('goes from an update to its copy and back in a list', async () => {
    const { press, selected } = await renderApp(listOf([ORIGINAL, UNRELATED, COPY]));
    await press('3');
    expect(selected()).toContain('Alpha original');
    await press('d');
    expect(selected()).toContain('Gamma copy');
    await press('d');
    expect(selected()).toContain('Alpha original');
  });

  it('cycles through all copies of the post', async () => {
    const { press, selected } = await renderApp(listOf([ORIGINAL, UNRELATED, COPY, COPY_2]));
    await press('3');
    await press('d');
    expect(selected()).toContain('Gamma copy');
    await press('d');
    expect(selected()).toContain('Delta copy');
    await press('d');
    expect(selected()).toContain('Alpha original');
  });

  it('says so when the update has no duplicate in the list, and stays where it is', async () => {
    const { press, frame, selected } = await renderApp(listOf([ORIGINAL, UNRELATED, COPY]));
    await press('3');
    await press('j');
    await press('d');
    expect(frame()).toContain('No duplicate in this view');
    expect(selected()).toContain('Beta unrelated');
  });

  it('says so when the other record is not in the list', async () => {
    const { press, frame, selected } = await renderApp(listOf([UNRELATED, COPY]));
    await press('3');
    await press('j');
    await press('d');
    expect(frame()).toContain('No duplicate in this view');
    expect(selected()).toContain('Gamma copy');
  });

  it('opens the topic that holds the duplicate in the grouped view', async () => {
    const entries = [entry('t1', [ORIGINAL, UNRELATED]), entry('t2', [COPY])];
    const { press, frame, selected } = await renderApp(makeService({ getDigest: async () => ({ entries, pending: 0 }) }));
    await press('j');
    expect(selected()).toContain('Gamma copy');
    expect(frame()).not.toContain('Beta unrelated');

    await press('d');
    expect(selected()).toContain('Alpha original');
    expect(frame()).toContain('Beta unrelated');

    await press('d');
    expect(selected()).toContain('Gamma copy');
  });

  it('asks to expand a topic first when it is a collapsed group', async () => {
    const entries = [entry('t1', [ORIGINAL, UNRELATED]), entry('t2', [COPY])];
    const { press, frame, selected } = await renderApp(makeService({ getDigest: async () => ({ entries, pending: 0 }) }));
    expect(selected()).toContain('Topic t1');
    await press('d');
    expect(frame()).toContain('Expand the topic');
    expect(selected()).toContain('Topic t1');
  });
});

describe('the preview lists the duplicates', () => {
  it('shows the original of the copy, also when it is not in the list', async () => {
    const getDuplicates = vi.fn(async (_id: string) => [ORIGINAL]);
    const { press, frame, audit } = await renderApp(makeService({
      listUpdates: async () => ({ updates: [UNRELATED, COPY], total: 2 }),
      getDuplicates,
    }));
    await press('3');
    await press('j');
    expect(getDuplicates).not.toHaveBeenCalled();

    await press('\r');
    expect(getDuplicates).toHaveBeenCalledWith(COPY.id);
    expect(frame()).toMatch(/original\s+hn\s+other source/);
    expect(frame()).toContain('not in this view');
    expect(frame()).toContain('Alpha original');
    expect(audit.entries).toEqual([]);
  });

  it('says that d jumps when the other record is listed', async () => {
    const { press, frame } = await renderApp(makeService({
      listUpdates: async () => ({ updates: [ORIGINAL, COPY], total: 2 }),
      getDuplicates: async (id: string) => (id === ORIGINAL.id ? [COPY] : [ORIGINAL]),
    }));
    await press('3');
    await press('\r');
    expect(frame()).toMatch(/duplicate\s+yt\s+other source[^\n]*d jump/);

    await press('d');
    expect(frame()).toMatch(/original\s+hn\s+other source[^\n]*d jump/);
  });

  it('shows the duplicates of the update selected in the grouped view', async () => {
    const entries = [entry('t1', [ORIGINAL, UNRELATED]), entry('t2', [COPY])];
    const getDuplicates = vi.fn(async (id: string) => (id === COPY.id ? [ORIGINAL] : []));
    const { press, frame } = await renderApp(makeService({ getDigest: async () => ({ entries, pending: 0 }), getDuplicates }));
    await press('j');
    await press('\r');
    expect(getDuplicates).toHaveBeenCalledWith(COPY.id);
    expect(frame()).toMatch(/original\s+hn\s+other source[^\n]*d jump/);
  });

  it('reads them again when the number of updates changes, as after a fetch', async () => {
    let total = 2;
    const getDuplicates = vi.fn(async (_id: string) => [COPY]);
    const { press } = await renderApp(makeService({
      listUpdates: async () => ({ updates: [ORIGINAL, UNRELATED], total: 2 }),
      getStats: async () => ({ total, byStatus: { unread: 0, read: 0 }, bySource: {}, saved: 0 }),
      getDuplicates,
    }));
    await press('3');
    await press('\r');
    expect(getDuplicates).toHaveBeenCalledTimes(1);

    await press('3');
    expect(getDuplicates).toHaveBeenCalledTimes(1);

    total = 3;
    await press('3');
    expect(getDuplicates).toHaveBeenCalledTimes(2);
    expect(getDuplicates).toHaveBeenLastCalledWith(ORIGINAL.id);
  });

  it('keeps working when the duplicates cannot be read', async () => {
    const { press, frame, audit } = await renderApp(makeService({
      listUpdates: async () => ({ updates: [ORIGINAL, COPY], total: 2 }),
      getDuplicates: async () => { throw new Error('table unavailable'); },
    }));
    await press('3');
    await press('\r');
    expect(frame()).not.toContain('duplicates');
    expect(frame()).toContain('Alpha original');
    expect(audit.entries).toContainEqual(expect.objectContaining({ level: 'error', action: 'duplicates', detail: expect.stringContaining('table unavailable') }));
  });
});
