import { describe, expect, it } from 'vitest';
import { openWorkIQ, runWorkIQ, sharePointCatalogPath, validateWorkIQCall, workiqSignedIn } from '../src/experimental/workiq.js';

describe('WorkIQ capability scope', () => {
  const threads = new Set(['19:meeting@thread.v2']);
  const validate = (tool: string, args: Record<string, unknown>) => validateWorkIQCall(tool, args, 'me', threads, Date.parse('2026-10-24T00:00:00Z'));
  it('permits only the approved meeting reads and file retrieval tool', () => {
    expect(() => validate('fetch', { entityUrls: ['/me?$select=id', '/me/chats/19:meeting@thread.v2/messages?$top=50'] })).not.toThrow();
    expect(() => validate('call_function', { functionUrl: "/me/onlineMeetings/getAllRecordings(meetingOrganizerUserId='me',startDateTime=2026-10-18T00:00:00Z,endDateTime=2026-10-24T00:00:00Z)" })).not.toThrow();
    for (const [tool, args] of [
      ['delete_entity', { entityUrl: '/me/messages/1' }],
      ['fetch', { entityUrls: ['/me/messages'] }],
      ['fetch', { entityUrls: ['https://evil.example/me'] }],
      ['fetch', { entityUrls: ['/\\evil.example/me?$select=id'] }],
      ['fetch', { entityUrls: ['/me/calendarView?startDateTime=2020-10-18T00:00:00Z&endDateTime=2020-10-24T00:00:00Z'] }],
      ['fetch', { entityUrls: ['/me/chats/19:unrelated@thread.v2/messages'] }],
      ['fetch', { entityUrls: ['/me?$expand=messages'] }],
      ['retrieve', { query: 'meeting', capabilities: [{ name: 'Outlook' }] }],
      ['call_function', { functionUrl: "/me/onlineMeetings/getAllRecordings(meetingOrganizerUserId='another-account',startDateTime=2026-10-18T00:00:00Z,endDateTime=2026-10-24T00:00:00Z)" }],
      ['call_function', { functionUrl: "/me/onlineMeetings/getAllRecordings(meetingOrganizerUserId='me',startDateTime=2026-10-18T00:00:00Z,endDateTime=2026-10-24T00:00:00Z)?$expand=anything" }],
    ] as const) expect(() => validate(tool, args)).toThrow('approved');
  });

  it('limits a SharePoint approval to its exact list-item collection', () => {
    const source = { siteId: 'tenant.sharepoint.com,site,web', listId: '12345678-1234-4234-8234-123456789abc' };
    const validateSharePoint = (path: string) => validateWorkIQCall(
      'fetch',
      { entityUrls: [path] },
      'me',
      new Set(),
      Date.now(),
      source,
    );
    expect(() => validateSharePoint('/sites/tenant.sharepoint.com,site,web/lists/12345678-1234-4234-8234-123456789abc/items?$select=id,webUrl,eTag,createdDateTime,lastModifiedDateTime&$top=25&$expand=fields($select=Title,FileLeafRef,FSObjType,CanvasContent1)')).not.toThrow();
    expect(() => validateSharePoint('/sites/tenant.sharepoint.com,site,web/lists/12345678-1234-4234-8234-123456789abc/items?$select=id,webUrl,eTag,createdDateTime,lastModifiedDateTime&$top=25&$expand=fields($select=Title,FileLeafRef,FSObjType,CanvasContent1)&$skiptoken=next')).not.toThrow();
    for (const path of [
      '/sites/tenant.sharepoint.com,site,web/lists?$select=id',
      '/sites/tenant.sharepoint.com,site,web/lists/22345678-1234-4234-8234-123456789abc/items',
      '/sites/tenant.sharepoint.com,site,web/lists/12345678-1234-4234-8234-123456789abc/items?$filter=fields/Title%20eq%20%27secret%27',
      '/sites/tenant.sharepoint.com,site,web/lists/12345678-1234-4234-8234-123456789abc/items?$expand=driveItem',
      '/sites/tenant.sharepoint.com,site,web/lists/12345678-1234-4234-8234-123456789abc/items?$skiptoken=next',
      '/sites/tenant.sharepoint.com,site,web/lists/12345678-1234-4234-8234-123456789abc/items?$select=id,webUrl,eTag,createdDateTime,lastModifiedDateTime&$top=25&$expand=fields($select=Title,FileLeafRef,FSObjType,CanvasContent1)&$skiptoken=',
      '/sites/tenant.sharepoint.com,site,web/lists/12345678-1234-4234-8234-123456789abc/items?$select=id,webUrl,eTag,createdDateTime,lastModifiedDateTime&$top=25&$expand=fields($select=Title,FileLeafRef,FSObjType,CanvasContent1)&$top=25',
      '/sites/tenant.sharepoint.com,site,web/lists/12345678-1234-4234-8234-123456789abc/items?$select=id,webUrl,eTag,createdDateTime,lastModifiedDateTime&$top=999&$expand=fields($select=Title,FileLeafRef,FSObjType,CanvasContent1)',
      '/sites/tenant.sharepoint.com,site,web/lists/12345678-1234-4234-8234-123456789abc/items?$select=id,webUrl,eTag,createdDateTime,lastModifiedDateTime&$top=25&$expand=fields($select=Title,FileLeafRef,FSObjType)',
      '/me',
      '/me/chats',
    ]) expect(() => validateSharePoint(path)).toThrow('approved');
    expect(() => validateWorkIQCall('retrieve', { query: 'x' }, 'me', new Set(), Date.now(), source)).toThrow('approved');
    expect(() => validateWorkIQCall('fetch', { entityUrls: ['/sites/tenant.sharepoint.com,site,web/lists/12345678-1234-4234-8234-123456789abc/items?$select=id,webUrl,eTag,createdDateTime,lastModifiedDateTime&$top=25&$expand=fields($select=Title,FileLeafRef,FSObjType,CanvasContent1)', '/sites/tenant.sharepoint.com,site,web/lists/12345678-1234-4234-8234-123456789abc/items?$select=id,webUrl,eTag,createdDateTime,lastModifiedDateTime&$top=25&$expand=fields($select=Title,FileLeafRef,FSObjType,CanvasContent1)'] }, 'me', new Set(), Date.now(), source)).toThrow('approved');
  });

  it('requires profile approval before opening the host WorkIQ process', async () => {
    await expect(openWorkIQ(`no-consent-${Date.now()}`, new AbortController().signal)).rejects.toThrow(
      process.platform === 'darwin' ? 'explicit host-account sign-in' : 'only on macOS',
    );
  });
});

