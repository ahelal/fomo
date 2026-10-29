import type { ExtensionContext, Json } from '@fomo/core/extension-api';

const MAX_PAGES = 100;
const MAX_RECORDS = 2500;
const PAGE_SIZE = 25;
/** The exact live-verified projection; the host broker allows only this query and its continuations. */
export const ITEM_SELECT = 'id,webUrl,eTag,createdDateTime,lastModifiedDateTime';
export const ITEM_EXPAND = 'fields($select=Title,FileLeafRef,FSObjType,CanvasContent1)';
const MAX_PAGE_TEXT_CHARS = 24_000;

interface SharePointRow {
  id: string;
  etag: string;
  title: string;
  url: string;
  createdAt: string;
  modifiedAt: string;
  text: string;
}

function required(ctx: ExtensionContext, name: string, max: number): string {
  const value = ctx.options[name];
  if (!value || value.length > max) throw new Error(`SharePoint source is missing a valid ${name}`);
  return value;
}

function graphPath(value: string, expectedPath: string): string {
  const url = new URL(value, 'https://graph.microsoft.com');
  const path = url.pathname.replace(/^\/v1\.0(?=\/)/, '');
  const keys = [...url.searchParams.keys()];
  if (url.origin !== 'https://graph.microsoft.com' || url.username || url.password || path !== expectedPath
    || new Set(keys).size !== keys.length
    || keys.some((key) => !['$select', '$expand', '$top', '$skiptoken'].includes(key))
    || url.searchParams.get('$select') !== ITEM_SELECT || url.searchParams.get('$expand') !== ITEM_EXPAND
    || url.searchParams.get('$top') !== String(PAGE_SIZE) || !url.searchParams.get('$skiptoken')) {
    throw new Error('SharePoint returned a continuation outside the selected list');
  }
  // Keep the raw query: re-serializing could change the opaque skip token's bytes.
  return `${path}${url.search}`;
}

function graphData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid WorkIQ SharePoint response');
  const response = value as Record<string, unknown>;
  const results = response.results;
  const first = Array.isArray(results) ? results[0] : undefined;
  if (!first || typeof first !== 'object' || Array.isArray(first)) throw new Error('WorkIQ returned no SharePoint list response');
  const result = first as Record<string, unknown>;
  if (result.statusCode !== 200 || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
    throw new Error('WorkIQ could not read SharePoint list metadata');
  }
  return result.data as Record<string, unknown>;
}

function fieldText(fields: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pageText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('SharePoint page is missing its text field');
  const markup = value
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] !== '#') {
        const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
        return named[code.toLowerCase()] ?? entity;
      }
      const numeric = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return numeric > 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : entity;
    })
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<\/?(?:p|div|li|h[1-6]|br|blockquote|pre|tr|section)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (markup.length > MAX_PAGE_TEXT_CHARS) throw new Error(`SharePoint page text exceeds the ${MAX_PAGE_TEXT_CHARS}-character snapshot limit`);
  return markup;
}

function row(value: unknown, siteUrl: URL): SharePointRow | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid SharePoint list item');
  const item = value as Record<string, unknown>;
  const fields = item.fields && typeof item.fields === 'object' && !Array.isArray(item.fields)
    ? item.fields as Record<string, unknown> : {};
  if (String(fields.FSObjType ?? '0') === '1') return undefined;
  const id = typeof item.id === 'string' ? item.id : '';
  const etag = typeof item.eTag === 'string' ? item.eTag : typeof item['@odata.etag'] === 'string' ? item['@odata.etag'] as string : '';
  const title = (fieldText(fields, 'Title', 'FileLeafRef') ?? '').slice(0, 500);
  const url = typeof item.webUrl === 'string' ? item.webUrl : '';
  const createdAt = typeof item.createdDateTime === 'string' ? item.createdDateTime : '';
  const modifiedAt = typeof item.lastModifiedDateTime === 'string' ? item.lastModifiedDateTime : '';
  const text = pageText(fields.CanvasContent1);
  if (!id || id.length > 512 || !etag || etag.length > 512 || !title
    || !url.startsWith(`${siteUrl.origin}/`) || url.length > 8192
    || !Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(modifiedAt))) {
    throw new Error('SharePoint item is missing a stable ID, ETag, title, URL or timestamps');
  }
  return { id, etag, title, url, createdAt: new Date(createdAt).toISOString(), modifiedAt: new Date(modifiedAt).toISOString(), text };
}

/** Returns a complete, bounded page-text snapshot; no files or non-Site-Pages content are requested. */
export async function fetch(ctx: ExtensionContext): Promise<Json[]> {
  const siteId = required(ctx, 'siteId', 512);
  const listId = required(ctx, 'listId', 36);
  const siteUrl = new URL(required(ctx, 'siteUrl', 2048));
  if (!/^[A-Za-z0-9.,_-]+$/.test(siteId) || !/^[0-9a-f-]{36}$/i.test(listId)) {
    throw new Error('Invalid SharePoint site or list identity');
  }
  if (siteUrl.protocol !== 'https:' || !/^[a-z0-9.-]+\.sharepoint\.com$/i.test(siteUrl.hostname)) {
    throw new Error('Invalid SharePoint site URL');
  }
  const path = `/sites/${siteId}/lists/${listId}/items`;
  let next = `${path}?$select=${ITEM_SELECT}&$top=${PAGE_SIZE}&$expand=${ITEM_EXPAND}`;
  const items = new Map<string, SharePointRow>();
  for (let page = 0; next && page < MAX_PAGES; page++) {
    ctx.signal.throwIfAborted();
    const response = await ctx.mcp.call('workiq', 'fetch', { entityUrls: [next] });
    const data = graphData(response);
    if (!Array.isArray(data.value)) throw new Error('WorkIQ returned an invalid SharePoint item page');
    if (data.value.length > 100) throw new Error('WorkIQ returned an oversized SharePoint item page');
    for (const value of data.value) {
      const current = row(value, siteUrl);
      if (!current) continue;
      if (items.has(current.id)) throw new Error('SharePoint returned a duplicate item ID in one snapshot');
      items.set(current.id, current);
      if (items.size > MAX_RECORDS) throw new Error(`scope-too-large: the list has more than ${MAX_RECORDS} items; no partial result was accepted`);
    }
    const link = data['@odata.nextLink'];
    next = typeof link === 'string' ? graphPath(link, path) : '';
  }
  if (next) throw new Error(`scope-too-large: the list needs more than ${MAX_PAGES} pages; no partial result was accepted`);
  return [...items.values()] as unknown as Json[];
}
