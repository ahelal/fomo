import type { ScrapedItem, YoutubeSourceSpec } from '../types.js';
import { parseFeed } from './feed.js';
import { TIMEOUT_MS, USER_AGENT } from './http.js';
import { dedupByUrl, MAX_CONTENT } from './text.js';
import { createLimiter } from '../util.js';
import { isYoutubeQuotaError, parseIsoDuration, type YoutubeApi, type YoutubePlaylistItem } from './youtube-api.js';

/** What a YouTube URL points at: a channel (`UC…` id, `@handle`, `c/Name`, `user/Name`) or a playlist. */
export type YoutubeTarget = { channel: string } | { playlist: string };

const HOST = /^(?:www\.|m\.)?youtube\.com$/i;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const PLAYLIST_ID = /^[\w-]{10,}$/;

/**
 * The channel or playlist of a YouTube URL; `{ error }` for a YouTube URL that names neither
 * (e.g. a single video), undefined for any other URL. Needs no network, so it runs in the browser.
 */
export function parseYoutubeUrl(text: string): YoutubeTarget | { error: string } | undefined {
  let url: URL;
  try { url = new URL(text); } catch { return undefined; }
  if (/^youtu\.be$/i.test(url.hostname)) return { error: 'That is a video; use its channel or playlist URL' };
  if (!HOST.test(url.hostname)) return undefined;

  const [first = '', second = ''] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const list = url.searchParams.get('list') ?? url.searchParams.get('playlist_id');
  const channelId = url.searchParams.get('channel_id');

  if (first === 'feeds' && channelId && CHANNEL_ID.test(channelId)) return { channel: channelId };
  if ((first === 'playlist' || first === 'feeds') && list && PLAYLIST_ID.test(list)) return { playlist: list };
  if (first === 'channel' && CHANNEL_ID.test(second)) return { channel: second };
  if (/^@[\w.-]+$/.test(first)) return { channel: first };
  if ((first === 'c' || first === 'user') && /^[\w.-]+$/.test(second)) return { channel: `${first}/${second}` };
  if (first === 'watch' || first === 'shorts' || first === 'live') return { error: 'That is a video; use its channel or playlist URL' };
  return { error: 'Use a YouTube channel URL (youtube.com/@name) or a playlist URL' };
}

/** The page a target came from, e.g. to edit it. */
export function youtubeUrl(spec: Pick<YoutubeSourceSpec, 'channel' | 'playlist'>): string {
  if (spec.playlist) return `https://www.youtube.com/playlist?list=${spec.playlist}`;
  const channel = spec.channel ?? '';
  return CHANNEL_ID.test(channel) ? `https://www.youtube.com/channel/${channel}` : `https://www.youtube.com/${channel}`;
}

/** A default name for a target. */
export function youtubeName(target: YoutubeTarget): string {
  if ('playlist' in target) return 'YouTube playlist';
  return CHANNEL_ID.test(target.channel) ? 'YouTube channel' : `${target.channel.replace(/^(c|user)\//, '')} on YouTube`;
}

const FEED = 'https://www.youtube.com/feeds/videos.xml';
/** Accepts YouTube's cookie consent, so EU requests are not redirected to consent.youtube.com. */
const CONSENT = 'SOCS=CAI';
/** Stop reading a channel page after this much without finding its id (the page is ~2.5 MB). */
const MAX_PAGE_BYTES = 4_000_000;
/** Duration metadata sits ~0.8–1 MB into a watch page (~1.6 MB). */
const MAX_VIDEO_PAGE_BYTES = 2_500_000;
/** Videos per playlist, as many as YouTube's feeds hold. */
const PLAYLIST_ITEMS = 15;
/** youtube.com requests in flight at once, across every YouTube source. */
const youtubeLimit = createLimiter(4);

const resolved = new Map<string, string>();

/**
 * The `UC…` id of a channel given by id, `@handle`, `c/Name` or `user/Name`. With `api` it asks the
 * YouTube Data API (`c/Name` has no API lookup); without, or once the quota is used up, it reads the
 * channel page. Cached per process.
 */
