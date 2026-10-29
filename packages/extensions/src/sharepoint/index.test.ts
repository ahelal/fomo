import { describe, expect, it } from 'vitest';
import type { ExtensionContext } from '@fomo/core/extension-api';
import { fetch, ITEM_EXPAND, ITEM_SELECT } from './index.js';

const SITE = 'tenant.sharepoint.com,site,web';
const LIST = '12345678-1234-4234-8234-123456789abc';
const RESOURCE = `/sites/${SITE}/lists/${LIST}/items`;

const first = {
  id: '1',
  eTag: '"revision-1"',
  webUrl: 'https://tenant.sharepoint.com/teams/product/SitePages/launch.aspx',
  createdDateTime: '2026-01-01T00:00:00Z',
  lastModifiedDateTime: '2026-01-02T00:00:00Z',
  fields: { Title: 'Launch plan', FileLeafRef: 'launch.aspx', FSObjType: '0', CanvasContent1: '<h1>Launch</h1><p>Plan &amp; milestones</p>' },
};

const page = (value: unknown[], next?: string) => ({ results: [{ statusCode: 200, data: { value, ...(next ? { '@odata.nextLink': next } : {}) } }] });
const nextLink = (overrides: Record<string, string> = {}, resource = RESOURCE) => {
  const params = { $select: ITEM_SELECT, $top: '25', $expand: ITEM_EXPAND, $skiptoken: 'Paged=TRUE&p_ID=25', ...overrides };
  // Live WorkIQ continuations are absolute graph.microsoft.com URLs without a /v1.0 prefix.
  return `https://graph.microsoft.com${resource}?${new URLSearchParams(params).toString()}`;
};

function context(results: unknown[], calls: string[] = []): ExtensionContext {
  const mcpCall = async (_binding: string, _tool: string, args: Record<string, unknown>) => {
    calls.push((args.entityUrls as string[])[0]!);
    return results.shift();
  };
  return {
    options: { siteId: SITE, listId: LIST, siteUrl: 'https://tenant.sharepoint.com/teams/product' },
    signal: new AbortController().signal,
    http: { text: async () => '', json: async <T>() => ({} as T) },
    mcp: { call: mcpCall as ExtensionContext['mcp']['call'] },
    state: { get: async () => undefined, set: async () => {} },
    log: () => {},
  };
}

describe('SharePoint page-text scanner', () => {
  it('follows every continuation with the approved projection and extracts bounded page text', async () => {
    const calls: string[] = [];
    const ctx = context([
      page([first], nextLink()),
      page([{ ...first, id: '2', eTag: '"revision-2"', webUrl: 'https://tenant.sharepoint.com/teams/product/SitePages/roadmap.aspx', fields: { FileLeafRef: 'roadmap.aspx', CanvasContent1: '<p>Roadmap</p>' } }]),
    ], calls);

    await expect(fetch(ctx)).resolves.toEqual([
      { id: '1', etag: '"revision-1"', title: 'Launch plan', url: first.webUrl, createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z', text: 'Launch\nPlan & milestones' },
      expect.objectContaining({ id: '2', title: 'roadmap.aspx' }),
    ]);
    expect(calls[0]).toBe(`${RESOURCE}?$select=${ITEM_SELECT}&$top=25&$expand=${ITEM_EXPAND}`);
    expect(calls[1]!.startsWith(`${RESOURCE}?`)).toBe(true);
    expect(calls[1]).toContain('Paged%3DTRUE%26p_ID%3D25');
  });

  it('skips folder rows', async () => {
    const ctx = context([page([first, { ...first, id: '9', fields: { FileLeafRef: 'Templates', FSObjType: '1' } }])]);
    expect(await fetch(ctx)).toHaveLength(1);
  });

  it('rejects off-list or re-projected continuations and incomplete page text instead of accepting partial scans', async () => {
    await expect(fetch(context([page([first], nextLink({}, `/sites/other/lists/${LIST}/items`))])))
      .rejects.toThrow('continuation outside the selected list');
    await expect(fetch(context([page([first], nextLink({ $expand: 'fields($select=Title,FileLeafRef,FSObjType)' }))])))
      .rejects.toThrow('continuation outside the selected list');
    await expect(fetch(context([page([{ ...first, eTag: undefined }])]))).rejects.toThrow('missing a stable ID');
    await expect(fetch(context([page([{ ...first, webUrl: 'https://evil.example/x' }])]))).rejects.toThrow('missing a stable ID');
    await expect(fetch(context([page([{ ...first, fields: { ...first.fields, CanvasContent1: undefined } }])])))
      .rejects.toThrow('missing its text field');
    await expect(fetch(context([page([{ ...first, fields: { ...first.fields, CanvasContent1: 'x'.repeat(24_001) } }])])))
      .rejects.toThrow('snapshot limit');
  });

  it('pauses a list that exceeds the page budget', async () => {
    const pages = Array.from({ length: 101 }, (_, i) => page([{ ...first, id: String(i) }], nextLink({ $skiptoken: `p_ID=${i}` })));
    await expect(fetch(context(pages))).rejects.toThrow('scope-too-large');
  });
});
