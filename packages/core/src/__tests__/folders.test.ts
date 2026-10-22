import { describe, it, expect } from 'vitest';
import {
  buildFolderRows,
  folderColor,
  folderMatches,
  folderMove,
  folderPaths,
  isInFolder,
  moveFolderColors,
  moveFolderPath,
  normalizeFolder,
  parentFolder,
  parentRowIndex,
  rowFolder,
  setFolderColor,
  folderTreeStep,
  type FolderTreeOptions,
} from '../folders.js';

interface Note {
  id: string;
  folder: string;
  done?: boolean;
}

const note = (id: string, folder: string, done = false): Note => ({ id, folder, done });

const opts: FolderTreeOptions<Note> = {
  folder: (n) => n.folder,
  key: (n) => `note:${n.id}`,
  compare: (a, b) => a.id.localeCompare(b.id),
  isDone: (n) => !!n.done,
};

const label = (rows: ReturnType<typeof buildFolderRows<Note>>) =>
  rows.map((r) => (r.kind === 'folder' ? `${r.depth}:${r.name}/${r.done}of${r.count}${r.open ? '+' : ''}` : `${r.depth}:${r.item.id}`));

describe('folder paths', () => {
  it('normalizes separators and whitespace', () => {
    expect(normalizeFolder(' AI /  agents//tools ')).toBe('AI/agents/tools');
    expect(normalizeFolder('/')).toBe('');
    expect(normalizeFolder(undefined)).toBe('');
    expect(normalizeFolder('a/b/c/d/e/f/g/h')).toBe('a/b/c/d/e/f g h');
  });

  it('knows which folders contain which', () => {
    expect(isInFolder('ai/agents', 'ai')).toBe(true);
    expect(isInFolder('ai', 'ai')).toBe(true);
    expect(isInFolder('aids', 'ai')).toBe(false);
    expect(isInFolder('anything', '')).toBe(true);
  });

  it('moves subfolders along with a renamed folder', () => {
    expect(moveFolderPath('ai/agents/tools', 'ai/agents', 'agents')).toBe('agents/tools');
    expect(moveFolderPath('ai/agents', 'ai', 'ml')).toBe('ml/agents');
    expect(moveFolderPath('aids', 'ai', 'ml')).toBe('aids');
    expect(moveFolderPath('ai', 'ai', '')).toBe('');
  });

  it('checks a folder rename', () => {
    expect(folderMove(' ai/ ', 'ml / x')).toEqual({ from: 'ai', to: 'ml/x' });
    expect(folderMove('ai', 'ai/')).toBeUndefined();
    expect(folderMove('ai/agents', '')).toEqual({ from: 'ai/agents', to: '' });
    expect(() => folderMove('', 'x')).toThrow(/Pick a folder/);
    expect(() => folderMove('ai', 'ai/sub')).toThrow(/into itself/);
  });

  it('lists every folder in use with its ancestors', () => {
    expect(folderPaths([note('1', 'b/x'), note('2', ''), note('3', 'A'), note('4', 'b/x')])).toEqual(['A', 'b', 'b/x']);
  });

  it('offers matching folders, the ones starting with the text first', () => {
    const folders = ['agents', 'ai', 'ai/agents', 'azure', 'news/ai'];
    expect(folderMatches(folders, 'AI')).toEqual(['ai', 'ai/agents', 'news/ai']);
    expect(folderMatches(folders, ' ')).toEqual(folders);
    expect(folderMatches(folders, 'a', 2)).toEqual(['agents', 'ai']);
    expect(folderMatches(folders, 'zz')).toEqual([]);
  });
});

describe('folder colors', () => {
  it('inherits the closest parent color', () => {
    const colors = { ai: '#ff0000', 'ai/agents/tools': '#00ff00' };
    expect(folderColor(colors, 'ai')).toBe('#ff0000');
    expect(folderColor(colors, 'ai/agents')).toBe('#ff0000');
    expect(folderColor(colors, 'ai/agents/tools/x')).toBe('#00ff00');
    expect(folderColor(colors, 'aids')).toBeUndefined();
    expect(folderColor(colors, '')).toBeUndefined();
    expect(folderColor(undefined, 'ai')).toBeUndefined();
  });

  it('sets, cleans and clears a folder color', () => {
    const colors = setFolderColor({}, ' ai / agents ', '#ABC');
    expect(colors).toEqual({ 'ai/agents': '#aabbcc' });
    expect(setFolderColor(colors, 'ai/agents', '')).toEqual({});
    expect(() => setFolderColor(colors, '', '#fff')).toThrow(/top level/);
    expect(() => setFolderColor(colors, 'ai', 'red')).toThrow(/Not a color/);
  });

  it('moves colors with a renamed folder and its subfolders', () => {
    const colors = { ai: '#000001', 'ai/agents': '#000002', aids: '#000003', ml: '#000004' };
    expect(moveFolderColors(colors, 'ai', 'ml')).toEqual({ aids: '#000003', ml: '#000004', 'ml/agents': '#000002' });
    expect(moveFolderColors(colors, 'ai', 'new')).toEqual({ aids: '#000003', ml: '#000004', new: '#000001', 'new/agents': '#000002' });
    // Moved to the top level: the folder's own color goes, its subfolders keep theirs.
    expect(moveFolderColors(colors, 'ai', '')).toEqual({ aids: '#000003', ml: '#000004', agents: '#000002' });
    expect(moveFolderColors(colors, 'ai', 'ai')).toBe(colors);
  });
});

