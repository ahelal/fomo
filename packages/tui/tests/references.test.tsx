import React, { act } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, isInFolder, moveFolderPath, type Reference, type Update } from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import { App } from '../src/ui/App.js';
import { createMemoryAuditLog } from '../src/audit.js';
import { folderMatches } from '../src/ui/hooks/useReferences.js';

type FakeStdin = PassThrough & { isTTY: boolean; setRawMode(on: boolean): void; ref(): void; unref(): void };

const ENTER = '\r';
const ESC = '\u001B';
const TAB = '\t';
const DOWN = '\u001B[B';
const CTRL_G = '\u0007';
const SHIFT_DOWN = '\u001B[1;2B';
const SHIFT_UP = '\u001B[1;2A';

const update: Update = {
  id: 'github__1',
  source: 'github' as Update['source'],
  title: 'Copilot code review gets agentic tools',
  url: 'https://example.com/review',
  datePublished: '2026-10-01T00:00:00Z',
  dateAdded: '2026-10-01T00:00:00Z',
  status: 'unread',
  saved: false,
  content: '',
  summary: 'Review can call tools.',
};

function ref(id: string, title: string, folder: string, url = `https://example.com/${id}`): Reference {
  return { id, title, url, folder, description: `About ${title}`, createdAt: '2026-10-02T00:00:00Z', updatedAt: 'x' };
}

function fakeService(initial: Reference[], updates: Update[] = [update]) {
  let refs = [...initial];
  const svc = {
    getSettings: async () => ({ ...DEFAULT_SETTINGS }),
    getSources: async () => [],
    getDigest: async () => ({ entries: [], pending: 0 }),
    listUpdates: async () => ({ updates, total: updates.length }),
    getStats: async () => ({ total: 1, byStatus: { unread: 1, read: 0 }, bySource: {}, saved: 0 }),
    listReferences: vi.fn(async () => ({ references: refs })),
    createReference: vi.fn(async (req: Omit<Reference, 'id' | 'createdAt' | 'updatedAt'>) => {
      const created = { ...req, id: `new${refs.length}`, createdAt: '2026-10-03T00:00:00Z', updatedAt: 'x' } as Reference;
      refs = [...refs, created];
      return created;
    }),
    updateReference: vi.fn(async (id: string, patch: Partial<Reference>) => {
      refs = refs.map((r) => (r.id === id ? { ...r, ...patch } : r));
      return refs.find((r) => r.id === id)!;
    }),
    deleteReference: vi.fn(async (id: string) => { refs = refs.filter((r) => r.id !== id); }),
    moveReferenceFolder: vi.fn(async (from: string, to: string) => {
      const moved = refs.filter((r) => isInFolder(r.folder, from)).length;
      refs = refs.map((r) => ({ ...r, folder: moveFolderPath(r.folder, from, to) }));
      return moved;
    }),
  };
  return svc;
}

let columns: PropertyDescriptor | undefined;
let rows: PropertyDescriptor | undefined;
let unmount: (() => void) | undefined;

beforeEach(() => {
  columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  Object.defineProperty(process.stdout, 'columns', { value: 160, configurable: true });
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  if (columns) Object.defineProperty(process.stdout, 'columns', columns);
  else delete (process.stdout as { columns?: number }).columns;
  if (rows) Object.defineProperty(process.stdout, 'rows', rows);
  else delete (process.stdout as { rows?: number }).rows;
});

function setTerminalRows(value: number) {
  Object.defineProperty(process.stdout, 'rows', { value, configurable: true });
}

