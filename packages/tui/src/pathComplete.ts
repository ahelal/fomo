import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, resolve } from 'node:path';
import { untildify } from './config.js';

/** At most this many entries are offered for one completion. */
const MAX_MATCHES = 200;

/** Tab walks through `matches` once completion can't extend the path any further. */
export interface PathCycle {
  matches: string[];
  index: number;
}

/** A line naming a local path (not a URL) that Tab can complete. */
export function isPathInput(text: string): boolean {
  const value = text.trim();
  if (!value || value !== text) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(value) || /^[a-z]:[\\/]/i.test(value);
}

async function isDirectory(entry: Dirent, dir: string): Promise<boolean> {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  return (await stat(join(dir, entry.name)).catch(() => undefined))?.isDirectory() ?? false;
}

/**
 * Paths that complete `input` (`~`, absolute or relative to `cwd`), directories ending in a
 * separator. Hidden entries only show once the name starts with a dot; a typed name that matches
 * nothing case-sensitively falls back to case-insensitive matching.
 */
export async function completePath(input: string, cwd = process.cwd()): Promise<string[]> {
  if (!isPathInput(input)) return [];
  if (input === '~') return ['~/'];
  const windows = process.platform === 'win32';
  const cut = Math.max(input.lastIndexOf('/'), windows ? input.lastIndexOf('\\') : -1) + 1;
  const typedDir = input.slice(0, cut);
  const prefix = input.slice(cut);
  const dir = resolve(cwd, untildify(typedDir || '.'));
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const visible = entries.filter((entry) => prefix.startsWith('.') || !entry.name.startsWith('.'));
  let found = visible.filter((entry) => entry.name.startsWith(prefix));
  if (!found.length) {
    const lower = prefix.toLowerCase();
    found = visible.filter((entry) => entry.name.toLowerCase().startsWith(lower));
  }
  found.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.name < b.name ? -1 : 1));
  const separator = windows && typedDir.endsWith('\\') ? '\\' : '/';
  return Promise.all(found.slice(0, MAX_MATCHES).map(async (entry) =>
    `${typedDir}${entry.name}${(await isDirectory(entry, dir)) ? separator : ''}`));
}

function commonPrefix(values: readonly string[]): string {
  let prefix = values[0] ?? '';
  for (const value of values) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

/**
 * What Tab does to the typed path `text`: extend it to the common prefix of its `matches`, else
 * cycle through them; undefined when there's nothing to complete (Tab moves to the next field).
 */
export function nextPathCompletion(text: string, matches: readonly string[], cycle?: PathCycle): { text: string; cycle?: PathCycle } | undefined {
  if (cycle && cycle.matches.length > 1 && cycle.matches[cycle.index] === text) {
    const index = (cycle.index + 1) % cycle.matches.length;
    return { text: cycle.matches[index]!, cycle: { matches: cycle.matches, index } };
  }
  if (!matches.length) return undefined;
  const common = commonPrefix(matches);
  if (common.length >= text.length && common !== text) return { text: common };
  if (matches.length === 1) return undefined;
  const index = matches[0] === text ? 1 : 0;
  return { text: matches[index]!, cycle: { matches: [...matches], index } };
}

/** The name a match adds to its directory, for listing matches compactly. */
export function pathMatchName(match: string): string {
  const trimmed = match.replace(/[\\/]$/, '');
  return match.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1);
}
