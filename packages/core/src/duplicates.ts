/**
 * Duplicate detection across feeds. Updates are keyed by source + exact URL, so the same post shows
 * up twice when two sources carry it or the publisher changes its URL format. Here a post is the
 * same when its canonical URL matches (skipped at fetch) or its title matches one published around
 * the same time (kept, but flagged with `duplicateOf`).
 */

import type { Update } from './types.js';

/** Query parameters that only track where a click came from. */
const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|msclkid|mc_cid|mc_eid|ref_src|wt\.mc_id|ocid)$/i;

/** Titles that match within this many days count as the same post. */
export const TITLE_MATCH_DAYS = 60;

/**
 * A URL reduced to what identifies the page: no scheme, `www.`, fragment, tracking parameters,
 * trailing slash or locale segment (`/en-us/`); Tech Community posts reduce to their numeric id,
 * since `/t5/<board>/<slug>/ba-p/<id>` and `/blog/<board>/<slug>/<id>` are the same post.
 */
export function canonicalUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return url.trim();
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'techcommunity.microsoft.com') {
    const id = u.pathname.match(/\/ba-p\/(\d+)\/?$/)?.[1] ?? u.pathname.match(/^\/blog\/[^/]+\/[^/]+\/(\d+)\/?$/)?.[1];
    if (id) return `${host}/post/${id}`;
  }
  let path = u.pathname.replace(/\/+$/, '');
  if (host.endsWith('microsoft.com')) path = path.replace(/^\/[a-z]{2}-[a-z]{2}(?=\/|$)/i, '');
  const params = [...u.searchParams].filter(([k]) => !TRACKING_PARAM.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  return `${host}${path}${query}`;
}

/** A title reduced to lowercase words, or undefined when it is too short to identify a post. */
export function titleKey(title: string): string | undefined {
  const words = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const key = words.join(' ');
  return words.length >= 4 && key.length >= 20 ? key : undefined;
}

/**
 * The update after `current` in `updates` (wrapping around) that repeats the same post, meaning its
 * original or another copy of it; undefined when none is listed. Repeated calls cycle through the group.
 */
export function nextDuplicate(updates: readonly Update[], current: Pick<Update, 'id' | 'duplicateOf'>): Update | undefined {
  const root = current.duplicateOf ?? current.id;
  const start = updates.findIndex((u) => u.id === current.id) + 1;
  for (let i = 0; i < updates.length; i++) {
    const u = updates[(start + i) % updates.length]!;
    if (u.id !== current.id && (u.id === root || u.duplicateOf === root)) return u;
  }
  return undefined;
}

/** What duplicate detection needs of a stored update. */
export interface DuplicateRow {
  id: string;
  url: string;
  title: string;
  datePublished: string;
  dateAdded: string;
  duplicateOf?: string;
}

export type DuplicateCheck =
  /** Already stored under this id: insert as usual (it only backfills). */
  | { kind: 'existing' }
  /** The same page is stored as `of`: don't store it again. */
  | { kind: 'skip'; of: string }
  /** New; `duplicateOf` is set when an earlier update has the same title. */
  | { kind: 'new'; duplicateOf?: string };

interface TitleEntry { id: string; time: number }

const DAY_MS = 86_400_000;

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Known updates by canonical URL and title. Built from every stored update (the first added of
 * each group is the original) and then fed new items one by one with `check`, which records them.
 */
export class DuplicateIndex {
  private readonly ids = new Set<string>();
  private readonly byUrl = new Map<string, string>();
  private readonly byTitle = new Map<string, TitleEntry[]>();
  private readonly fixes: Array<{ id: string; duplicateOf: string }> = [];

  constructor(rows: DuplicateRow[]) {
    const ordered = [...rows].sort((a, b) =>
      a.dateAdded.localeCompare(b.dateAdded) || a.datePublished.localeCompare(b.datePublished) || a.id.localeCompare(b.id));
    for (const row of ordered) {
      const original = this.originalOf(row.url, row.title, row.datePublished);
      this.add(row.id, row.url, row.title, row.datePublished, original);
      if ((row.duplicateOf ?? '') !== (original ?? '')) this.fixes.push({ id: row.id, duplicateOf: original ?? '' });
    }
  }

  /** Stored updates whose `duplicateOf` is missing, stale or wrong (`''` clears it). */
  corrections(): Array<{ id: string; duplicateOf: string }> {
    return this.fixes;
  }

  /** Classify a fetched item stored as `id`, and remember it. */
  check(id: string, url: string, title: string, datePublished: string): DuplicateCheck {
    if (this.ids.has(id)) return { kind: 'existing' };
    const sameUrl = this.byUrl.get(canonicalUrl(url));
    if (sameUrl) return { kind: 'skip', of: sameUrl };
    const original = this.originalOf(url, title, datePublished);
    this.add(id, url, title, datePublished, original);
    return original ? { kind: 'new', duplicateOf: original } : { kind: 'new' };
  }

  private originalOf(url: string, title: string, datePublished: string): string | undefined {
    const sameUrl = this.byUrl.get(canonicalUrl(url));
    if (sameUrl) return sameUrl;
    const key = titleKey(title);
    if (!key) return undefined;
    const t = time(datePublished);
    return this.byTitle.get(key)?.find((e) => Math.abs(e.time - t) <= TITLE_MATCH_DAYS * DAY_MS)?.id;
  }

  /** Record an update; its URL and title point at its original (itself when it has none). */
  private add(id: string, url: string, title: string, datePublished: string, original: string | undefined): void {
    const root = original ?? id;
    this.ids.add(id);
    const canon = canonicalUrl(url);
    if (!this.byUrl.has(canon)) this.byUrl.set(canon, root);
    const key = titleKey(title);
    if (key && !original) {
      const list = this.byTitle.get(key) ?? [];
      list.push({ id, time: time(datePublished) });
      this.byTitle.set(key, list);
    }
  }
}