async function renderApp(
  refs: Reference[],
  suggest?: (req: unknown) => Promise<{ title: string; folder: string; description: string }>,
  summarize?: React.ComponentProps<typeof App>['summarize'],
  updates?: Update[],
) {
  const svc = fakeService(refs, updates);
  const suggestReference = suggest ? vi.fn(suggest) : undefined;
  const stdin = new PassThrough() as FakeStdin;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = Object.assign(new PassThrough(), { columns: 160, rows: 45 });
  let frame = '';
  stdout.on('data', (chunk: Buffer) => { frame = chunk.toString(); });
  await act(async () => {
    const instance = render(
      <App
        service={svc as unknown as FomoDirectService}
        config={{}}
        onConfigChange={() => undefined}
        suggestReference={suggestReference}
        summarize={summarize}
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
  return { svc, suggestReference, press, frame: () => frame };
}

describe('folderMatches', () => {
  it('lists folders containing the text, prefix matches first', () => {
    expect(folderMatches(['ai', 'ai/agents', 'azure', 'tools/ai'], 'ai')).toEqual(['ai', 'ai/agents', 'tools/ai']);
    expect(folderMatches(['b', 'a'], '')).toEqual(['b', 'a']);
  });
});

describe('5 References view', () => {
  const library = [ref('1', 'Agents guide', 'ai/agents'), ref('2', 'Prompting', 'ai'), ref('3', 'Bicep docs', 'azure')];

  it('shows the folder tree and closes with 5', async () => {
    const { press, frame } = await renderApp(library);
    await press('5');
    expect(frame()).toContain('References');
    expect(frame()).toContain('3 links');
    expect(frame()).toMatch(/▾ ai\/ 2/);
    expect(frame()).toContain('Agents guide');
    await press(ENTER); // close the ai folder
    expect(frame()).toMatch(/▸ ai\/ 2/);
    expect(frame()).not.toContain('Agents guide');
    await press('5');
    expect(frame()).not.toContain('3 links');
  });

  it('searches links and renames a folder with its subfolders', async () => {
    const { svc, press, frame } = await renderApp(library);
    await press('5', '/', 'b', 'i', 'c', 'e', 'p', ENTER);
    expect(frame()).toContain('Bicep docs');
    expect(frame()).not.toContain('Prompting');
    await press(ESC);
    expect(frame()).toContain('Prompting');
    await press('e', '\u0015', 'm', 'l', ENTER); // ^U clears the prefilled path
    expect(svc.moveReferenceFolder).toHaveBeenCalledWith('ai', 'ml');
    expect(frame()).toContain('Moved 2 links to ml');
    expect(frame()).toMatch(/▾ ml\/ 2/);
  });

  it('deletes a link only on the second d', async () => {
    const { svc, press, frame } = await renderApp([ref('1', 'Old link', '')]);
    await press('5', 'd');
    expect(svc.deleteReference).not.toHaveBeenCalled();
    expect(frame()).toContain('d again to delete');
    await press('d');
    expect(svc.deleteReference).toHaveBeenCalledWith('1');
    expect(frame()).toContain('No references yet');
  });

  it('adds a link in the selected folder; q is typed, not quit', async () => {
    const { svc, press, frame } = await renderApp(library);
    await press('5', DOWN, DOWN, DOWN); // ai/ → agents/ → Agents guide → Prompting (in ai)
    await press('a', ...'https://q.dev', TAB, TAB, ...'quick', ENTER);
    expect(svc.createReference).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://q.dev', folder: 'ai', description: 'quick' }),
    );
    expect(frame()).toContain('Filed in ai');
  });
});

describe('m files the selected update', () => {
  it('prefills the form, lets Copilot pick the folder and saves it', async () => {
    const suggestion = { title: 'Agentic review', folder: 'ai/code-review', description: 'Copilot review calls tools.' };
    const { svc, suggestReference, press, frame } = await renderApp([ref('1', 'Agents guide', 'ai/agents')], async () => suggestion);
    await press('1', 'm');
    expect(suggestReference).toHaveBeenCalledWith({ updateId: 'github__1' });
    expect(frame()).toContain('File in References');
    expect(frame()).toContain('Copilot code review gets agentic tools'); // feed title kept
    expect(frame()).toContain('ai/code-review');
    expect(frame()).toContain('Copilot suggested the folder, description');
    await press(ENTER);
    expect(svc.createReference).toHaveBeenCalledWith({
      title: 'Copilot code review gets agentic tools',
      url: 'https://example.com/review',
      folder: 'ai/code-review',
      description: 'Copilot review calls tools.',
      updateId: 'github__1',
    });
    expect(frame()).toContain('Filed in References → ai/code-review');
    expect(frame()).not.toContain('File in References');
  });

  it('keeps what you typed and lets ^G replace it', async () => {
    let calls = 0;
    const { press, frame } = await renderApp([], async () => ({ title: '', folder: `pick${++calls}`, description: 'd' }));
    await press('1', 'm');
    expect(frame()).toContain('pick1');
    await press('\u0015', ...'mine');
    expect(frame()).toContain('mine');
    await press(CTRL_G);
    expect(frame()).toContain('pick2');
    await press(ESC);
    expect(frame()).not.toContain('File in References');
  });

  it('edits the existing reference when the link is already filed', async () => {
    const { svc, press, frame } = await renderApp([ref('9', 'Saved before', 'tools', update.url)], async () => {
      throw new Error('should not be asked');
    });
    await press('1', 'm');
    expect(frame()).toContain('Edit reference');
    expect(frame()).toContain('Already in References → tools');
    await press(ENTER);
    expect(svc.updateReference).toHaveBeenCalledWith('9', expect.objectContaining({ folder: 'tools' }));
    expect(svc.createReference).not.toHaveBeenCalled();
  });
});

describe('shortcuts ignore case', () => {
  it('5 opens References; A adds and M files the update like m; typed text keeps its case', async () => {
    const { svc, press, frame } = await renderApp([ref('1', 'Agents guide', 'ai')]);
    await press('5');
    expect(frame()).toContain('1 link');
    await press('A', ...'https://x.dev', TAB, TAB, ...'Big NOTE', ENTER);
    expect(svc.createReference).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://x.dev', description: 'Big NOTE' }));
    await press('5', '1', 'M');
    expect(frame()).toContain('File in References');
  });
});

describe('Shift+↑/↓ jumps', () => {
  const many = Array.from({ length: 15 }, (_, i) => ref(String(i + 1), `Link ${String(i + 1).padStart(2, '0')}`, ''));

  it('5 rows on a small terminal; Shift+j still moves one row', async () => {
    setTerminalRows(24);
    const { press, frame } = await renderApp(many);
    await press('5', SHIFT_DOWN, 'd');
    expect(frame()).toContain('d again to delete “Link 06”');
    await press(SHIFT_DOWN, SHIFT_DOWN, SHIFT_DOWN, SHIFT_UP, 'd');
    expect(frame()).toContain('d again to delete “Link 10”');
    await press('J', 'd');
    expect(frame()).toContain('d again to delete “Link 11”');
  });

  it('10 rows on a tall terminal', async () => {
    setTerminalRows(45);
    const { press, frame } = await renderApp(many);
    await press('5', SHIFT_DOWN, 'd');
    expect(frame()).toContain('d again to delete “Link 11”');
  });

  it('jumps in the update list too', async () => {
    setTerminalRows(24);
    const feed = Array.from({ length: 12 }, (_, i) => {
      const n = String(i + 1).padStart(2, '0');
      return { ...update, id: `github__${n}`, title: `Update ${n}`, url: `https://example.com/u${n}`, datePublished: `2026-10-${28 - i}T00:00:00Z` };
    });
    const { press, frame } = await renderApp([], undefined, undefined, feed);
    await press('1', SHIFT_DOWN, 'm'); // m files the selected update, so the form shows its link
    expect(frame()).toContain('https://example.com/u06');
  });
});

describe('g summarises; g again regenerates', () => {
  it('shows the saved summary first and regenerates only on the next g', async () => {
    const gist = { summary: 'Review calls tools.', points: ['a', 'b', 'c'] };
    const summarize = vi.fn(async () => ({ update: { ...update, gist }, outcome: 'created' as const, from: 'page' as const }));
    const { press, frame } = await renderApp([], undefined, summarize);
    await press('1', 'g');
    expect(summarize).toHaveBeenLastCalledWith('github__1', false);
    await press('G'); // same as g: the summary is saved, so it only arms regenerate
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(frame()).toContain('g again regenerates it');
    await press('g');
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(summarize).toHaveBeenLastCalledWith('github__1', true);
  });
});