describe('buildFolderRows', () => {
  const notes = [note('z', ''), note('b', 'ai/agents', true), note('a', 'ai'), note('c', 'Azure', true), note('d', 'ai')];

  it('lists subfolders before items, opening only expanded folders', () => {
    expect(label(buildFolderRows(notes, new Set(['ai']), opts))).toEqual([
      '0:ai/1of3+',
      '1:agents/1of1',
      '1:a',
      '1:d',
      '0:Azure/1of1',
      '0:z',
    ]);
  });

  it('opens every folder with openAll, and drops folders left empty by include', () => {
    const rows = buildFolderRows(notes, new Set(), { ...opts, openAll: true, include: (n) => !n.done });
    expect(label(rows)).toEqual(['0:ai/0of2+', '1:a', '1:d', '0:z']);
    expect(rows.map((r) => r.key)).toEqual(['folder:ai', 'note:a', 'note:d', 'note:z']);
  });

  it('counts nothing as done without isDone', () => {
    const rows = buildFolderRows(notes, new Set(), { ...opts, isDone: undefined });
    expect(rows.filter((r) => r.kind === 'folder').map((r) => r.kind === 'folder' && r.done)).toEqual([0, 0]);
  });

  it('finds the folder and parent of a row', () => {
    const rows = buildFolderRows(notes, new Set(['ai', 'ai/agents']), opts);
    expect(label(rows).slice(0, 3)).toEqual(['0:ai/1of3+', '1:agents/1of1+', '2:b']);
    expect(rowFolder(rows[2])).toBe('ai/agents');
    expect(rowFolder(rows[1])).toBe('ai/agents');
    expect(rowFolder(undefined)).toBe('');
    expect(parentRowIndex(rows, 2)).toBe(1);
    expect(parentRowIndex(rows, 3)).toBe(0);
    expect(parentRowIndex(rows, 0)).toBe(-1);
  });

  it('names the folder holding a path', () => {
    expect(parentFolder('ai/agents/tools')).toBe('ai/agents');
    expect(parentFolder('ai')).toBe('');
    expect(parentFolder('')).toBe('');
  });
});

describe('folderTreeStep', () => {
  const notes = [note('z', ''), note('b', 'ai/agents'), note('a', 'ai'), note('c', 'Azure')];
  // 0 ai/ (open) · 1 agents/ (closed) · 2 a · 3 Azure/ (closed) · 4 z
  const rows = buildFolderRows(notes, new Set(['ai']), opts);

  it('opens and closes a folder with ↵', () => {
    expect(label(rows)).toEqual(['0:ai/0of2+', '1:agents/0of1', '1:a', '0:Azure/0of1', '0:z']);
    expect(folderTreeStep(rows, 0, 'toggle')).toEqual({ kind: 'close', path: 'ai' });
    expect(folderTreeStep(rows, 1, 'toggle')).toEqual({ kind: 'open', path: 'ai/agents' });
    expect(folderTreeStep(rows, 2, 'toggle')).toBeUndefined();
  });

  it('opens a closed folder with →, then steps into it', () => {
    expect(folderTreeStep(rows, 1, 'in')).toEqual({ kind: 'open', path: 'ai/agents' });
    expect(folderTreeStep(rows, 0, 'in')).toEqual({ kind: 'select', index: 1 });
    expect(folderTreeStep(rows, 2, 'in')).toBeUndefined();
  });

  it('closes an open folder with ←, else goes up to the parent', () => {
    expect(folderTreeStep(rows, 0, 'out')).toEqual({ kind: 'close', path: 'ai' });
    expect(folderTreeStep(rows, 1, 'out')).toEqual({ kind: 'select', index: 0 });
    expect(folderTreeStep(rows, 2, 'out')).toEqual({ kind: 'select', index: 0 });
    expect(folderTreeStep(rows, 3, 'out')).toBeUndefined();
    expect(folderTreeStep(rows, 4, 'out')).toBeUndefined();
    expect(folderTreeStep(rows, 9, 'out')).toBeUndefined();
  });

  it('keeps every folder open while searching', () => {
    const all = buildFolderRows(notes, new Set(), { ...opts, openAll: true });
    expect(folderTreeStep(all, 0, 'toggle', true)).toBeUndefined();
    expect(folderTreeStep(all, 0, 'out', true)).toBeUndefined();
    expect(folderTreeStep(all, 1, 'out', true)).toEqual({ kind: 'select', index: 0 });
    expect(folderTreeStep(all, 0, 'in', true)).toEqual({ kind: 'select', index: 1 });
  });
});
