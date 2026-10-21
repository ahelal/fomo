import type { ScrapedItem } from '../types.js';

/** Longest content kept per item. */
export const MAX_CONTENT = 3000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
  });
}

/** HTML (possibly entity-escaped, as in RSS descriptions) as plain single-spaced text. */
export function htmlToText(html: string): string {
  const markup = /<[a-z!/]/i.test(html) ? html : decodeEntities(html);
  return decodeEntities(
    markup
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

/** A parsed date, or now when `raw` is missing or unparsable. */
export function parseDate(raw: string | undefined): Date {
  const d = raw ? new Date(raw) : new Date(NaN);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Items with a unique URL; the first one wins. */
export function dedupByUrl(items: ScrapedItem[]): ScrapedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.url) && !!seen.add(item.url));
}
