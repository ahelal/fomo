import type { ScrapedItem, YoutubeSourceSpec } from '../types.js';
import { parseFeed } from './feed.js';
import { TIMEOUT_MS, USER_AGENT } from './http.js';
import { dedupByUrl } from './text.js';
import { mapLimit } from '../util.js';

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

const resolved = new Map<string, string>();

/** The `UC…` id of a channel given by id, `@handle`, `c/Name` or `user/Name`. Cached per process. */
export async function resolveChannelId(channel: string): Promise<string> {
  if (CHANNEL_ID.test(channel)) return channel;
  const cached = resolved.get(channel);
  if (cached) return cached;

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
  let id: string | undefined;
  while (reader && !id && page.length < MAX_PAGE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    page += decoder.decode(value, { stream: true });
    id = page.match(canonical)?.[1];
  }
  if (reader) await reader.cancel().catch(() => undefined);
  else page = await res.text();
  id ??= page.match(canonical)?.[1] ?? page.match(/"externalId":"(UC[\w-]{22})"/)?.[1];
  if (!id) throw new Error(`Could not find the channel id of ${channel}`);
  resolved.set(channel, id);
  return id;
}

/** The feed, or undefined when YouTube has no such playlist (404). */
async function feed(query: string): Promise<string | undefined> {
  const res = await globalThis.fetch(`${FEED}?${query}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Read duration metadata from a watch page, stopping once the player metadata is found. */
async function videoDuration(url: string): Promise<number | undefined> {
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
}

function parseVideoDuration(page: string): number | undefined {
  const seconds = page.match(/"lengthSeconds"\s*:\s*"(\d+)"/)?.[1];
  if (seconds) {
    const duration = Number(seconds);
    if (Number.isSafeInteger(duration) && duration > 0) return duration;
  }

  const meta = page.match(/<meta\b(?=[^>]*\bitemprop=["']duration["'])[^>]*>/i)?.[0];
  const iso = meta?.match(/\bcontent=["'](PT(?=[\dHMS])[\dHMS.]+)["']/i)?.[1];
  if (!iso) return undefined;
  const parts = iso.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (!parts) return undefined;
  const duration = Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
  return Number.isSafeInteger(duration) && duration > 0 ? duration : undefined;
}

/** Duration metadata is best-effort; an unavailable watch page must not drop a feed item. */
async function withVideoDurations(items: ScrapedItem[]): Promise<ScrapedItem[]> {
  return mapLimit(items, 4, async (item) => {
    try {
      const durationSeconds = await videoDuration(item.url);
      return durationSeconds ? { ...item, durationSeconds } : item;
    } catch {
      return item;
    }
  });
}

/**
 * The newest videos (YouTube's feeds hold 15). Without Shorts it merges the channel's “Videos”
 * (`UULF…`) and “Live” (`UULV…`) playlists; either is missing (404) when the channel has none.
 */
export async function fetchYoutube(spec: YoutubeSourceSpec): Promise<ScrapedItem[]> {
  const filter = { include: spec.include };
  if (spec.playlist) {
    const xml = await feed(`playlist_id=${spec.playlist}`);
    if (!xml) throw new Error(`YouTube playlist ${spec.playlist} not found`);
    return withVideoDurations(parseFeed(xml, filter));
  }
  if (!spec.channel) throw new Error('No YouTube channel or playlist');
  const id = await resolveChannelId(spec.channel);
  const uploads = id.slice(2);

  if (spec.shorts) {
    const xml = await feed(`channel_id=${id}`);
    if (!xml) throw new Error(`YouTube channel ${spec.channel} not found`);
    return withVideoDurations(parseFeed(xml, filter));
  }

  const [videos, live] = await Promise.all([feed(`playlist_id=UULF${uploads}`), feed(`playlist_id=UULV${uploads}`)]);
  if (!videos && !live && !(await feed(`channel_id=${id}`))) throw new Error(`YouTube channel ${spec.channel} not found`);
  const items = dedupByUrl([videos, live].flatMap((xml) => (xml ? parseFeed(xml, filter) : [])));
  const enriched = await withVideoDurations(items);
  return enriched.sort((a, b) => b.datePublished.getTime() - a.datePublished.getTime());
}
