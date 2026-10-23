import { describe, it, expect } from 'vitest';
import { canonicalUrl, DuplicateIndex, nextDuplicate, titleKey, type DuplicateRow } from '../duplicates.js';
import type { Update } from '../types.js';

describe('canonicalUrl', () => {
  it('ignores scheme, www, fragment, trailing slash and tracking parameters', () => {
    expect(canonicalUrl('http://www.Example.com/a/?utm_source=rss&b=2&a=1#top')).toBe('example.com/a?a=1&b=2');
    expect(canonicalUrl('https://example.com/a')).toBe('example.com/a');
  });

  it('keeps parameters that identify the page', () => {
    expect(canonicalUrl('https://azure.microsoft.com/updates?id=1')).not.toBe(canonicalUrl('https://azure.microsoft.com/updates?id=2'));
    expect(canonicalUrl('https://azure.microsoft.com/en-us/updates?id=1')).toBe(canonicalUrl('https://azure.microsoft.com/updates?id=1'));
  });

  it('reduces both Tech Community URL formats to the post id', () => {
    const old = 'https://techcommunity.microsoft.com/t5/apps-on-azure-blog/azure-sre-agent-introducing-live-reports/ba-p/4549732';
    const now = 'https://techcommunity.microsoft.com/blog/appsonazureblog/azure-sre-agent-introducing-live-reports/4549732';
    expect(canonicalUrl(old)).toBe('techcommunity.microsoft.com/post/4549732');
    expect(canonicalUrl(now)).toBe(canonicalUrl(old));
  });

  it('treats every URL of one YouTube video as the same page', () => {
    const urls = [
      'https://www.youtube.com/watch?v=ZQ0Qq6LlAmI',
      'https://m.youtube.com/watch?v=ZQ0Qq6LlAmI&t=42s',
      'https://www.youtube.com/shorts/ZQ0Qq6LlAmI',
      'https://youtube.com/live/ZQ0Qq6LlAmI?si=share',
      'https://youtu.be/ZQ0Qq6LlAmI',
    ];
    for (const url of urls) expect(canonicalUrl(url), url).toBe('youtube.com/watch?v=ZQ0Qq6LlAmI');
    expect(canonicalUrl('https://www.youtube.com/shorts/other')).not.toBe(canonicalUrl(urls[0]!));
    expect(canonicalUrl('https://www.youtube.com/@GitHub')).toBe('youtube.com/@GitHub');
  });

  it('returns unparsable input trimmed', () => {
    expect(canonicalUrl(' not a url ')).toBe('not a url');
  });
});

describe('titleKey', () => {
  it('ignores case and punctuation', () => {
    expect(titleKey('[Launched] Generally Available: Ubuntu 24.04')).toBe(titleKey('[launched] generally available — ubuntu 24 04'));
  });

  it('skips titles too short to identify a post', () => {
    expect(titleKey('v1.2.3')).toBeUndefined();
    expect(titleKey('Weekly release notes')).toBeUndefined();
  });
});

describe('DuplicateIndex', () => {
  const row = (id: string, url: string, title: string, dateAdded: string, extra: Partial<DuplicateRow> = {}): DuplicateRow =>
    ({ id, url, title, datePublished: dateAdded, dateAdded, ...extra });

  it('marks later copies of a stored page as duplicates of the first added', () => {
    const index = new DuplicateIndex([
      row('b__2', 'https://example.com/x/', 'Some post', '2026-02-01'),
      row('a__1', 'https://example.com/x', 'Some post', '2026-01-01'),
    ]);
    expect(index.corrections()).toEqual([{ id: 'b__2', duplicateOf: 'a__1' }]);
  });

  it('clears a stale duplicateOf and leaves correct ones alone', () => {
    const index = new DuplicateIndex([
      row('a__1', 'https://example.com/x', 'Some post', '2026-01-01', { duplicateOf: 'gone__9' }),
      row('b__2', 'https://example.com/x', 'Some post', '2026-02-01', { duplicateOf: 'a__1' }),
    ]);
    expect(index.corrections()).toEqual([{ id: 'a__1', duplicateOf: '' }]);
  });

  it('classifies fetched items', () => {
    const index = new DuplicateIndex([row('a__1', 'https://example.com/x', 'Azure SRE Agent introducing live reports', '2026-01-01')]);
    expect(index.check('a__1', 'https://example.com/x', 'whatever', '2026-01-01')).toEqual({ kind: 'existing' });
    expect(index.check('b__2', 'https://www.example.com/x/', 'whatever', '2026-01-01')).toEqual({ kind: 'skip', of: 'a__1' });
    expect(index.check('c__3', 'https://other.com/y', 'Azure SRE Agent: Introducing Live Reports', '2026-02-01'))
      .toEqual({ kind: 'new', duplicateOf: 'a__1' });
    expect(index.check('d__4', 'https://other.com/z', 'Azure SRE Agent: Introducing Live Reports', '2027-01-01')).toEqual({ kind: 'new' });
  });

  it('remembers items as they are checked, across sources', () => {
    const index = new DuplicateIndex([]);
    expect(index.check('a__1', 'https://example.com/x', 'one', '2026-01-01')).toEqual({ kind: 'new' });
    expect(index.check('b__1', 'https://example.com/x#frag', 'one', '2026-01-01')).toEqual({ kind: 'skip', of: 'a__1' });
  });
});

describe('nextDuplicate', () => {
  const u = (id: string, duplicateOf?: string) => ({ id, ...(duplicateOf ? { duplicateOf } : {}) }) as Update;
  // Listed in this order: a original, x unrelated, b copy of a, y unrelated, c copy of a, z unrelated.
  const list = [u('a__1'), u('x__1'), u('b__2', 'a__1'), u('y__1'), u('c__3', 'a__1'), u('z__1')];

  it('goes from a copy to its original, and from the original to a copy', () => {
    expect(nextDuplicate([u('a__1'), u('b__2', 'a__1')], u('b__2', 'a__1'))?.id).toBe('a__1');
    expect(nextDuplicate([u('a__1'), u('b__2', 'a__1')], u('a__1'))?.id).toBe('b__2');
  });

  it('cycles through every listed member of the group, wrapping around, and ignores other posts', () => {
    expect(nextDuplicate(list, list[0]!)?.id).toBe('b__2');
    expect(nextDuplicate(list, list[2]!)?.id).toBe('c__3');
    expect(nextDuplicate(list, list[4]!)?.id).toBe('a__1');
  });

  it('finds the other copies of a group whose original is not listed', () => {
    expect(nextDuplicate([u('b__2', 'a__1'), u('c__3', 'a__1')], u('b__2', 'a__1'))?.id).toBe('c__3');
  });

  it('is undefined when nothing else in the list repeats the post', () => {
    expect(nextDuplicate([u('a__1'), u('x__1')], u('a__1'))).toBeUndefined();
    expect(nextDuplicate([u('b__2', 'a__1')], u('b__2', 'a__1'))).toBeUndefined();
    expect(nextDuplicate([], u('a__1'))).toBeUndefined();
  });

  it('works for an update that is not in the list', () => {
    expect(nextDuplicate([u('x__1'), u('a__1')], u('b__2', 'a__1'))?.id).toBe('a__1');
  });
});
