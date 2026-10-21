import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSource } from '../scraper/registry.js';
import { parseFeed } from '../scraper/feed.js';
import { newUserSource, sourceDraft, sourceDraftPatch, sourceEditInput, sourceInfo, isYoutubeChannelUrl } from '../scraper/specs.js';
import { parseYoutubeUrl, youtubeUrl } from '../scraper/youtube.js';
import { DEFAULT_SETTINGS, type AppSettings, type YoutubeSourceSpec } from '../types.js';

const ID = 'UC7c3Kb6jYCRj4JOHHZTxKsQ';

const entry = (videoId: string, title: string, published: string, kind = 'watch?v=') => `
  <entry>
    <id>yt:video:${videoId}</id>
    <title>${title}</title>
    <link rel="alternate" href="https://www.youtube.com/${kind}${videoId}"/>
    <published>${published}</published>
    <media:group>
      <media:title>${title}</media:title>
      <media:content url="https://www.youtube.com/v/${videoId}?version=3" type="application/x-shockwave-flash"/>
      <media:description>About ${title} &amp; more</media:description>
    </media:group>
  </entry>`;

const atom = (...entries: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>Channel</title>
  <link rel="alternate" href="https://www.youtube.com/channel/${ID}"/>
  ${entries.join('')}
</feed>`;

const channelPage = `<html><head>${'x'.repeat(70_000)}<link rel="canonical" href="https://www.youtube.com/channel/${ID}"></head></html>`;

/** Answers YouTube requests from a URL → response table; anything else is a 404. */
function mockYoutube(routes: Record<string, string>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const body = routes[url];
    return body === undefined ? new Response('not found', { status: 404 }) : new Response(body, { status: 200 });
  });
}

const feedUrl = (query: string) => `https://www.youtube.com/feeds/videos.xml?${query}`;

describe('YouTube URLs', () => {
  it.each([
    ['https://www.youtube.com/@GitHub', { channel: '@GitHub' }],
    ['https://youtube.com/@GitHub/videos', { channel: '@GitHub' }],
    ['https://m.youtube.com/@git.hub-1', { channel: '@git.hub-1' }],
    [`https://www.youtube.com/channel/${ID}`, { channel: ID }],
    ['https://www.youtube.com/c/Fireship', { channel: 'c/Fireship' }],
    ['https://www.youtube.com/user/GoogleDevelopers', { channel: 'user/GoogleDevelopers' }],
    [`https://www.youtube.com/feeds/videos.xml?channel_id=${ID}`, { channel: ID }],
    ['https://www.youtube.com/playlist?list=PLlrxD0HtieHhS8VzuMCfQD4uJ9yne1mE6', { playlist: 'PLlrxD0HtieHhS8VzuMCfQD4uJ9yne1mE6' }],
    ['https://www.youtube.com/feeds/videos.xml?playlist_id=PLlrxD0HtieHhS8VzuMCfQD4uJ9yne1mE6', { playlist: 'PLlrxD0HtieHhS8VzuMCfQD4uJ9yne1mE6' }],
  ])('reads %s', (url, target) => {
    expect(parseYoutubeUrl(url)).toEqual(target);
  });

  it('rejects video URLs and leaves other sites alone', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/watch?v=ZQ0Qq6LlAmI')).toHaveProperty('error');
    expect(parseYoutubeUrl('https://youtu.be/ZQ0Qq6LlAmI')).toHaveProperty('error');
    expect(parseYoutubeUrl('https://www.youtube.com/shorts/abc')).toHaveProperty('error');
    expect(parseYoutubeUrl('https://www.youtube.com/')).toHaveProperty('error');
    expect(parseYoutubeUrl('https://example.com/@GitHub')).toBeUndefined();
    expect(parseYoutubeUrl('not a url')).toBeUndefined();
  });

  it('turns a target back into a URL', () => {
    expect(youtubeUrl({ channel: '@GitHub' })).toBe('https://www.youtube.com/@GitHub');
    expect(youtubeUrl({ channel: ID })).toBe(`https://www.youtube.com/channel/${ID}`);
    expect(youtubeUrl({ playlist: 'PL123456789012' })).toBe('https://www.youtube.com/playlist?list=PL123456789012');
  });
});

describe('YouTube user sources', () => {
  const settings = (patch: Partial<AppSettings> = {}): AppSettings => ({ ...DEFAULT_SETTINGS, ...patch });

  it('builds a channel source without Shorts by default', () => {
    expect(newUserSource({ url: 'https://www.youtube.com/@GitHub', include: 'copilot' })).toEqual({
      spec: { kind: 'youtube', id: 'github-on-youtube', displayName: '@GitHub on YouTube', channel: '@GitHub', include: 'copilot' },
    });
    expect(newUserSource({ url: 'https://www.youtube.com/@GitHub', name: 'GH', shorts: true })).toMatchObject({ spec: { channel: '@GitHub', shorts: true } });
    expect(newUserSource({ url: 'https://www.youtube.com/playlist?list=PL123456789012', shorts: true })).toEqual({
      spec: { kind: 'youtube', id: 'youtube-playlist', displayName: 'YouTube playlist', playlist: 'PL123456789012' },
    });
  });

  it('rejects videos and several YouTube URLs in one source', () => {
    expect(newUserSource({ url: 'https://www.youtube.com/watch?v=ZQ0Qq6LlAmI' })).toHaveProperty('error');
    expect(newUserSource({ url: 'https://www.youtube.com/@a https://www.youtube.com/@b' })).toHaveProperty('error');
    expect(newUserSource({ url: 'https://example.com/rss https://www.youtube.com/@b' })).toHaveProperty('error');
  });

  it('describes and edits a YouTube source', () => {
    const yt: YoutubeSourceSpec = { kind: 'youtube', id: 'gh', displayName: 'GH', channel: '@GitHub', include: 'ai' };
    expect(sourceInfo(yt)).toMatchObject({ kind: 'youtube', location: 'https://www.youtube.com/@GitHub', filter: 'keywords /ai/, no Shorts' });
    expect(sourceInfo({ ...yt, include: undefined, shorts: true }).filter).toBeUndefined();
    expect(sourceEditInput(yt)).toEqual({ url: 'https://www.youtube.com/@GitHub', name: 'GH', include: 'ai', shorts: false });

    const current = settings({ userSources: [yt] });
    const draft = sourceDraft(current, 'gh');
    expect(draft).toMatchObject({ url: 'https://www.youtube.com/@GitHub', shorts: false });
    expect(sourceDraftPatch(current, 'gh', { ...draft, shorts: true })).toMatchObject({
      patch: { userSources: [{ kind: 'youtube', id: 'gh', channel: '@GitHub', shorts: true, include: 'ai' }] },
    });
  });

  it('knows which URLs have a Shorts toggle', () => {
    expect(isYoutubeChannelUrl('https://www.youtube.com/@GitHub')).toBe(true);
    expect(isYoutubeChannelUrl('https://www.youtube.com/playlist?list=PL123456789012')).toBe(false);
    expect(isYoutubeChannelUrl('https://example.com/rss')).toBe(false);
  });
});

