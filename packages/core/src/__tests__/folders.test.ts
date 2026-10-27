import { describe, it, expect } from 'vitest';
import {
  buildFolderRows,
  deleteFolderEntries,
  folderColor,
  folderMatches,
  folderMove,
  folderPaths,
  isInFolder,
  moveFolderColors,
  moveFolderMetadata,
  moveFolderPath,
  normalizeFolderMetadata,
  normalizeFolder,
  parentFolder,
  parentRowIndex,
  rowFolder,
  setFolderColor,
  folderTreeStep,
  type FolderTreeOptions,
} from '../folders.js';
import type { FolderMetadata } from '../types.js';

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

describe('folder metadata', () => {
  it('normalizes local paths and GitHub repositories', () => {
    expect(normalizeFolderMetadata({ localPath: ' ~/work/fomo ', githubRepo: 'https://github.com/owner/repo/' }))
      .toEqual({ localPath: '~/work/fomo', githubRepo: 'owner/repo' });
    expect(normalizeFolderMetadata({ localPath: ' ', githubRepo: '' })).toEqual({});
    expect(() => normalizeFolderMetadata({ githubRepo: 'not-a-repository' })).toThrow(/owner\/repo/);
  });

  it('moves metadata with folders and detects conflicts instead of overwriting', () => {
    const metadata = { work: { localPath: '~/work' }, 'work/eng': { githubRepo: 'owner/eng' } };
    expect(moveFolderMetadata(metadata, 'work', 'projects')).toEqual({
      projects: { localPath: '~/work' },
      'projects/eng': { githubRepo: 'owner/eng' },
    });
    expect(moveFolderMetadata({ work: { localPath: '~/work' }, projects: { githubRepo: 'owner/repo' } }, 'work', 'projects'))
      .toEqual({ projects: { localPath: '~/work', githubRepo: 'owner/repo' } });
    expect(() => moveFolderMetadata({ work: { localPath: '~/work' }, projects: { localPath: '~/other' } }, 'work', 'projects'))
      .toThrow(/Conflicting metadata/);
  });
});

describe('deleteFolderEntries', () => {
  const colors = { ai: '#000001', 'ai/agents': '#000002', 'ai/agents/x': '#000003', aids: '#000004', agents: '#000005' };

  it('drops the folder and lifts its subfolders into the parent', () => {
    expect(deleteFolderEntries(colors, 'ai', 'parent', moveFolderColors))
      .toEqual({ aids: '#000004', agents: '#000005', 'agents/x': '#000003' });
    expect(deleteFolderEntries(colors, 'ai/agents', 'parent', moveFolderColors))
      .toEqual({ ai: '#000001', 'ai/x': '#000003', aids: '#000004', agents: '#000005' });
  });

  it('drops the whole subtree', () => {
    expect(deleteFolderEntries(colors, 'ai', 'all', moveFolderColors)).toEqual({ aids: '#000004', agents: '#000005' });
  });

  it('keeps metadata clashes and the top level out', () => {
    expect(() => deleteFolderEntries<FolderMetadata>({ a: { localPath: '~/a' }, 'a/b': {}, 'a/b/c': { localPath: '~/1' }, 'a/c': { localPath: '~/2' } }, 'a/b', 'parent', moveFolderMetadata))
      .toThrow('Conflicting metadata');
    expect(deleteFolderEntries<FolderMetadata>({ a: { localPath: '~/a' }, 'a/b': { localPath: '~/b' } }, 'a/b', 'parent', moveFolderMetadata))
      .toEqual({ a: { localPath: '~/a' } });
    expect(() => deleteFolderEntries(colors, '', 'all', moveFolderColors)).toThrow(/top level/);
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

  it('keeps explicitly supplied empty folders visible', () => {
    const rows = buildFolderRows([], new Set(), { ...opts, extraFolders: ['work/fomo'] });
    expect(rows.map((r) => r.kind === 'folder' ? r.path : r.key)).toEqual(['work']);
    const openRows = buildFolderRows([], new Set(['work']), { ...opts, extraFolders: ['work/fomo'] });
    expect(openRows.map((r) => r.kind === 'folder' ? r.path : r.key)).toEqual(['work', 'work/fomo']);
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
