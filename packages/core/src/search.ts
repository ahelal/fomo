import type { DigestEntry, Update } from './types.js';
import { removeFromDigest } from './digest/view.js';

/** Lower-cased words of a search query; empty when there is nothing to search for. */
export function searchTerms(query: string | undefined): string[] {
  return (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

function containsAll(text: string, terms: string[]): boolean {
  const haystack = text.toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

function updateText(u: Update): string {
  return [u.title, u.summary ?? '', u.gist?.summary ?? '', ...(u.gist?.points ?? []), u.content].join('\n');
}

/** True when every word of `query` appears in the update's title, summaries or content (case-insensitive). */
export function matchesSearch(u: Update, query: string | undefined): boolean {
  const terms = searchTerms(query);
  return terms.length === 0 || containsAll(updateText(u), terms);
}

/**
 * Keep the digest updates that match `query`. Topic title, summary and highlights count for
 * each of its updates, so a matching topic stays whole; otherwise only its matching updates stay.
 */
export function searchDigest(entries: DigestEntry[], query: string | undefined): DigestEntry[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return entries;
  const drop = new Set<string>();
  for (const { topic, items } of entries) {
    const topicText = [topic.title, topic.summary, ...topic.highlights].join('\n');
    for (const u of items) {
      if (!containsAll(`${topicText}\n${updateText(u)}`, terms)) drop.add(u.id);
    }
  }
  return removeFromDigest(entries, drop);
}
