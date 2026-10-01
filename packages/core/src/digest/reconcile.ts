import type { TopicImportance, Update } from '../types.js';
import type { PlanPrompt } from './prompt.js';

/** A validated grouping decision from the plan pass. */
export interface TopicGroup {
  /** Set when new items join an existing open topic. */
  existingId?: string;
  title: string;
  importance?: TopicImportance;
  itemIds: string[];
}

/** Topic text produced by the write pass. */
export interface TopicText {
  title: string;
  summary: string;
  highlights: string[];
}

const MAX_TITLE = 120;
const MAX_SUMMARY = 400;
const MAX_HIGHLIGHTS = 6;
const MAX_HIGHLIGHT = 240;
const MAX_ITEM_SUMMARY = 240;

const IMPORTANCE_RANK: Record<TopicImportance, number> = { low: 1, medium: 2, high: 3 };

function parseImportance(value: unknown): TopicImportance | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  return v in IMPORTANCE_RANK ? (v as TopicImportance) : undefined;
}

export function higherImportance(a: TopicImportance | undefined, b: TopicImportance | undefined): TopicImportance | undefined {
  if (!a) return b;
  if (!b) return a;
  return IMPORTANCE_RANK[b] > IMPORTANCE_RANK[a] ? b : a;
}

/** `(i13)`, `(i6, i28)` or `(t2)` — prompt aliases the model sometimes cites in its text. */
const ALIAS_REFS = /\s*\((?:[it]\d+(?:\s*,\s*)?)+\)/g;

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const s = value.replace(ALIAS_REFS, '').replace(/\s+/g, ' ').trim().replace(/^[-•*]\s+/, '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Turn the raw plan JSON into safe groups:
 * - maps aliases back to real ids, drops unknown/duplicate items,
 * - merges repeated references to the same open topic or the same new title,
 * - never lowers an open topic's importance (its earlier items are still unread).
 * Items the model skipped are not returned; see `singletonGroup`.
 */
export function reconcilePlan(raw: unknown, prompt: PlanPrompt): TopicGroup[] {
  const assigned = new Set<string>();
  const groups: TopicGroup[] = [];
  const byKey = new Map<string, TopicGroup>();
  const byId = new Map([...prompt.items.values()].map((u) => [u.id, u]));

  for (const t of asArray((raw as { topics?: unknown } | null)?.topics)) {
    if (typeof t !== 'object' || t === null) continue;
    const obj = t as Record<string, unknown>;

    const itemIds: string[] = [];
    for (const alias of asArray(obj['items'])) {
      if (typeof alias !== 'string') continue;
      const update = prompt.items.get(alias.trim());
      if (!update || assigned.has(update.id)) continue;
      assigned.add(update.id);
      itemIds.push(update.id);
    }
    if (itemIds.length === 0) continue;

    const topicAlias = typeof obj['topic'] === 'string' ? obj['topic'].trim() : '';
    const existing = topicAlias ? prompt.topics.get(topicAlias) : undefined;
    const title = clean(obj['title'], MAX_TITLE) || existing?.title || clean(byId.get(itemIds[0]!)?.title, MAX_TITLE);
    const importance = higherImportance(existing?.importance, parseImportance(obj['importance']));

    const key = existing ? `id:${existing.id}` : `title:${title.toLowerCase()}`;
    const prior = byKey.get(key);
    if (prior) {
      prior.itemIds.push(...itemIds);
      const merged = higherImportance(prior.importance, importance);
      if (merged) prior.importance = merged;
      continue;
    }
    const group: TopicGroup = {
      ...(existing ? { existingId: existing.id } : {}),
      title,
      ...(importance ? { importance } : {}),
      itemIds,
    };
    byKey.set(key, group);
    groups.push(group);
  }

  return groups;
}

/** Last-resort group for an item the model would not place. */
export function singletonGroup(update: Update): TopicGroup {
  return { title: clean(update.title, MAX_TITLE) || update.id, itemIds: [update.id] };
}

/** Validate the write-pass JSON; each missing field falls back to `fallback`. */
export function parseTopicText(raw: unknown, fallback: TopicText): TopicText {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const highlights = asArray(obj['highlights'])
    .map((h) => clean(h, MAX_HIGHLIGHT))
    .filter(Boolean)
    .slice(0, MAX_HIGHLIGHTS);
  return {
    title: clean(obj['title'], MAX_TITLE) || fallback.title,
    summary: clean(obj['summary'], MAX_SUMMARY) || fallback.summary,
    highlights: highlights.length > 0 ? highlights : fallback.highlights.slice(0, MAX_HIGHLIGHTS),
  };
}

/** Per-item summaries from the write-pass JSON, keyed by real update id. Unknown aliases and blanks are dropped. */
export function parseItemSummaries(raw: unknown, aliases: Map<string, Update>): Map<string, string> {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const summaries = new Map<string, string>();
  for (const entry of asArray(obj['items'])) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, summary } = entry as Record<string, unknown>;
    const update = typeof id === 'string' ? aliases.get(id.trim()) : undefined;
    const text = update ? stripPublishDate(clean(summary, MAX_ITEM_SUMMARY), update.datePublished) : '';
    if (update && text && !summaries.has(update.id)) summaries.set(update.id, text);
  }
  return summaries;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DATE_LEAD = '(?:(?:released|announced|published|posted|report dated|dated)\\s+)?(?:on\\s+)?';

/** Regex source matching an ISO date (YYYY-MM-DD…) written as ISO or as "Sep 25, 2026". */
function datePattern(iso: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month) return undefined;
  const names = [month, month.slice(0, 3), ...(month === 'September' ? ['Sept'] : [])].join('|');
  return `(?:${m[1]}-${m[2]}-${m[3]}|(?:${names})\\.?\\s+${Number(m[3])},?\\s+${m[1]})`;
}

/**
 * Removes the publish date the model tacks on — "(2026-09-24)", "(affects admins; 2026-09-30)",
 * "— announced Sep 29, 2026." — since the UI shows it next to the item. Dates inside the sentence
 * ("retired Sep 30, 2026") are kept because they are usually the key fact.
 */
export function stripPublishDate(summary: string, published: string): string {
  const date = datePattern(published);
  if (!date) return summary;
  return summary
    .replace(new RegExp(`\\s*\\(${DATE_LEAD}${date}\\)`, 'gi'), '')
    .replace(new RegExp(`\\s*[;,]\\s*${DATE_LEAD}${date}\\s*\\)`, 'gi'), ')')
    .replace(new RegExp(`\\s*[,;—–]\\s*${DATE_LEAD}${date}(?=\\s*[.;]?\\s*$)`, 'gi'), '')
    .trim();
}