describe('SharePoint setup catalog paging', () => {
  const siteId = 'tenant.sharepoint.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222';
  const query = '$select=id%2cdisplayName%2cwebUrl%2clist%2csystem&$top=25&$skiptoken=Paged%3dTRUE%26p_ID%3d25';
  const expected = `/sites/${siteId}/lists?${query}`;

  it('follows the relative continuation WorkIQ returns for the list catalog', () => {
    expect(sharePointCatalogPath(`/sites/${siteId}/lists?${query}`, siteId)).toBe(expected);
  });

  it('also accepts an absolute Graph continuation, with or without /v1.0', () => {
    expect(sharePointCatalogPath(`https://graph.microsoft.com/sites/${siteId}/lists?${query}`, siteId)).toBe(expected);
    expect(sharePointCatalogPath(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists?${query}`, siteId)).toBe(expected);
  });

  it('rejects a continuation that leaves the selected site catalog', () => {
    const other = '33333333-3333-4333-8333-333333333333';
    for (const link of [
      `/sites/${siteId.replace('tenant', 'other')}/lists?${query}`,
      `/sites/${siteId}/lists/${other}/items?${query}`,
      `/sites/${siteId}/lists?$select=id&$top=25&$skiptoken=x`,
      `/sites/${siteId}/lists?${query}&$expand=fields`,
      `/sites/${siteId}/lists?${query}&$filter=system%20eq%20true`,
      `https://evil.example/sites/${siteId}/lists?${query}`,
      `//evil.example/sites/${siteId}/lists?${query}`,
      `/\\evil.example/sites/${siteId}/lists?${query}`,
      `https://user:secret@graph.microsoft.com/sites/${siteId}/lists?${query}`,
      'http://[',
      '',
    ]) expect(() => sharePointCatalogPath(link, siteId), link).toThrow('continuation outside the selected site');
  });
});

describe('WorkIQ sign-in state', () => {
  it('needs the Microsoft 365 tools, which the local proxy only serves once signed in', () => {
    expect(workiqSignedIn(['accept_eula', 'ask', 'list_agents'])).toBe(false);
    expect(workiqSignedIn(['accept_eula', 'ask', 'list_agents', 'fetch', 'call_function', 'retrieve'])).toBe(true);
  });

  it('only allows the fixed WorkIQ sign-in commands to run on the host', async () => {
    await expect(runWorkIQ(['mcp'])).resolves.toEqual({ ok: false, output: 'Unapproved WorkIQ command' });
    await expect(runWorkIQ(['auth', 'logout'])).resolves.toEqual({ ok: false, output: 'Unapproved WorkIQ command' });
  });
});
