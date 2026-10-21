import type { ScrapedItem } from '../../../types.js';
import { fetchText } from '../../http.js';
import { decodeEntities, dedupByUrl, htmlToText, parseDate } from '../../text.js';

const BASE_URL = 'https://www.anthropic.com';

/** Posts linked from an anthropic.com listing page; `options.section` is the path, e.g. `news`. */
export async function fetchAnthropic(options: Record<string, string>): Promise<ScrapedItem[]> {
  const section = options.section;
  if (!section) throw new Error('anthropic: missing the section option');
  return parsePosts(await fetchText(`${BASE_URL}/${section}`, { Accept: 'text/html' }), section);
}

export function parsePosts(html: string, section: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];
  const linkRe = new RegExp(`<a\\s[^>]*href="(/${section}/[^"#?]+)"[^>]*>([\\s\\S]*?)</a>`, 'gi');
  for (const [, path, body] of html.matchAll(linkRe)) {
    const title = extractTitle(body);
    if (!title) continue;
    items.push({ title, url: `${BASE_URL}${path}`, datePublished: parseDate(extractDate(body)) });
  }
  return dedupByUrl(items);
}

function extractTitle(body: string): string {
  const titled = body.match(/__title[^>]*>([^<]+)</i)?.[1] ?? body.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1];
  if (titled) return htmlToText(titled);
  const text = decodeEntities(body.replace(/<[^>]+>/g, '  ')).split(/\s{2,}/).map((s) => s.trim()).find((s) => s.length >= 10);
  return text ?? '';
}

function extractDate(body: string): string | undefined {
  return body.match(/<time[^>]*>([^<]+)<\/time>/i)?.[1].trim()
    ?? body.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/)?.[0];
}