describe('YouTube fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const spec = (patch: Partial<YoutubeSourceSpec> = {}): YoutubeSourceSpec => ({ kind: 'youtube', id: 'gh', displayName: 'GH', channel: ID, ...patch });

  it('reads the video description from media:description', () => {
    const [item] = parseFeed(atom(entry('v1', 'Hello', '2026-10-21T16:53:35+00:00')));
    expect(item).toMatchObject({ title: 'Hello', url: 'https://www.youtube.com/watch?v=v1', content: 'About Hello & more' });
  });

  it('merges videos and live streams, skipping Shorts, newest first', async () => {
    const fetchMock = mockYoutube({
      [feedUrl(`playlist_id=UULF${ID.slice(2)}`)]: atom(entry('v1', 'Older video', '2026-10-10T00:00:00Z'), entry('v3', 'Newest video', '2026-10-21T00:00:00Z')),
      [feedUrl(`playlist_id=UULV${ID.slice(2)}`)]: atom(entry('v2', 'Stream', '2026-10-15T00:00:00Z')),
    });
    const items = await createSource(spec()).fetch();
    expect(items.map((i) => i.title)).toEqual(['Newest video', 'Stream', 'Older video']);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('reads exact duration metadata from video pages', async () => {
    mockYoutube({
      [feedUrl('playlist_id=PL123456789012')]: atom(entry('v1', 'Lesson', '2026-10-10T00:00:00Z')),
      'https://www.youtube.com/watch?v=v1': '<meta itemprop="duration" content="PT1H2M3S">',
    });
    const items = await createSource(spec({ channel: undefined, playlist: 'PL123456789012' })).fetch();
    expect(items[0]?.durationSeconds).toBe(3723);
  });

  it('copes with a channel that never streamed (no live playlist)', async () => {
    mockYoutube({ [feedUrl(`playlist_id=UULF${ID.slice(2)}`)]: atom(entry('v1', 'Video', '2026-10-10T00:00:00Z')) });
    await expect(createSource(spec()).fetch()).resolves.toHaveLength(1);
  });

  it('returns nothing for a channel with only Shorts, but fails for an unknown channel', async () => {
    mockYoutube({ [feedUrl(`channel_id=${ID}`)]: atom(entry('s1', 'Short', '2026-10-10T00:00:00Z', 'shorts/')) });
    await expect(createSource(spec()).fetch()).resolves.toEqual([]);

    vi.restoreAllMocks();
    mockYoutube({});
    await expect(createSource(spec()).fetch()).rejects.toThrow(`[gh] fetch failed: YouTube channel ${ID} not found`);
  });

  it('uses the whole channel feed when Shorts are on, and applies the keyword filter', async () => {
    mockYoutube({
      [feedUrl(`channel_id=${ID}`)]: atom(entry('s1', 'Copilot short', '2026-10-10T00:00:00Z', 'shorts/'), entry('v1', 'Other', '2026-10-11T00:00:00Z')),
    });
    const items = await createSource(spec({ shorts: true, include: 'copilot' })).fetch();
    expect(items.map((i) => i.url)).toEqual(['https://www.youtube.com/shorts/s1']);
  });

  it('fetches a playlist', async () => {
    mockYoutube({ [feedUrl('playlist_id=PL123456789012')]: atom(entry('v1', 'Lesson', '2026-10-10T00:00:00Z')) });
    await expect(createSource(spec({ channel: undefined, playlist: 'PL123456789012' })).fetch()).resolves.toHaveLength(1);
  });

  it('resolves a handle once, skipping the EU consent page', async () => {
    const fetchMock = mockYoutube({
      'https://www.youtube.com/@resolve-me': channelPage,
      [feedUrl(`playlist_id=UULF${ID.slice(2)}`)]: atom(entry('v1', 'Video', '2026-10-10T00:00:00Z')),
    });
    const source = createSource(spec({ channel: '@resolve-me' }));
    await expect(source.fetch()).resolves.toHaveLength(1);
    await source.fetch();
    const pageCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('@resolve-me'));
    expect(pageCalls).toHaveLength(1);
    expect((pageCalls[0]![1]!.headers as Record<string, string>).Cookie).toBe('SOCS=CAI');
  });

  it('reports an unknown handle', async () => {
    mockYoutube({});
    await expect(createSource(spec({ channel: '@nobody-here' })).fetch()).rejects.toThrow('YouTube channel @nobody-here not found');
  });
});
