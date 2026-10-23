import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSource } from '../scraper/registry.js';
import { videoDuration } from '../scraper/youtube.js';
import { createYoutubeApi, nextQuotaReset, parseIsoDuration, YoutubeApiError } from '../scraper/youtube-api.js';
import type { YoutubeSourceSpec } from '../types.js';

const KEY = 'fake-youtube-key-0123456789-abcdefghi';
const ID = 'UC7c3Kb6jYCRj4JOHHZTxKsQ';
const BASE = ID.slice(2);

interface Video { id: string; title: string; published?: string; description?: string; privacy?: string }

const item = (v: Video) => ({
  snippet: { title: v.title, description: v.description ?? `About ${v.title}`, publishedAt: v.published ?? '2026-10-22T00:00:00Z', resourceId: { videoId: v.id } },
  contentDetails: { videoId: v.id, ...(v.published ? { videoPublishedAt: v.published } : {}) },
  status: { privacyStatus: v.privacy ?? 'public' },
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, reason: string, details?: string) =>
  json({ error: { code: status, message: `Error ${reason}`, errors: [{ reason }], ...(details ? { details: [{ reason: details }] } : {}) } }, status);

interface FakeData {
  /** `id`, `forHandle` or `forUsername` value → channel id */
  channels?: Record<string, string>;
  playlists?: Record<string, Video[]>;
  /** id → ISO duration and live state */
  videos?: Record<string, { duration: string; live?: string }>;
}

/** A stand-in for the YouTube Data API: answers channels, playlistItems and videos from `data`. */
function fakeApi(data: FakeData, override?: (url: URL) => Response | Promise<Response> | undefined) {
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input));
    const custom = await override?.(url);
    if (custom) return custom;
    const q = url.searchParams;
    switch (url.pathname.replace('/youtube/v3/', '')) {
      case 'channels': {
        const id = data.channels?.[q.get('id') ?? q.get('forHandle') ?? q.get('forUsername') ?? ''];
        return json(id ? { items: [{ id }] } : {});
      }
      case 'playlistItems': {
        const list = data.playlists?.[q.get('playlistId') ?? ''];
        if (!list) return apiError(404, 'playlistNotFound');
        return json({ items: list.slice(0, Number(q.get('maxResults'))).map(item) });
      }
      case 'videos': {
        const ids = (q.get('id') ?? '').split(',');
        return json({
          items: ids.flatMap((id) => {
            const v = data.videos?.[id];
            return v ? [{ id, contentDetails: { duration: v.duration }, snippet: { liveBroadcastContent: v.live ?? 'none' } }] : [];
          }),
        });
      }
    }
    return new Response('not found', { status: 404 });
  });
  const api = createYoutubeApi({ apiKey: KEY, fetch: fetch as typeof globalThis.fetch, sleep: async () => undefined });
  const calls = () => fetch.mock.calls.map(([u]) => new URL(String(u)));
  const endpoint = (name: string) => calls().filter((u) => u.pathname.endsWith(`/${name}`));
  return { api, fetch, calls, endpoint };
}

const spec = (patch: Partial<YoutubeSourceSpec> = {}): YoutubeSourceSpec => ({ kind: 'youtube', id: 'gh', displayName: 'GH', channel: ID, ...patch });

