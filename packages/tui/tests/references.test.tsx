import React, { act } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COLOR_PALETTE, DEFAULT_SETTINGS, deleteFolderEntries, isInFolder, parentFolder, type DeleteFolderMode, moveFolderColors, moveFolderMetadata, moveFolderPath, moveInGrid, paletteIndex, setFolderColor, type FolderColorMap, type FolderMetadata, type FolderMetadataMap, type Reference, type Update } from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import { App } from '../src/ui/App.js';
import { createMemoryAuditLog } from '../src/audit.js';
import { folderMatches, REF_FOLDER_COLOR, REF_ITEM_COLOR } from '../src/ui/hooks/useReferences.js';

type FakeStdin = PassThrough & { isTTY: boolean; setRawMode(on: boolean): void; ref(): void; unref(): void };

const ENTER = '\r';
const ESC = '\u001B';
const TAB = '\t';
const DOWN = '\u001B[B';
const CTRL_G = '\u0007';
const SHIFT_DOWN = '\u001B[1;2B';
const SHIFT_UP = '\u001B[1;2A';
const RIGHT = '\u001B[C';
const LEFT = '\u001B[D';
const CTRL_U = '\u0015';

/** The color the picker lands on after one → from `start`. */
const rightOf = (start: string) => COLOR_PALETTE[moveInGrid(paletteIndex(start), 'right')]!;

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
  let folderColors: FolderColorMap = {};
  let folderMetadata: FolderMetadataMap = {};
  const svc = {
    getSettings: async () => ({ ...DEFAULT_SETTINGS }),
    getSources: async () => [],
    getDigest: async () => ({ entries: [], pending: 0 }),
    listUpdates: vi.fn(async (_query: { status?: string; saved?: boolean }) => ({ updates, total: updates.length })),
    getStats: async () => ({ total: 1, byStatus: { unread: 1, read: 0 }, bySource: {}, saved: 0 }),
    listReferences: vi.fn(async () => ({ references: refs, folderColors, folderMetadata })),
    listTodos: async () => ({ todos: [], folderColors: {} }),
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
      folderColors = moveFolderColors(folderColors, from, to);
      folderMetadata = moveFolderMetadata(folderMetadata, from, to);
      return moved;
    }),
    deleteReferenceFolder: vi.fn(async (folder: string, mode: DeleteFolderMode) => {
      const inside = refs.filter((r) => isInFolder(r.folder, folder));
      refs = mode === 'all'
        ? refs.filter((r) => !isInFolder(r.folder, folder))
        : refs.map((r) => ({ ...r, folder: moveFolderPath(r.folder, folder, parentFolder(folder)) }));
      folderColors = deleteFolderEntries(folderColors, folder, mode, moveFolderColors);
      folderMetadata = deleteFolderEntries(folderMetadata, folder, mode, moveFolderMetadata);
      return inside.length;
    }),
    setReferenceFolderColor: vi.fn(async (folder: string, color: string) => {
      folderColors = setFolderColor(folderColors, folder, color);
      return folderColors;
    }),
    setReferenceFolderMetadata: vi.fn(async (folder: string, metadata: FolderMetadata) => {
      folderMetadata = { ...folderMetadata, [folder]: metadata };
      return folderMetadata;
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

describe('5 Bookmarks view', () => {
  const library = [ref('1', 'Agents guide', 'ai/agents'), ref('2', 'Prompting', 'ai'), ref('3', 'Bicep docs', 'azure')];

  it('keeps the tab and its folder state when pressing 5, Esc or Backspace again', async () => {
    const { press, frame } = await renderApp(library);
    await press('5');
    expect(frame()).toContain('Bookmarks');
    expect(frame()).toContain('3 links');
    expect(frame()).toMatch(/▾ ai\/ 2/);
    expect(frame()).toContain('Agents guide');
    await press(LEFT); // close the ai folder
    expect(frame()).toMatch(/▸ ai\/ 2/);
    expect(frame()).not.toContain('Agents guide');
    await press('5', ESC, '\u007f', '\u001b[3~');
    expect(frame()).toContain('3 links');
    expect(frame()).toMatch(/▸ ai\/ 2/);
    expect(frame()).not.toContain('[5] close');
  });

  it('shows messages in the status bar, so the tree never moves', async () => {
    const { press, frame } = await renderApp(library);
    await press('5');
    const line = (text: string) => frame().split('\n').findIndex((l) => l.includes(text));
    const before = line('Bicep docs');
    await press('c', RIGHT, ENTER);
    expect(frame()).toContain('✓ Colored ai/');
    expect(line('✓ Colored ai/')).toBeLessThan(line('Bookmarks'));
    expect(line('Bicep docs')).toBe(before);
  });

  it('switches straight to another view with its number, but not while typing', async () => {
    const { svc, press, frame } = await renderApp(library);
    await press('5', '3');
    expect(frame()).not.toContain('3 links');
    expect(svc.listUpdates).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'read' }));
    await press('5', '6');
    expect(frame()).toContain('✓ Todos');
    await press('5');
    expect(frame()).toContain('3 links');
    svc.listUpdates.mockClear();
    await press('/', '2'); // typed into the search prompt
    expect(svc.listUpdates).not.toHaveBeenCalled();
    await press(ESC, '1');
    expect(frame()).not.toContain('3 links');
    expect(svc.listUpdates).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'all' }));
  });

  it('searches links and renames a folder with its subfolders', async () => {
    const { svc, press, frame } = await renderApp(library);
    await press('5', '/', 'b', 'i', 'c', 'e', 'p', ENTER);
    expect(frame()).toContain('Bicep docs');
    expect(frame()).not.toContain('Prompting');
    await press('5');
    expect(frame()).not.toContain('Prompting');
    await press(ESC);
    expect(frame()).toContain('Prompting');
    await press(ESC);
    expect(frame()).toContain('3 links');
    await press('e', '\u0015', 'm', 'l', ENTER); // ^U clears the prefilled path
    expect(svc.moveReferenceFolder).toHaveBeenCalledWith('ai', 'ml');
    expect(frame()).toContain('Moved 2 links to ml');
    expect(frame()).toMatch(/▾ ml\/ 2/);
  });

  it('deletes a folder: p lifts its links and subfolders into the parent, a deletes them', async () => {
    const { svc, press, frame } = await renderApp(library);
    await press('5', 'd');
    expect(frame()).toContain('Delete ai/ (2 links, 1 subfolder)');
    await press('p');
    expect(svc.deleteReferenceFolder).toHaveBeenCalledWith('ai', 'parent');
    expect(frame()).toContain('Deleted ai/ — moved 2 links to the top level');
    expect(frame()).toMatch(/▾ agents\/ 1/);
    expect(frame()).toContain('Prompting');
    await press('d', 'a');
    expect(svc.deleteReferenceFolder).toHaveBeenLastCalledWith('agents', 'all');
    expect(frame()).toContain('Deleted agents/ and 1 link');
    expect(frame()).not.toContain('Agents guide');
  });

  it('keeps the delete-folder question open with the error when the store refuses', async () => {
    const { svc, press, frame } = await renderApp(library);
    svc.deleteReferenceFolder.mockRejectedValueOnce(new Error('Conflicting metadata for agents/'));
    await press('5', 'd', 'p');
    expect(frame()).toContain('⚠ Conflicting metadata for agents/');
    expect(frame()).toContain('Delete ai/');
    await press(ESC);
    expect(frame()).not.toContain('Delete ai/');
    expect(frame()).toMatch(/▾ ai\/ 2/);
  });

  it('cancels add and rename prompts without leaving the Bookmarks tab', async () => {
    const { press, frame } = await renderApp(library);
    await press('5', 'a', ESC);
    expect(frame()).toContain('3 links');
    await press('e', ESC);
    expect(frame()).toContain('3 links');
    expect(frame()).not.toContain('Edit folder');
  });

  it.each([ENTER, 'e'])('opens the shared folder editor with %j', async (key) => {
    const { svc, press, frame } = await renderApp(library);
    await press('5', key);
    expect(frame()).toContain('Edit folder · ai/');
    expect(frame()).toContain('Color:');
    expect(frame()).not.toContain('Type:');
    await press(CTRL_U, ...'ml', TAB, ...'~/src/ml', TAB, ...'owner/ml', TAB, ENTER, RIGHT, ENTER, ENTER);
    expect(svc.moveReferenceFolder).toHaveBeenCalledWith('ai', 'ml');
    expect(svc.setReferenceFolderMetadata).toHaveBeenCalledWith('ml', { localPath: '~/src/ml', githubRepo: 'owner/ml' });
    expect(svc.setReferenceFolderColor).toHaveBeenCalledWith('ml', rightOf(REF_FOLDER_COLOR));
    expect(frame()).toMatch(/▾ ml\/ 2/);
    await press(ENTER);
    expect(frame()).toContain('~/src/ml');
    expect(frame()).toContain('owner/ml');
  });

  it('does not save a picked folder color when the editor is cancelled', async () => {
    const { svc, press, frame } = await renderApp(library);
    await press('5', ENTER, TAB, TAB, TAB, ENTER, RIGHT, ENTER, ESC);
    expect(svc.setReferenceFolderColor).not.toHaveBeenCalled();
    expect(frame()).not.toContain('Edit folder');
  });

  it('keeps editing the moved folder after a metadata save failure', async () => {
    const { svc, press, frame } = await renderApp(library);
    svc.setReferenceFolderMetadata.mockRejectedValueOnce(new Error('Metadata save failed'));
    await press('5', ENTER, CTRL_U, ...'ml', TAB, ...'~/src/ml', ENTER);
    expect(frame()).toContain('Edit folder · ml/');
    expect(frame()).toContain('Metadata save failed');
    await press(ENTER);
    expect(svc.moveReferenceFolder).toHaveBeenCalledTimes(1);
    expect(svc.setReferenceFolderMetadata).toHaveBeenLastCalledWith('ml', { localPath: '~/src/ml' });
    expect(frame()).not.toContain('Edit folder');
  });

  it('uses Enter to edit a bookmark, leaving o to open it', async () => {
    const { svc, press, frame } = await renderApp([ref('1', 'Bookmark', '')]);
    await press('5', ENTER);
    expect(frame()).toContain('Edit bookmark');
    await press(CTRL_U, ...'work', ENTER);
    expect(svc.updateReference).toHaveBeenCalledWith('1', expect.objectContaining({ folder: 'work' }));
  });

  it('deletes a link only on the second d', async () => {
    const { svc, press, frame } = await renderApp([ref('1', 'Old link', '')]);
    await press('5', 'd');
    expect(svc.deleteReference).not.toHaveBeenCalled();
    expect(frame()).toContain('d again to delete');
    await press('d');
    expect(svc.deleteReference).toHaveBeenCalledWith('1');
    expect(frame()).toContain('No bookmarks yet');
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

  it('colors a folder and a link with the color picker (c)', async () => {
    const { svc, press, frame } = await renderApp(library);
    await press('5', 'c');
    expect(frame()).toContain('Pick a color · folder ai/');
    await press(RIGHT, ENTER);
    expect(svc.setReferenceFolderColor).toHaveBeenCalledWith('ai', rightOf(REF_FOLDER_COLOR));
    expect(frame()).toContain('✓ Colored ai/');
    await press(DOWN, DOWN, 'c'); // ai/ → agents/ → Agents guide
    expect(frame()).toContain('Pick a color · “Agents guide”');
    await press('#', CTRL_U, ...'#123456', ENTER);
    expect(svc.updateReference).toHaveBeenCalledWith('1', { color: '#123456' });
    expect(frame()).toContain('✓ Colored “Agents guide”');
  });

  it('picks a color in the add form, then ↵ saves', async () => {
    const { svc, press, frame } = await renderApp([]);
    await press('5', 'a', ...'https://c.dev', TAB, TAB, TAB, ENTER); // url → folder → description → color
    expect(frame()).toContain('Pick a color · this link');
    await press(RIGHT, ENTER, ENTER);
    expect(svc.createReference).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://c.dev', color: rightOf(REF_ITEM_COLOR) }));
  });

  it('sorts links within a folder with s', async () => {
    const top = [ref('1', 'Alpha', ''), { ...ref('2', 'Zulu', ''), createdAt: '2026-10-05T00:00:00Z' }];
    const { press, frame } = await renderApp(top);
    await press('5');
    expect(frame().indexOf('Alpha')).toBeLessThan(frame().indexOf('Zulu'));
    await press('s');
    expect(frame()).toContain('Title Z→A');
    expect(frame().indexOf('Zulu')).toBeLessThan(frame().indexOf('Alpha'));
  });
});

