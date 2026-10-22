import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completePath, isPathInput, nextPathCompletion, pathMatchName } from '../src/pathComplete.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fomo-paths-'));
  await mkdir(join(dir, 'notebook'));
  await writeFile(join(dir, 'notes.md'), '');
  await writeFile(join(dir, 'Readme.txt'), '');
  await writeFile(join(dir, '.hidden'), '');
  await symlink(join(dir, 'notebook'), join(dir, 'linked'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('completePath', () => {
  it('lists matching entries in the typed directory, folders ending in a slash', async () => {
    expect(await completePath(`${dir}/no`)).toEqual([`${dir}/notebook/`, `${dir}/notes.md`]);
  });

  it('completes relative paths from the working directory, keeping them relative', async () => {
    expect(await completePath('no', dir)).toEqual(['notebook/', 'notes.md']);
    expect(await completePath('./notes', dir)).toEqual(['./notes.md']);
  });

  it('hides dot entries until the name starts with a dot', async () => {
    const all = await completePath(`${dir}/`);
    expect(all).toEqual([`${dir}/linked/`, `${dir}/notebook/`, `${dir}/notes.md`, `${dir}/Readme.txt`]);
    expect(await completePath(`${dir}/.h`)).toEqual([`${dir}/.hidden`]);
  });

  it('falls back to case-insensitive matches', async () => {
    expect(await completePath(`${dir}/read`)).toEqual([`${dir}/Readme.txt`]);
  });

  it('follows symlinks to folders', async () => {
    expect(await completePath(`${dir}/lin`)).toEqual([`${dir}/linked/`]);
  });

  it('expands ~ for listing but keeps it in the completion', async () => {
    expect(await completePath('~')).toEqual(['~/']);
    for (const match of await completePath('~/')) expect(match.startsWith('~/')).toBe(true);
  });

  it('returns nothing for URLs, missing folders and blank lines', async () => {
    expect(await completePath('https://exa')).toEqual([]);
    expect(await completePath(`${dir}/missing/no`)).toEqual([]);
    expect(await completePath('')).toEqual([]);
  });
});

describe('isPathInput', () => {
  it('accepts paths and rejects URLs and padded text', () => {
    expect(isPathInput('~/Documents')).toBe(true);
    expect(isPathInput('notes/a.md')).toBe(true);
    expect(isPathInput('C:\\Users')).toBe(true);
    expect(isPathInput('https://example.com')).toBe(false);
    expect(isPathInput('file:///tmp')).toBe(false);
    expect(isPathInput(' ~/x')).toBe(false);
    expect(isPathInput('')).toBe(false);
  });
});

describe('nextPathCompletion', () => {
  it('extends to the common prefix of the matches', () => {
    expect(nextPathCompletion('~/n', ['~/notebook/', '~/notes.md'])).toEqual({ text: '~/note' });
    expect(nextPathCompletion('~/do', ['~/Documents/', '~/Downloads/'])).toEqual({ text: '~/Do' });
  });

  it('completes a single match and stops once the path is complete', () => {
    expect(nextPathCompletion('~/Doc', ['~/Documents/'])).toEqual({ text: '~/Documents/' });
    expect(nextPathCompletion('~/a.md', ['~/a.md'])).toBeUndefined();
    expect(nextPathCompletion('~/zzz', [])).toBeUndefined();
  });

  it('cycles through ambiguous matches and wraps around', () => {
    const matches = ['~/note', '~/notebook/', '~/notes.md'];
    const first = nextPathCompletion('~/note', matches);
    expect(first).toEqual({ text: '~/notebook/', cycle: { matches, index: 1 } });
    const second = nextPathCompletion(first!.text, [], first!.cycle);
    expect(second).toEqual({ text: '~/notes.md', cycle: { matches, index: 2 } });
    expect(nextPathCompletion(second!.text, [], second!.cycle)?.text).toBe('~/note');
  });

  it('starts a new completion when the line no longer matches the cycle', () => {
    const cycle = { matches: ['~/a', '~/b'], index: 0 };
    expect(nextPathCompletion('~/Doc', ['~/Documents/'], cycle)).toEqual({ text: '~/Documents/' });
  });
});

describe('pathMatchName', () => {
  it('shows the entry name, keeping the folder slash', () => {
    expect(pathMatchName('~/Documents/')).toBe('Documents/');
    expect(pathMatchName('/tmp/a/notes.md')).toBe('notes.md');
    expect(pathMatchName('notes.md')).toBe('notes.md');
  });
});
