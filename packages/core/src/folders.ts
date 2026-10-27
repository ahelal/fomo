import { cleanColor } from './colors.js';
import type { DeleteFolderMode, FolderColorMap, FolderMetadata, FolderMetadataMap } from './types.js';
import { compareText } from './sort.js';

/**
 * Folder trees shared by Bookmarks and Todos: items carry a `folder` path (`ai/agents`, `''` is the
 * top level) and folders exist as long as something is filed in them.
 */

/** Deepest folder nesting kept; deeper segments are joined into the last one. */
export const MAX_FOLDER_DEPTH = 6;
/** Existing folders offered under a folder field. */
export const MAX_FOLDER_MATCHES = 6;

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

/** The folder holding `path` (`ai/agents` → `ai`; `''` for a top-level folder). */
export function parentFolder(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
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

/**
 * A folder rename, checked: both paths normalized, or undefined when nothing would move.
 * Throws when `from` is the top level or `to` is inside `from`.
 */
export function folderMove(from: string, to: string): { from: string; to: string } | undefined {
  const src = normalizeFolder(from);
  const dest = normalizeFolder(to);
  if (!src) throw new Error('Pick a folder to rename');
  if (src === dest) return undefined;
  if (isInFolder(dest, src)) throw new Error('A folder cannot move into itself');
  return { from: src, to: dest };
}

/** Every folder in use, with its ancestors, sorted (case-insensitive). */
export function folderPaths(items: readonly { folder: string }[]): string[] {
  const all = new Set<string>();
  for (const { folder } of items) {
    const parts = folder ? folder.split('/') : [];
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'));
  }
  return [...all].sort(compareText);
}

/** Existing folders containing `query` (case-insensitive), the ones starting with it first. */
export function folderMatches(folders: readonly string[], query: string, max = MAX_FOLDER_MATCHES): string[] {
  const q = query.trim().toLowerCase();
  const hits = q ? folders.filter((f) => f.toLowerCase().includes(q)) : [...folders];
  return hits
    .map((f) => ({ f, rank: f.toLowerCase().startsWith(q) ? 0 : 1 }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, max)
    .map((h) => h.f);
}

// ─── Folder colors ───────────────────────────────────────────────────────────

/** The color `folder` shows: its own, or the closest parent's (undefined when none has one). */
export function folderColor(colors: FolderColorMap | undefined, folder: string): string | undefined {
  if (!colors) return undefined;
  for (let path = folder; path; path = path.slice(0, Math.max(0, path.lastIndexOf('/')))) {
    if (colors[path]) return colors[path];
  }
  return undefined;
}

/** `colors` with `folder` set to `color` (`''` removes it, so the parent's shows again). */
export function setFolderColor(colors: FolderColorMap, folder: string, color: string): FolderColorMap {
  const path = normalizeFolder(folder);
  if (!path) throw new Error('The top level has no color');
  const { [path]: _old, ...rest } = colors;
  const clean = cleanColor(color);
  return clean ? { ...rest, [path]: clean } : rest;
}

/**
 * `colors` after renaming folder `from` to `to` (subfolders included). A folder that already has a
 * color at the destination keeps it; a color moved to the top level is dropped.
 */
export function moveFolderColors(colors: FolderColorMap, from: string, to: string): FolderColorMap {
  const move = folderMove(from, to);
  if (!move) return colors;
  const next: FolderColorMap = {};
  const moved: [string, string][] = [];
  for (const [path, color] of Object.entries(colors)) {
    if (isInFolder(path, move.from)) moved.push([moveFolderPath(path, move.from, move.to), color]);
    else next[path] = color;
  }
  for (const [path, color] of moved) if (path && !(path in next)) next[path] = color;
  return next;
}

/** Canonical folder metadata. GitHub repositories are stored as `owner/repo`. */
export function normalizeFolderMetadata(metadata: FolderMetadata): FolderMetadata {
  if (metadata.localPath !== undefined && typeof metadata.localPath !== 'string') throw new Error('Local directory must be text');
  if (metadata.githubRepo !== undefined && typeof metadata.githubRepo !== 'string') throw new Error('GitHub repository must be text');
  const localPath = metadata.localPath?.trim();
  const githubInput = metadata.githubRepo?.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
  let githubRepo: string | undefined;
  if (githubInput) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(githubInput)) throw new Error('GitHub repository must be owner/repo or a github.com URL');
    githubRepo = githubInput;
  }
  return {
    ...(localPath ? { localPath } : {}),
    ...(githubRepo ? { githubRepo } : {}),
  };
}

