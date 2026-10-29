import { describe, expect, it } from 'vitest';
import { ADD_SOURCE_LABELS, ADD_SOURCE_PROMPTS, ADD_SOURCE_QUESTIONS, addSourceFooter, parseSharePointSite, yesNo } from '../src/ui/settings.js';
import { SHAREPOINT_CONSENT } from '../src/experimental/sharepoint-consent.js';

describe('parseSharePointSite', () => {
  it('keeps only the site of a link to one of its pages', () => {
    expect(parseSharePointSite('https://tenant.sharepoint.com/sites/Product/SitePages/Home.aspx?csf=1&web=1#top'))
      .toEqual({ url: 'https://tenant.sharepoint.com/sites/Product', name: 'Product' });
    expect(parseSharePointSite('https://tenant.sharepoint.com/sites/Product/Shared%20Documents/Forms/AllItems.aspx'))
      .toEqual({ url: 'https://tenant.sharepoint.com/sites/Product', name: 'Product' });
  });

  it('accepts the site itself, a trailing slash, teams, and any case', () => {
    expect(parseSharePointSite('https://tenant.sharepoint.com/sites/Product')?.['url']).toBe('https://tenant.sharepoint.com/sites/Product');
    expect(parseSharePointSite('  https://tenant.sharepoint.com/sites/Product/\n')).toEqual({ url: 'https://tenant.sharepoint.com/sites/Product', name: 'Product' });
    expect(parseSharePointSite('https://Tenant.SharePoint.com/Teams/Product-Team/')).toEqual({ url: 'https://tenant.sharepoint.com/teams/Product-Team', name: 'Product-Team' });
  });

  it('upgrades http and keeps an encoded name as typed, with the readable name', () => {
    expect(parseSharePointSite('http://tenant.sharepoint.com/sites/Product')?.['url']).toBe('https://tenant.sharepoint.com/sites/Product');
    expect(parseSharePointSite('https://tenant.sharepoint.com/sites/Product%20Team/SitePages/A.aspx'))
      .toEqual({ url: 'https://tenant.sharepoint.com/sites/Product%20Team', name: 'Product Team' });
  });

  it('is not a SharePoint site when it is on another host, or one of several links', () => {
    expect(parseSharePointSite('https://www.example.com/feed.xml')).toBeUndefined();
    expect(parseSharePointSite('https://tenant.sharepoint.com.example.com/sites/Product')).toBeUndefined();
    expect(parseSharePointSite('https://github.com/octo/app')).toBeUndefined();
    expect(parseSharePointSite('not a url')).toBeUndefined();
    expect(parseSharePointSite('')).toBeUndefined();
    expect(parseSharePointSite('https://tenant.sharepoint.com/sites/A/feed.xml https://www.example.com/feed.xml')).toBeUndefined();
  });

  it.each([
    ['a personal OneDrive', 'https://tenant-my.sharepoint.com/personal/someone_tenant_com/Documents'],
    ['the root site', 'https://tenant.sharepoint.com/'],
    ['a share link', 'https://tenant.sharepoint.com/:u:/r/sites/Product/SitePages/Home.aspx'],
    ['a site without a name', 'https://tenant.sharepoint.com/sites/'],
    ['a name with odd characters', 'https://tenant.sharepoint.com/sites/Pro%2Fduct'],
    ['a name that does not decode', 'https://tenant.sharepoint.com/sites/%E0%A4%A'],
  ])('explains what to paste for %s', (_what, link) => {
    const site = parseSharePointSite(link);
    expect(site).toBeDefined();
    expect(site).toHaveProperty('error');
    expect((site as { error: string }).error).toContain('https://tenant.sharepoint.com/sites/Team');
  });
});

describe('yesNo', () => {
  it.each(['y', 'Y', 'yes', 'YES', 'Yes', '  yes  '])('%j is yes', (text) => expect(yesNo(text)).toBe(true));
  it.each(['n', 'N', 'no', 'NO', ' No '])('%j is no', (text) => expect(yesNo(text)).toBe(false));
  it.each(['', 'maybe', 'yess', 'ye', 'ok', 'true'])('%j is neither', (text) => expect(yesNo(text)).toBeUndefined());
});

describe('add source prompts', () => {
  it('keeps the SharePoint row labels short enough for the name column', () => {
    for (const step of ['sharepoint-name', 'sharepoint-consent'] as const) {
      expect(`Add source · ${ADD_SOURCE_LABELS[step]}`.length).toBeLessThanOrEqual(21);
    }
  });

  it('asks the consent question in the row and states the scope in the footer', () => {
    expect(ADD_SOURCE_QUESTIONS['sharepoint-consent']).toMatch(/\[y\/N\] $/);
    expect(ADD_SOURCE_PROMPTS['sharepoint-consent']).toBe(SHAREPOINT_CONSENT);
    expect(addSourceFooter('sharepoint-consent')).toBe(`${SHAREPOINT_CONSENT}   ↵ confirm   Esc cancel`);
    expect(addSourceFooter('url')).toBe(`type ${ADD_SOURCE_PROMPTS.url}   ↵ next   Esc cancel`);
    expect(addSourceFooter('url')).not.toMatch(/type type/);
  });
});
