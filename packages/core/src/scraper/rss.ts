import type { ScrapedItem } from '../types.js';

export function parseRss(xml: string): ScrapedItem[] {
  if (!/<rss\b/i.test(xml)) throw new Error('Expected an RSS feed');

  const items: ScrapedItem[] = [];
  for (const [, block] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = extractTag(block, 'title');
    const url = extractTag(block, 'link');
    if (!title || !url) continue;

    const published = extractTag(block, 'pubDate');
    const datePublished = published ? new Date(published) : new Date();
    const description = extractTag(block, 'description');
    items.push({
      title,
      url,
      datePublished: Number.isNaN(datePublished.getTime()) ? new Date() : datePublished,
      content: decodeEntities(description.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
    });
  }
  return items;
}

function extractTag(xml: string, tag: string): string {
  const raw = (xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] ?? '').trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return cdata ? cdata[1].trim() : decodeEntities(raw);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
      const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
