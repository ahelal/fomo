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

/**
 * Group unread updates into digest entries, most important first, then newest.
 * Updates without a (known) topic become single-item synthetic entries so nothing is hidden.
 */
export function buildDigest(unread: Update[], topics: ReadonlyMap<string, Topic>): DigestResponse {
  const groups = new Map<string, Update[]>();
  const entries: DigestEntry[] = [];
  let pending = 0;

  for (const u of unread) {
    if (u.status !== 'unread') continue;
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

/** Flatten entries into navigable rows; expanded (non-synthetic) topics list their items beneath. */
export function flattenDigest(entries: DigestEntry[], expanded: ReadonlySet<string>): DigestRow[] {
  const rows: DigestRow[] = [];
  for (const entry of entries) {
    rows.push({ kind: 'topic', key: entry.topic.id, entry });
    if (!entry.synthetic && expanded.has(entry.topic.id)) {
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
  const idx = selectedKey ? oldRows.findIndex((r) => r.key === selectedKey) : -1;
  let nextKey: string | undefined;
  if (idx >= 0) {
    for (let i = idx + 1; i < oldRows.length && !nextKey; i++) if (alive.has(oldRows[i]!.key)) nextKey = oldRows[i]!.key;
    for (let i = idx; i >= 0 && !nextKey; i--) if (alive.has(oldRows[i]!.key)) nextKey = oldRows[i]!.key;
  }
  return { entries: nextEntries, rows, nextKey: nextKey ?? rows[0]?.key };
}