describe('YouTube Data API source', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('merges videos and live streams with their lengths, sending the key only in a header', async () => {
    const fake = fakeApi({
      channels: { '@api-merge': ID },
      playlists: {
        [`UULF${BASE}`]: [{ id: 'v3', title: 'Newest video', published: '2026-10-21T00:00:00Z' }, { id: 'v1', title: 'Older video', published: '2026-10-10T00:00:00Z' }],
        [`UULV${BASE}`]: [{ id: 'v2', title: 'Stream', published: '2026-10-15T00:00:00Z' }, { id: 'v3', title: 'Newest video', published: '2026-10-21T00:00:00Z' }],
      },
      videos: { v1: { duration: 'PT1H2M3S' }, v2: { duration: 'PT45M' }, v3: { duration: 'PT59S' } },
    });
    const source = createSource(spec({ channel: '@api-merge' }), { youtube: fake.api });
    const items = await source.fetch();
    expect(items.map((i) => [i.title, i.url, i.durationSeconds])).toEqual([
      ['Newest video', 'https://www.youtube.com/watch?v=v3', 59],
      ['Stream', 'https://www.youtube.com/watch?v=v2', 2700],
      ['Older video', 'https://www.youtube.com/watch?v=v1', 3723],
    ]);
    expect(items[0]).toMatchObject({ content: 'About Newest video', datePublished: new Date('2026-10-21T00:00:00Z') });

    for (const [url, init] of fake.fetch.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/www\.googleapis\.com\/youtube\/v3\//);
      expect(String(url)).not.toContain(KEY);
      expect((init!.headers as Record<string, string>)['X-Goog-Api-Key']).toBe(KEY);
    }
    expect(fake.calls().map((u) => u.pathname.split('/').pop())).toEqual(['channels', 'playlistItems', 'playlistItems', 'videos']);
    expect(fake.endpoint('playlistItems').map((u) => u.searchParams.get('maxResults'))).toEqual(['15', '15']);

    // The handle and the finished videos' lengths are remembered: two calls per refresh
    fake.fetch.mockClear();
    await source.fetch();
    expect(fake.calls().map((u) => u.pathname.split('/').pop())).toEqual(['playlistItems', 'playlistItems']);
  });

  it('copes with a channel that never streamed, and stops asking for its live playlist', async () => {
    const fake = fakeApi({
      channels: { [ID]: ID },
      playlists: { [`UULF${BASE}`]: [{ id: 'v1', title: 'Video', published: '2026-10-10T00:00:00Z' }] },
      videos: { v1: { duration: 'PT1M' } },
    });
    const source = createSource(spec(), { youtube: fake.api });
    await expect(source.fetch()).resolves.toHaveLength(1);
    await source.fetch();
    expect(fake.endpoint('playlistItems').map((u) => u.searchParams.get('playlistId'))).toEqual([`UULF${BASE}`, `UULV${BASE}`, `UULF${BASE}`]);
  });

  it('returns nothing for a channel with only Shorts, but fails for an unknown one', async () => {
    const fake = fakeApi({ channels: { '@only-shorts': ID } });
    await expect(createSource(spec({ channel: '@only-shorts' }), { youtube: fake.api }).fetch()).resolves.toEqual([]);
    await expect(createSource(spec({ channel: '@nobody-api' }), { youtube: fake.api }).fetch())
      .rejects.toThrow('[gh] fetch failed: YouTube channel @nobody-api not found');
  });

  it('looks up legacy user names', async () => {
    const fake = fakeApi({ channels: { GoogleDevelopers: ID }, playlists: { [`UULF${BASE}`]: [] } });
    await createSource(spec({ channel: 'user/GoogleDevelopers' }), { youtube: fake.api }).fetch();
    expect(fake.endpoint('channels')[0]!.searchParams.get('forUsername')).toBe('GoogleDevelopers');
  });

  it('lists every upload with Shorts on, giving Shorts their /shorts/ URL', async () => {
    const fake = fakeApi({
      channels: { [ID]: ID },
      playlists: {
        [`UU${BASE}`]: [{ id: 's1', title: 'Copilot short', published: '2026-10-12T00:00:00Z' }, { id: 'v1', title: 'Copilot video', published: '2026-10-11T00:00:00Z' }],
        [`UUSH${BASE}`]: [{ id: 's1', title: 'Copilot short', published: '2026-10-12T00:00:00Z' }],
      },
    });
    const items = await createSource(spec({ shorts: true }), { youtube: fake.api }).fetch();
    expect(items.map((i) => i.url)).toEqual(['https://www.youtube.com/shorts/s1', 'https://www.youtube.com/watch?v=v1']);
  });

  it('fetches a playlist, applies the keyword filter and reports a missing playlist', async () => {
    const fake = fakeApi({
      playlists: {
        PL123456789012: [
          { id: 'v1', title: 'Lesson one', published: '2026-10-10T00:00:00Z', description: 'All about Copilot' },
          { id: 'v2', title: 'Lesson two', published: '2026-10-11T00:00:00Z', description: 'Something else' },
        ],
      },
    });
    const items = await createSource(spec({ channel: undefined, playlist: 'PL123456789012', include: 'copilot' }), { youtube: fake.api }).fetch();
    expect(items.map((i) => i.title)).toEqual(['Lesson one']);
    expect(fake.endpoint('videos')[0]!.searchParams.get('id')).toBe('v1');

    await expect(createSource(spec({ channel: undefined, playlist: 'PLmissing0000' }), { youtube: fake.api }).fetch())
      .rejects.toThrow('YouTube playlist PLmissing0000 not found');
    await expect(createSource(spec({ channel: undefined, playlist: 'PL123456789012', include: '(' }), { youtube: fake.api }).fetch())
      .rejects.toThrow(/Invalid regular expression/);
  });

  it('drops private and deleted placeholders', async () => {
    const fake = fakeApi({
      playlists: {
        PL123456789012: [
          { id: 'v1', title: 'Public', published: '2026-10-10T00:00:00Z' },
          { id: 'p1', title: 'Private video', privacy: 'private' },
          { id: 'd1', title: 'Deleted video' },
        ],
      },
      videos: { v1: { duration: 'PT1M' } },
    });
    const items = await createSource(spec({ channel: undefined, playlist: 'PL123456789012' }), { youtube: fake.api }).fetch();
    expect(items.map((i) => i.title)).toEqual(['Public']);
  });

  it('asks again for the length of a live stream until it has ended', async () => {
    const data: FakeData = {
      playlists: { PL123456789012: [{ id: 'l1', title: 'Live now', published: '2026-10-22T00:00:00Z' }, { id: 'v1', title: 'Done', published: '2026-10-21T00:00:00Z' }] },
      videos: { l1: { duration: 'P0D', live: 'live' }, v1: { duration: 'PT10M' } },
    };
    const fake = fakeApi(data);
    const source = createSource(spec({ channel: undefined, playlist: 'PL123456789012' }), { youtube: fake.api });
    expect((await source.fetch()).map((i) => i.durationSeconds)).toEqual([undefined, 600]);

    data.videos!.l1 = { duration: 'PT2H' };
    expect((await source.fetch()).map((i) => i.durationSeconds)).toEqual([7200, 600]);
    expect(fake.endpoint('videos').map((u) => u.searchParams.get('id'))).toEqual(['l1,v1', 'l1']);
  });

  it('keeps the list when the lengths can’t be read', async () => {
    const fake = fakeApi(
      { playlists: { PL123456789012: [{ id: 'v1', title: 'Lesson', published: '2026-10-10T00:00:00Z' }] } },
      (url) => (url.pathname.endsWith('/videos') ? new Response('down', { status: 503 }) : undefined),
    );
    const items = await createSource(spec({ channel: undefined, playlist: 'PL123456789012' }), { youtube: fake.api }).fetch();
    expect(items).toHaveLength(1);
    expect(items[0]!.durationSeconds).toBeUndefined();
  });

  it('switches to the public feeds once the quota is used up, until it resets', async () => {
    const fake = fakeApi({ channels: { [ID]: ID } }, (url) => (url.pathname.endsWith('/playlistItems') ? apiError(403, 'quotaExceeded') : undefined));
    const feeds = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).includes(`playlist_id=UULF${BASE}`)
        ? new Response(`<feed><entry><title>From the feed</title><link rel="alternate" href="https://www.youtube.com/watch?v=f1"/><published>2026-10-10T00:00:00Z</published></entry></feed>`)
        : new Response('not found', { status: 404 }));

    const source = createSource(spec(), { youtube: fake.api });
    await expect(source.fetch()).resolves.toMatchObject([{ title: 'From the feed', url: 'https://www.youtube.com/watch?v=f1' }]);
    expect(fake.api.quota().blockedUntil).toBeInstanceOf(Date);
    const apiCalls = fake.fetch.mock.calls.length;

    await expect(source.fetch()).resolves.toHaveLength(1);
    expect(fake.fetch.mock.calls.length).toBe(apiCalls);
    expect(feeds.mock.calls.every(([u]) => String(u).startsWith('https://www.youtube.com/feeds/'))).toBe(true);
  });

  it('reads a video’s length for u, by id from any video URL', async () => {
    const fake = fakeApi({ videos: { abc: { duration: 'PT14M9S' } } });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no youtube.com'));
    await expect(videoDuration('https://www.youtube.com/shorts/abc', fake.api)).resolves.toBe(849);
    await expect(videoDuration('https://youtu.be/abc', fake.api)).resolves.toBe(849);
    await expect(videoDuration('https://www.youtube.com/watch?v=gone', fake.api)).resolves.toBeUndefined();
    // u asks every time, even for a length it already has
    expect(fake.endpoint('videos')).toHaveLength(3);
  });
});