describe('b files the selected update', () => {
  it('prefills the form, lets Copilot pick the folder and saves it', async () => {
    const suggestion = { title: 'Agentic review', folder: 'ai/code-review', description: 'Copilot review calls tools.' };
    const { svc, suggestReference, press, frame } = await renderApp([ref('1', 'Agents guide', 'ai/agents')], async () => suggestion);
    await press('1', 'b');
    expect(suggestReference).toHaveBeenCalledWith({ updateId: 'github__1' });
    expect(frame()).toContain('File in Bookmarks');
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
    expect(frame()).toContain('Filed in Bookmarks → ai/code-review');
    expect(frame()).not.toContain('File in Bookmarks');
  });

  it('keeps what you typed and lets ^G replace it', async () => {
    let calls = 0;
    const { press, frame } = await renderApp([], async () => ({ title: '', folder: `pick${++calls}`, description: 'd' }));
    await press('1', 'b');
    expect(frame()).toContain('pick1');
    await press('\u0015', ...'mine');
    expect(frame()).toContain('mine');
    await press(CTRL_G);
    expect(frame()).toContain('pick2');
    await press(ESC);
    expect(frame()).not.toContain('File in Bookmarks');
  });

  it('edits the existing reference when the link is already filed', async () => {
    const { svc, press, frame } = await renderApp([ref('9', 'Saved before', 'tools', update.url)], async () => {
      throw new Error('should not be asked');
    });
    await press('1', 'b');
    expect(frame()).toContain('Edit bookmark');
    expect(frame()).toContain('Already in Bookmarks → tools');
    await press(ENTER);
    expect(svc.updateReference).toHaveBeenCalledWith('9', expect.objectContaining({ folder: 'tools' }));
    expect(svc.createReference).not.toHaveBeenCalled();
  });
});

describe('shortcuts ignore case', () => {
  it('5 opens Bookmarks; A adds and B files the update like b; typed text keeps its case', async () => {
    const { svc, press, frame } = await renderApp([ref('1', 'Agents guide', 'ai')]);
    await press('5');
    expect(frame()).toContain('1 link');
    await press('A', ...'https://x.dev', TAB, TAB, ...'Big NOTE', ENTER);
    expect(svc.createReference).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://x.dev', description: 'Big NOTE' }));
    await press('5', '1', 'B');
    expect(frame()).toContain('File in Bookmarks');
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
    await press('1', SHIFT_DOWN, 'b'); // b files the selected update, so the form shows its link
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
