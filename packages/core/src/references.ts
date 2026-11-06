import type { FolderMetadataMap, Reference } from './types.js';
import { searchTerms } from './search.js';
import { compareReferences, type ReferenceSort } from './sort.js';
import { buildFolderRows, folderPaths, type FolderTreeRow } from './folders.js';

/** Every folder in use, with its ancestors, sorted (case-insensitive). */
export function referenceFolders(refs: Pick<Reference, 'folder'>[]): string[] {
  return folderPaths(refs);
}

/** An `http(s)` URL or internal Manual-entry reference, with surrounding whitespace removed. */
export function normalizeReferenceUrl(url: string): string {
  const trimmed = url.trim();
  if (/^fomo:\/\/manual\/[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter a full URL (https://…)');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only http(s) links can be saved');
  return trimmed;
}

/** True for a reference that points to a locally stored Manual entry. */
export function isManualReferenceUrl(url: string): boolean {
  return /^fomo:\/\/manual\/[A-Za-z0-9_-]+$/.test(url);
}

/** True when every word of `query` is in the title, URL, folder or description (case-insensitive). */
export function matchesReference(ref: Reference, query: string | undefined): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const text = [ref.title, ref.url, ref.folder, ref.description].join('\n').toLowerCase();
  return terms.every((t) => text.includes(t));
}

export type ReferenceRow = FolderTreeRow<Reference>;

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
  folderMetadata?: FolderMetadataMap,
): ReferenceRow[] {
  const searching = searchTerms(search).length > 0;
  return buildFolderRows(refs, expanded, {
    folder: (ref) => ref.folder,
    key: (ref) => `ref:${ref.id}`,
    compare: compareReferences(sort),
    include: searching ? (ref) => matchesReference(ref, search) : undefined,
    openAll: searching,
    extraFolders: searching ? [] : Object.keys(folderMetadata ?? {}),
  });
}