describe('YouTube Data API client', () => {
  it('asks for at most 50 videos at a time and only for ones it doesn’t know', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const fake = fakeApi({ videos: Object.fromEntries(ids.map((id) => [id, { duration: 'PT1M' }])) });
    expect((await fake.api.videos(ids)).size).toBe(120);
    expect(fake.endpoint('videos').map((u) => u.searchParams.get('id')!.split(',').length)).toEqual([50, 50, 20]);

    await fake.api.videos([...ids.slice(0, 10), 'v-new']);
    expect(fake.endpoint('videos')).toHaveLength(4);
    expect(fake.endpoint('videos')[3]!.searchParams.get('id')).toBe('v-new');
    expect(fake.api.quota().unitsToday).toBe(4);
  });

  it.each([
    [apiError(400, 'keyInvalid', 'API_KEY_INVALID'), 'YouTube API key is not valid'],
    [apiError(403, 'accessNotConfigured', 'SERVICE_DISABLED'), 'Enable YouTube Data API v3 for this API key’s Google Cloud project'],
    [apiError(403, 'forbidden', 'API_KEY_SERVICE_BLOCKED'), 'The YouTube API key is restricted to other APIs'],
    [apiError(403, 'quotaExceeded'), /^YouTube API quota used up; resets /],
    [apiError(400, 'badRequest'), 'YouTube API HTTP 400: Error badRequest'],
  ])('explains an error: %#', async (response, message) => {
    const fake = fakeApi({}, () => response.clone());
    await expect(fake.api.channelId(ID)).rejects.toThrow(message);
    expect(fake.fetch).toHaveBeenCalledTimes(1);
  });

  it('stops calling once the quota is used up', async () => {
    const fake = fakeApi({}, () => apiError(403, 'quotaExceeded'));
    await expect(fake.api.playlistItems('PL123456789012')).rejects.toBeInstanceOf(YoutubeApiError);
    await expect(fake.api.videos(['a'])).rejects.toMatchObject({ reason: 'quotaExceeded' });
    expect(fake.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries once after a server error, a rate limit or a network failure', async () => {
    let failures = 1;
    const fake = fakeApi({ channels: { [ID]: ID } }, () => (failures-- > 0 ? new Response('down', { status: 503 }) : undefined));
    await expect(fake.api.channelId(ID)).resolves.toBe(ID);
    expect(fake.fetch).toHaveBeenCalledTimes(2);

    const limited = fakeApi({}, () => apiError(429, 'rateLimitExceeded'));
    await expect(limited.api.channelId(ID)).rejects.toThrow('YouTube API rate limit');
    expect(limited.fetch).toHaveBeenCalledTimes(2);

    const offline = fakeApi({}, () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) });
    });
    await expect(offline.api.channelId(ID)).rejects.toThrow('YouTube API request failed: fetch failed (UND_ERR_CONNECT_TIMEOUT)');
    expect(offline.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a limit on requests in flight', async () => {
    let active = 0;
    let peak = 0;
    const fetch = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return json({ items: [] });
    });
    const api = createYoutubeApi({ apiKey: KEY, fetch: fetch as unknown as typeof globalThis.fetch, maxConcurrent: 2 });
    await Promise.all(Array.from({ length: 6 }, (_, i) => api.playlistItems(`PL${i}234567890`)));
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(peak).toBe(2);
  });

  it('reads ISO 8601 durations', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('PT59S')).toBe(59);
    expect(parseIsoDuration('P1DT1M')).toBe(86_460);
    expect(parseIsoDuration('P0D')).toBeUndefined();
    expect(parseIsoDuration('PT0S')).toBeUndefined();
    expect(parseIsoDuration('soon')).toBeUndefined();
    expect(parseIsoDuration(undefined)).toBeUndefined();
  });

  it('resets the quota at midnight Pacific time', () => {
    expect(nextQuotaReset(new Date('2026-10-22T20:00:00Z')).toISOString()).toBe('2026-10-23T07:00:00.000Z');
    expect(nextQuotaReset(new Date('2026-12-01T09:30:00Z')).toISOString()).toBe('2026-12-02T08:00:00.000Z');
  });
});
