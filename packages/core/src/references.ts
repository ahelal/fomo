import type { Reference } from './types.js';
import { searchTerms } from './search.js';
import { compareReferences, compareText, type ReferenceSort } from './sort.js';

/** Deepest folder nesting kept; deeper segments are joined into the last one. */
export const MAX_FOLDER_DEPTH = 6;

/**
 * Canonical folder path: segments trimmed, empty ones dropped, joined with `/`
 * (`" AI / agents/ "` → `"AI/agents"`). `''` is the top level.
 */
export function normalizeFolder(path: string | undefined): string {
  const parts = (path ?? '').split('/').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (parts.length > MAX_FOLDER_DEPTH) {
    parts.splice(MAX_FOLDER_DEPTH - 1, parts.length, parts.slice(MAX_FOLDER_DEPTH - 1).join(' '));
  }
  return parts.join('/');
}

/** True when `folder` is `parent` or one of its subfolders (`''` contains everything). */
export function isInFolder(folder: string, parent: string): boolean {
  return parent === '' || folder === parent || folder.startsWith(`${parent}/`);
}

/** `folder` moved from under `from` to under `to` (unchanged when it isn't in `from`). */
export function moveFolderPath(folder: string, from: string, to: string): string {
  if (!from || !isInFolder(folder, from)) return folder;
  return normalizeFolder(`${to}/${folder.slice(from.length)}`);
}

/** Every folder in use, with its ancestors, sorted (case-insensitive). */
export function referenceFolders(refs: Pick<Reference, 'folder'>[]): string[] {
  const all = new Set<string>();
  for (const { folder } of refs) {
    const parts = folder ? folder.split('/') : [];
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'));
  }
  return [...all].sort(compareText);
}

/** An `http(s)` URL with surrounding whitespace removed; throws when it isn't one. */
export function normalizeReferenceUrl(url: string): string {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter a full URL (https://…)');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only http(s) links can be saved');
  return trimmed;
}

/** True when every word of `query` is in the title, URL, folder or description (case-insensitive). */
export function matchesReference(ref: Reference, query: string | undefined): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const text = [ref.title, ref.url, ref.folder, ref.description].join('\n').toLowerCase();
  return terms.every((t) => text.includes(t));
}

export type ReferenceRow =
  | {
      kind: 'folder';
      /** Unique row key (`folder:<path>`). */
      key: string;
      path: string;
      /** Last segment of `path`. */
      name: string;
      depth: number;
      /** References in this folder and its subfolders. */
      count: number;
      open: boolean;
    }
  | { kind: 'ref'; key: string; ref: Reference; depth: number };

interface FolderNode {
  path: string;
  name: string;
  count: number;
  folders: Map<string, FolderNode>;
  refs: Reference[];
}

function newNode(path: string, name: string): FolderNode {
  return { path, name, count: 0, folders: new Map(), refs: [] };
}

/**
 * The folder tree as display rows: at each level subfolders first (by name), then links (by `sort`,
 * title A→Z by default). Folders in `expanded` are open; with `search` set only matching links (and
 * their folders) are listed, all opened.
 */
export function buildReferenceRows(
  refs: Reference[],
  expanded: ReadonlySet<string>,
  search?: string,
  sort?: ReferenceSort,
): ReferenceRow[] {
  const byLink = compareReferences(sort);
  const searching = searchTerms(search).length > 0;
  const root = newNode('', '');
  for (const ref of refs) {
    if (searching && !matchesReference(ref, search)) continue;
    let node = root;
    node.count++;
    for (const name of ref.folder ? ref.folder.split('/') : []) {
      const path = node.path ? `${node.path}/${name}` : name;
      let child = node.folders.get(name);
      if (!child) node.folders.set(name, (child = newNode(path, name)));
      child.count++;
      node = child;
    }
    node.refs.push(ref);
  }

  const rows: ReferenceRow[] = [];
  const walk = (node: FolderNode, depth: number) => {
    for (const child of [...node.folders.values()].sort((a, b) => compareText(a.name, b.name))) {
      const open = searching || expanded.has(child.path);
      rows.push({ kind: 'folder', key: `folder:${child.path}`, path: child.path, name: child.name, depth, count: child.count, open });
      if (open) walk(child, depth + 1);
    }
    for (const ref of [...node.refs].sort(byLink)) {
      rows.push({ kind: 'ref', key: `ref:${ref.id}`, ref, depth });
    }
  };
  walk(root, 0);
  return rows;
}

/** The folder a row belongs to: a folder row's own path, or a link's folder. */
export function rowFolder(row: ReferenceRow | undefined): string {
  if (!row) return '';
  return row.kind === 'folder' ? row.path : row.ref.folder;
}

/** Index of the parent folder row of `index` (or -1 at the top level). */
export function parentRowIndex(rows: ReferenceRow[], index: number): number {
  const row = rows[index];
  if (!row || row.depth === 0) return -1;
  for (let i = index - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (r.kind === 'folder' && r.depth === row.depth - 1) return i;
  }
  return -1;
}