export async function resolveChannelId(channel: string, api?: YoutubeApi): Promise<string> {
  if (api && !channel.startsWith('c/')) {
    try {
      const id = await api.channelId(channel);
      resolved.set(channel, id);
      return id;
    } catch (err) {
      if (!isYoutubeQuotaError(err)) throw err;
    }
  }
  if (CHANNEL_ID.test(channel)) return channel;
  const cached = resolved.get(channel);
  if (cached) return cached;

  const id = await youtubeLimit(async () => {
    const res = await globalThis.fetch(`https://www.youtube.com/${channel}`, {
      headers: { 'User-Agent': USER_AGENT, Cookie: CONSENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) throw new Error(`YouTube channel ${channel} not found`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // The canonical link sits about a third into the page; stop reading there
    const canonical = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/;
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let page = '';
    let found: string | undefined;
    while (reader && !found && page.length < MAX_PAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      page += decoder.decode(value, { stream: true });
      found = page.match(canonical)?.[1];
    }
    if (reader) await reader.cancel().catch(() => undefined);
    else page = await res.text();
    return found ?? page.match(canonical)?.[1] ?? page.match(/"externalId":"(UC[\w-]{22})"/)?.[1];
  });
  if (!id) throw new Error(`Could not find the channel id of ${channel}`);
  resolved.set(channel, id);
  return id;
}

/** The feed, or undefined when YouTube has no such playlist (404). */
async function feed(query: string): Promise<string | undefined> {
  return youtubeLimit(async () => {
    const res = await globalThis.fetch(`${FEED}?${query}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
}

/** True for a video page: `youtube.com/watch?v=…`, `/shorts/…`, `/live/…` or `youtu.be/…`. */
export function isYoutubeVideoUrl(url: string): boolean {
  return youtubeVideoId(url) !== undefined;
}

/** The video id of a `youtube.com/watch?v=…`, `/shorts/…`, `/live/…`, `/embed/…` or `youtu.be/…` URL. */
export function youtubeVideoId(url: string): string | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  if (host === 'youtu.be') return u.pathname.match(/^\/([\w-]+)/)?.[1];
  if (host !== 'youtube.com') return undefined;
  if (u.pathname === '/watch') return u.searchParams.get('v') || undefined;
  return u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/)?.[1];
}

/**
 * A video's length in seconds: from the YouTube Data API with `api` (falling back to the page once
 * the quota is used up), otherwise from the watch page, read until the player metadata shows up.
 */
export async function videoDuration(url: string, api?: YoutubeApi): Promise<number | undefined> {
  const id = youtubeVideoId(url);
  if (api && id) {
    try {
      return (await api.videos([id], { fresh: true })).get(id)?.durationSeconds;
    } catch (err) {
      if (!isYoutubeQuotaError(err)) throw err;
    }
  }
  return youtubeLimit(async () => {
    const res = await globalThis.fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Cookie: CONSENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return undefined;

    const reader = res.body?.getReader();
    if (!reader) return parseVideoDuration(await res.text());

    const decoder = new TextDecoder();
    let page = '';
    let duration: number | undefined;
    while (!duration && page.length < MAX_VIDEO_PAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const from = Math.max(0, page.length - 512);
      page += decoder.decode(value, { stream: true });
      duration = parseVideoDuration(page.slice(from));
    }
    await reader.cancel().catch(() => undefined);
    return duration;
  });
}

function parseVideoDuration(page: string): number | undefined {
  const seconds = page.match(/"lengthSeconds"\s*:\s*"(\d+)"/)?.[1];
  if (seconds) {
    const duration = Number(seconds);
    if (Number.isSafeInteger(duration) && duration > 0) return duration;
  }

  const meta = page.match(/<meta\b(?=[^>]*\bitemprop=["']duration["'])[^>]*>/i)?.[0];
  return parseIsoDuration(meta?.match(/\bcontent=["'](PT(?=[\dHMS])[\dHMS.]+)["']/i)?.[1]);
}

const newestFirst = (items: ScrapedItem[]) => items.sort((a, b) => b.datePublished.getTime() - a.datePublished.getTime());

/**
 * The newest videos (15 per playlist). Without Shorts it merges the channel's “Videos” (`UULF…`)
 * and “Live” (`UULV…`) playlists; either is missing when the channel has none.
 *
 * With `api` it uses the YouTube Data API and adds each video's length. Without, or once the API
 * quota is used up, it reads YouTube's public feeds, which have no lengths (`u` reads one later).
 */
export async function fetchYoutube(spec: YoutubeSourceSpec, api?: YoutubeApi): Promise<ScrapedItem[]> {
  if (api) {
    try {
      return await fetchYoutubeApi(spec, api);
    } catch (err) {
      if (!isYoutubeQuotaError(err)) throw err;
    }
  }
  return fetchYoutubeFeeds(spec);
}

async function fetchYoutubeFeeds(spec: YoutubeSourceSpec): Promise<ScrapedItem[]> {
  const filter = { include: spec.include };
  if (spec.playlist) {
    const xml = await feed(`playlist_id=${spec.playlist}`);
    if (!xml) throw new Error(`YouTube playlist ${spec.playlist} not found`);
    return parseFeed(xml, filter);
  }
  if (!spec.channel) throw new Error('No YouTube channel or playlist');
  const id = await resolveChannelId(spec.channel);
  const uploads = id.slice(2);

  if (spec.shorts) {
    const xml = await feed(`channel_id=${id}`);
    if (!xml) throw new Error(`YouTube channel ${spec.channel} not found`);
    return parseFeed(xml, filter);
  }

  const [videos, live] = await Promise.all([feed(`playlist_id=UULF${uploads}`), feed(`playlist_id=UULV${uploads}`)]);
  if (!videos && !live && !(await feed(`channel_id=${id}`))) throw new Error(`YouTube channel ${spec.channel} not found`);
  return newestFirst(dedupByUrl([videos, live].flatMap((xml) => (xml ? parseFeed(xml, filter) : []))));
}

async function fetchYoutubeApi(spec: YoutubeSourceSpec, api: YoutubeApi): Promise<ScrapedItem[]> {
  const include = spec.include ? new RegExp(spec.include, 'i') : undefined;
  let lists: Array<YoutubePlaylistItem[] | undefined>;
  let shorts = new Set<string>();

  if (spec.playlist) {
    const items = await api.playlistItems(spec.playlist, PLAYLIST_ITEMS);
    if (!items) throw new Error(`YouTube playlist ${spec.playlist} not found`);
    lists = [items];
  } else {
    if (!spec.channel) throw new Error('No YouTube channel or playlist');
    const base = (await resolveChannelId(spec.channel, api)).slice(2);
    if (spec.shorts) {
      // Every upload, plus the Shorts playlist to give Shorts the /shorts/ URL the feeds use
      const [all, short] = await Promise.all([api.playlistItems(`UU${base}`, PLAYLIST_ITEMS), api.playlistItems(`UUSH${base}`, PLAYLIST_ITEMS)]);
      lists = [all];
      shorts = new Set((short ?? []).map((v) => v.videoId));
    } else {
      lists = await Promise.all([api.playlistItems(`UULF${base}`, PLAYLIST_ITEMS), api.playlistItems(`UULV${base}`, PLAYLIST_ITEMS)]);
    }
  }

  const entries = lists.flatMap((list) => list ?? [])
    .filter((v) => v.privacyStatus !== 'private' && (!include || include.test(`${v.title} ${v.description}`)));
  let meta = new Map<string, { durationSeconds?: number }>();
  try {
    meta = await api.videos(entries.map((v) => v.videoId));
  } catch (err) {
    // Lengths are a bonus; the list still updates without them (a used-up quota switches to the feeds)
    if (isYoutubeQuotaError(err)) throw err;
  }

  const items = entries.flatMap((v): ScrapedItem[] => {
    // Placeholders of private or deleted videos have no publish date, and the API doesn't list them
    const published = v.videoPublishedAt ?? (meta.has(v.videoId) ? v.publishedAt : undefined);
    if (!published) return [];
    const durationSeconds = meta.get(v.videoId)?.durationSeconds;
    const kind = shorts.has(v.videoId) ? `shorts/${v.videoId}` : `watch?v=${v.videoId}`;
    return [{
      title: v.title,
      url: `https://www.youtube.com/${kind}`,
      datePublished: new Date(published),
      content: v.description.trim().slice(0, MAX_CONTENT),
      ...(durationSeconds ? { durationSeconds } : {}),
    }];
  });
  return newestFirst(dedupByUrl(items));
}