/** Carry folder metadata across a rename; conflicting non-empty values must be resolved explicitly. */
export function moveFolderMetadata(metadata: FolderMetadataMap, from: string, to: string): FolderMetadataMap {
  const move = folderMove(from, to);
  if (!move) return metadata;
  const next: FolderMetadataMap = {};
  const moved: [string, FolderMetadata][] = [];
  for (const [path, value] of Object.entries(metadata)) {
    if (isInFolder(path, move.from)) moved.push([moveFolderPath(path, move.from, move.to), value]);
    else next[path] = value;
  }
  for (const [path, value] of moved) {
    if (!path) continue;
    const existing = next[path];
    if (existing && ((existing.localPath && value.localPath && existing.localPath !== value.localPath)
      || (existing.githubRepo && value.githubRepo && existing.githubRepo !== value.githubRepo))) {
      throw new Error(`Conflicting metadata for ${path}/; clear or move its existing metadata first`);
    }
    next[path] = { ...existing, ...value };
  }
  return next;
}

// ─── Deleting folders ────────────────────────────────────────────────────────

/** The checked folder to delete (throws for the top level). */
export function folderToDelete(path: string): string {
  const folder = normalizeFolder(path);
  if (!folder) throw new Error('The top level cannot be deleted');
  return folder;
}

/** Folder `path` deleted from a per-folder map (colors, metadata): its own entry always goes. */
export function deleteFolderEntries<V>(
  map: Record<string, V>,
  path: string,
  mode: DeleteFolderMode,
  move: (rest: Record<string, V>, from: string, to: string) => Record<string, V>,
): Record<string, V> {
  const folder = folderToDelete(path);
  const rest: Record<string, V> = {};
  for (const [p, v] of Object.entries(map)) {
    if (mode === 'all' ? !isInFolder(p, folder) : p !== folder) rest[p] = v;
  }
  return mode === 'all' ? rest : move(rest, folder, parentFolder(folder));
}

// ─── Tree rows ───────────────────────────────────────────────────────────────

export interface FolderRow {
  kind: 'folder';
  /** Unique row key (`folder:<path>`). */
  key: string;
  path: string;
  /** Last segment of `path`. */
  name: string;
  depth: number;
  /** Items listed in this folder and its subfolders. */
  count: number;
  /** How many of them are done (always 0 without `isDone`). */
  done: number;
  /** Number of items included in progress (todos exclude ideas). */
  progressCount: number;
  open: boolean;
}

export interface ItemRow<T> {
  kind: 'item';
  key: string;
  item: T;
  depth: number;
}

export type FolderTreeRow<T> = FolderRow | ItemRow<T>;

export interface FolderTreeOptions<T> {
  folder(item: T): string;
  /** Unique row key of an item (e.g. `ref:<id>`). */
  key(item: T): string;
  /** Order of the items within a folder. */
  compare(a: T, b: T): number;
  /** Items left out (not matching a search or filter); folders left empty are not listed. */
  include?(item: T): boolean;
  /** Every folder is open, whatever `expanded` says (while searching). */
  openAll?: boolean;
  /** Counts a folder's done items (todo progress). */
  isDone?(item: T): boolean;
  isProgressItem?(item: T): boolean;
  /** Folders that should remain visible even without items (for example, metadata-bearing folders). */
  extraFolders?: readonly string[];
}

interface FolderNode<T> {
  path: string;
  name: string;
  count: number;
  done: number;
  progressCount: number;
  folders: Map<string, FolderNode<T>>;
  items: T[];
}

function newNode<T>(path: string, name: string): FolderNode<T> {
  return { path, name, count: 0, done: 0, progressCount: 0, folders: new Map(), items: [] };
}

/**
 * The folder tree as display rows: at each level subfolders first (by name), then items (by
 * `compare`). Folders in `expanded` are open, or all of them with `openAll`.
 */
