import type { DigestEntry, DigestResponse, Topic, TopicImportance, Update } from '../types.js';

const SYNTHETIC_PREFIX = 'item:';

export function isSyntheticTopicId(id: string): boolean {
  return id.startsWith(SYNTHETIC_PREFIX);
}

const IMPORTANCE_ORDER: Record<TopicImportance, number> = { high: 3, medium: 2, low: 1 };

/** Sort rank for a topic; unrated topics and ungrouped items rank as medium. */
export function importanceRank(importance: TopicImportance | undefined): number {
  return importance ? IMPORTANCE_ORDER[importance] : IMPORTANCE_ORDER.medium;
}

export const IMPORTANCE_LABEL: Record<TopicImportance, string> = {
  high: 'High — worth reading',
  medium: 'Medium — worth a look',
  low: 'Low — skim or skip',
};

function byNewest(a: Update, b: Update): number {
  return b.datePublished.localeCompare(a.datePublished);
}

export interface BuildDigestOptions {
  /** Group saved updates (read or unread) instead of unread ones. */
  saved?: boolean;
}

/**
 * Group unread (or, with `saved`, saved) updates into digest entries, most important first, then newest.
 * Updates without a (known) topic become single-item synthetic entries so nothing is hidden.
 */
export function buildDigest(
  updates: Update[],
  topics: ReadonlyMap<string, Topic>,
  options: BuildDigestOptions = {},
): DigestResponse {
  const groups = new Map<string, Update[]>();
  const entries: DigestEntry[] = [];
  let pending = 0;
  const include = options.saved ? (u: Update) => u.saved : (u: Update) => u.status === 'unread';

  for (const u of updates) {
    if (!include(u)) continue;
    if (u.topicId && topics.has(u.topicId)) {
      const list = groups.get(u.topicId) ?? [];
      list.push(u);
      groups.set(u.topicId, list);
      continue;
    }
    pending++;
    entries.push({
      topic: {
        id: `${SYNTHETIC_PREFIX}${u.id}`,
        title: u.title,
        summary: '',
        highlights: [],
        createdAt: u.dateAdded,
        updatedAt: u.dateAdded,
      },
      items: [u],
      latestDate: u.datePublished,
      sources: [u.source],
      synthetic: true,
    });
  }

  for (const [topicId, items] of groups) {
    items.sort(byNewest);
    entries.push({
      topic: topics.get(topicId)!,
      items,
      latestDate: items[0]!.datePublished,
      sources: [...new Set(items.map((i) => i.source))],
      synthetic: false,
    });
  }

  entries.sort(
    (a, b) =>
      importanceRank(b.topic.importance) - importanceRank(a.topic.importance) ||
      b.latestDate.localeCompare(a.latestDate) ||
      Number(a.synthetic) - Number(b.synthetic),
  );
  return { entries, pending };
}

export type DigestRow =
  | { kind: 'topic'; key: string; entry: DigestEntry }
  | { kind: 'item'; key: string; entry: DigestEntry; update: Update };

/** A topic with a single update is shown as that update (title + summary) instead of an expandable group. */
export function soloUpdate(entry: DigestEntry): Update | undefined {
  return entry.items.length === 1 ? entry.items[0] : undefined;
}

/** Flatten entries into navigable rows; expanded multi-update topics list their items beneath. */
export function flattenDigest(entries: DigestEntry[], expanded: ReadonlySet<string>): DigestRow[] {
  const rows: DigestRow[] = [];
  for (const entry of entries) {
    rows.push({ kind: 'topic', key: entry.topic.id, entry });
    if (entry.items.length > 1 && expanded.has(entry.topic.id)) {
      for (const update of entry.items) {
        rows.push({ kind: 'item', key: `${entry.topic.id}/${update.id}`, entry, update });
      }
    }
  }
  return rows;
}

/** Remove updates from entries (e.g. after marking read); drops entries that become empty. */
export function removeFromDigest(entries: DigestEntry[], updateIds: ReadonlySet<string>): DigestEntry[] {
  const out: DigestEntry[] = [];
  for (const entry of entries) {
    const items = entry.items.filter((u) => !updateIds.has(u.id));
    if (items.length === 0) continue;
    if (items.length === entry.items.length) {
      out.push(entry);
      continue;
    }
    out.push({
      ...entry,
      items,
      latestDate: items[0]!.datePublished,
      sources: [...new Set(items.map((i) => i.source))],
    });
  }
  return out;
}

/** Apply `patch` to the given updates wherever they appear in the digest (e.g. a status change in the Saved view). */
export function patchDigest(entries: DigestEntry[], updateIds: ReadonlySet<string>, patch: Partial<Update>): DigestEntry[] {
  return entries.map((entry) => (
    entry.items.some((u) => updateIds.has(u.id))
      ? { ...entry, items: entry.items.map((u) => (updateIds.has(u.id) ? { ...u, ...patch } : u)) }
      : entry
  ));
}

/**
 * Key of the row after `key`, skipping an expanded topic's own updates (so a topic moves to the next topic);
 * stays on `key` at the end of the list, and starts at the first row when `key` is not found.
 */
export function nextRowKey(rows: DigestRow[], key: string | undefined): string | undefined {
  const idx = key ? rows.findIndex((r) => r.key === key) : -1;
  if (idx < 0) return rows[0]?.key;
  const row = rows[idx]!;
  let i = idx + 1;
  if (row.kind === 'topic') {
    while (rows[i]?.kind === 'item' && rows[i]!.entry.topic.id === row.entry.topic.id) i++;
  }
  return rows[i]?.key ?? row.key;
}

/**
 * Remove `updateIds` from the digest and choose the row to select next:
 * the first surviving row after `selectedKey`, else the nearest one before it.
 */
export function removeAndAdvance(
  entries: DigestEntry[],
  expanded: ReadonlySet<string>,
  selectedKey: string | undefined,
  updateIds: ReadonlySet<string>,
): { entries: DigestEntry[]; rows: DigestRow[]; nextKey: string | undefined } {
  const oldRows = flattenDigest(entries, expanded);
  const nextEntries = removeFromDigest(entries, updateIds);
  const rows = flattenDigest(nextEntries, expanded);
  const alive = new Set(rows.map((r) => r.key));
  // An item whose topic shrank to one update now lives on the topic row itself.
  const soloKeys = new Map<string, string>();
  for (const entry of nextEntries) {
    const solo = soloUpdate(entry);
    if (solo) soloKeys.set(`${entry.topic.id}/${solo.id}`, entry.topic.id);
  }
  const resolve = (key: string) => (alive.has(key) ? key : soloKeys.get(key));
  const idx = selectedKey ? oldRows.findIndex((r) => r.key === selectedKey) : -1;
  let nextKey: string | undefined;
  if (idx >= 0) {
    for (let i = idx + 1; i < oldRows.length && !nextKey; i++) nextKey = resolve(oldRows[i]!.key);
    for (let i = idx; i >= 0 && !nextKey; i--) nextKey = resolve(oldRows[i]!.key);
  }
  return { entries: nextEntries, rows, nextKey: nextKey ?? rows[0]?.key };
}
