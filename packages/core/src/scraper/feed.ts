import type { ScrapedItem } from '../types.js';
import { htmlToText, MAX_CONTENT, parseDate } from './text.js';

export interface FeedFilter {
  /** Case-insensitive regex matched against title + content. */
  include?: string;
  /** RSS `<category>` text or Atom `<category term>`. */
  category?: string;
}

/** Parse an RSS 2.0, RSS 1.0 (RDF) or Atom feed. Throws when `xml` is not a feed. */
export function parseFeed(xml: string, filter: FeedFilter = {}): ScrapedItem[] {
  if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error('Expected an RSS or Atom feed');

  const include = filter.include ? new RegExp(filter.include, 'i') : undefined;
  const category = filter.category?.toLowerCase();
  const items: ScrapedItem[] = [];

  for (const [, , block] of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    if (category && !categories(block).includes(category)) continue;

    const title = htmlToText(tag(block, 'title'));
    const url = link(block);
    if (!title || !url) continue;

    const encodedContent = tag(block, 'content:encoded');
    const atomContent = tag(block, 'content');
    const fullContent = encodedContent || atomContent;
    const content = htmlToText(
      encodedContent || tag(block, 'description') || atomContent || tag(block, 'summary')
        || tag(block, 'media:description'),
    );
    if (include && !include.test(`${title} ${content}`)) continue;

    items.push({
      title,
      url,
      datePublished: parseDate(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'dc:date') || tag(block, 'updated')),
      content: content.slice(0, MAX_CONTENT),
      ...(fullContent ? { readingTimeMinutes: estimateReadingTimeMinutes(htmlToText(fullContent)) } : {}),
    });
  }
  return items;
}

/** Estimate reading time at 230 words per minute, rounding up to a whole minute. */
function estimateReadingTimeMinutes(content: string): number {
  const words = content.match(/\S+/g)?.length ?? 0;
  return Math.max(1, Math.ceil(words / 230));
}

/** Inner text of the first `<name>`, unwrapping CDATA. */
function tag(block: string, name: string): string {
  const raw = (block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1] ?? '').trim();
  return raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/)?.[1].trim() ?? raw;
}

/** RSS `<link>url</link>`, else Atom `<link rel="alternate" href>` (or the first `href`). */
function link(block: string): string {
  const text = tag(block, 'link');
  if (text) return text;
  const links = [...block.matchAll(/<link\b[^>]*>/gi)].map(([el]) => el);
  const alternate = links.find((el) => !/\brel=/i.test(el) || /\brel=["']alternate["']/i.test(el)) ?? links[0];
  return alternate?.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? '';
}

function categories(block: string): string[] {
  return [
    ...[...block.matchAll(/<category\b[^>]*\bterm=["']([^"']+)["']/gi)].map((m) => m[1]),
    ...[...block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)].map((m) => htmlToText(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, ''))),
  ].map((c) => c.trim().toLowerCase());
}