export function buildFolderRows<T>(items: readonly T[], expanded: ReadonlySet<string>, opts: FolderTreeOptions<T>): FolderTreeRow<T>[] {
  const root = newNode<T>('', '');
  for (const folder of opts.extraFolders ?? []) {
    let node = root;
    for (const name of folder ? folder.split('/') : []) {
      const path = node.path ? `${node.path}/${name}` : name;
      let child = node.folders.get(name);
      if (!child) node.folders.set(name, (child = newNode<T>(path, name)));
      node = child;
    }
  }
  for (const item of items) {
    if (opts.include && !opts.include(item)) continue;
    const done = opts.isDone?.(item) ? 1 : 0;
    const progress = opts.isProgressItem ? Number(opts.isProgressItem(item)) : 1;
    let node = root;
    node.count++;
    node.done += done;
    node.progressCount += progress;
    const folder = opts.folder(item);
    for (const name of folder ? folder.split('/') : []) {
      const path = node.path ? `${node.path}/${name}` : name;
      let child = node.folders.get(name);
      if (!child) node.folders.set(name, (child = newNode<T>(path, name)));
      child.count++;
      child.done += done;
      child.progressCount += progress;
      node = child;
    }
    node.items.push(item);
  }

  const rows: FolderTreeRow<T>[] = [];
  const walk = (node: FolderNode<T>, depth: number) => {
    for (const child of [...node.folders.values()].sort((a, b) => compareText(a.name, b.name))) {
      const open = !!opts.openAll || expanded.has(child.path);
      rows.push({
        kind: 'folder',
        key: `folder:${child.path}`,
        path: child.path,
        name: child.name,
        depth,
        count: child.count,
        done: child.done,
        progressCount: child.progressCount,
        open,
      });
      if (open) walk(child, depth + 1);
    }
    for (const item of [...node.items].sort(opts.compare)) {
      rows.push({ kind: 'item', key: opts.key(item), item, depth });
    }
  };
  walk(root, 0);
  return rows;
}

/** The folder a row belongs to: a folder row's own path, or an item's folder. */
export function rowFolder<T extends { folder: string }>(row: FolderTreeRow<T> | undefined): string {
  if (!row) return '';
  return row.kind === 'folder' ? row.path : row.item.folder;
}

/** Index of the parent folder row of `index` (or -1 at the top level). */
export function parentRowIndex<T>(rows: readonly FolderTreeRow<T>[], index: number): number {
  const row = rows[index];
  if (!row || row.depth === 0) return -1;
  for (let i = index - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (r.kind === 'folder' && r.depth === row.depth - 1) return i;
  }
  return -1;
}

/** Keys that move around a folder tree: ↵ (`toggle`), → or l (`in`) and ← (`out`). */
export type FolderTreeKey = 'toggle' | 'in' | 'out';

/** What a folder tree key does: select another row, or open or close a folder. */
export type FolderTreeStep =
  | { kind: 'select'; index: number }
  | { kind: 'open' | 'close'; path: string };

/**
 * A key on row `index` of a folder tree, the same in the TUI and the web: ↵ opens or closes a
 * folder; → opens a closed folder or steps into an open one; ← closes an open folder, else goes up
 * to the parent folder. While `searching` every folder stays open, so ↵ does nothing and ← only
 * goes up. Undefined when the key does nothing there (↵ and → on an item).
 */
export function folderTreeStep<T>(
  rows: readonly FolderTreeRow<T>[],
  index: number,
  key: FolderTreeKey,
  searching = false,
): FolderTreeStep | undefined {
  const row = rows[index];
  if (!row) return undefined;
  const up = (): FolderTreeStep | undefined => {
    const parent = parentRowIndex(rows, index);
    return parent < 0 ? undefined : { kind: 'select', index: parent };
  };
  if (row.kind === 'item') return key === 'out' ? up() : undefined;
  if (key === 'toggle') return searching ? undefined : { kind: row.open ? 'close' : 'open', path: row.path };
  if (key === 'in') {
    if (!row.open) return { kind: 'open', path: row.path };
    return rows[index + 1]?.depth === row.depth + 1 ? { kind: 'select', index: index + 1 } : undefined;
  }
  return row.open && !searching ? { kind: 'close', path: row.path } : up();
}
