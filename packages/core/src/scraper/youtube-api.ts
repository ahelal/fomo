/**
 * A small client for the YouTube Data API v3 with an API key (public data only, no OAuth).
 * Plain `fetch`, so it runs anywhere; the key goes in a header and never into a URL or message.
 *
 * Quota (10,000 units a day by default, reset at midnight Pacific time): every list call here
 * costs 1 unit; `videos` takes up to 50 ids per call.
 */
import { createLimiter, errorMessage } from '../util.js';
import { TIMEOUT_MS } from './http.js';

const BASE = 'https://www.googleapis.com/youtube/v3/';
const CHANNEL_ID = /^UC[\w-]{22}$/;
/** A missing playlist (a channel that never streamed has no `UULV…`) is not asked for again for a day. */
const MISSING_TTL_MS = 24 * 3_600_000;
const MAX_IDS = 50;

export interface YoutubePlaylistItem {
  videoId: string;
  title: string;
  description: string;
  /** When the video went public; missing for the “Private video” / “Deleted video” placeholders. */
  videoPublishedAt?: string;
  /** When the video was added to the playlist. */
  publishedAt?: string;
  privacyStatus?: string;
}

export interface YoutubeVideo {
  id: string;
  /** Unknown while a stream is live or upcoming (`P0D`). */
  durationSeconds?: number;
  /** `live`, `upcoming` or `none`. */
  liveBroadcastContent: string;
}

export interface YoutubeApi {
  /** The `UC…` id of a channel given by id, `@handle` or `user/Name`. Cached per client. `c/Name` can't be looked up. */
  channelId(channel: string): Promise<string>;
  /** The first `max` items of a playlist, or undefined when there is no such playlist. */
  playlistItems(playlistId: string, max?: number): Promise<YoutubePlaylistItem[] | undefined>;
  /**
   * Metadata of public videos by id (others are missing from the map). Finished videos are cached and
   * not asked for again; live, upcoming or length-less ones are, so their length arrives once it is known.
   * `fresh` skips the cache.
   */
  videos(ids: string[], options?: { fresh?: boolean }): Promise<Map<string, YoutubeVideo>>;
  /** Units spent today (Pacific time) by this client, and until when calls are skipped after the quota ran out. */
  quota(): { unitsToday: number; blockedUntil?: Date };
}

export interface YoutubeApiOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  /** Requests in flight at once, across every source using this client. */
  maxConcurrent?: number;
  /** For tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/** An API failure with Google's reason (`quotaExceeded`, `keyInvalid`, `playlistNotFound`, …). */
export class YoutubeApiError extends Error {
  constructor(message: string, readonly reason: string, readonly status?: number) {
    super(message);
    this.name = 'YoutubeApiError';
  }
}

export const isYoutubeQuotaError = (err: unknown): boolean =>
  err instanceof YoutubeApiError && err.reason === 'quotaExceeded';

/** Seconds of an ISO 8601 duration (`PT1H2M3S`, `P1DT2H`); undefined for zero (`P0D`, a live or upcoming stream) or junk. */
export function parseIsoDuration(iso: string | undefined): number | undefined {
  const parts = iso?.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!parts) return undefined;
  const seconds = Number(parts[1] ?? 0) * 86_400 + Number(parts[2] ?? 0) * 3600 + Number(parts[3] ?? 0) * 60 + Number(parts[4] ?? 0);
  const rounded = Math.round(seconds);
  return Number.isSafeInteger(rounded) && rounded > 0 ? rounded : undefined;
}

/** `YYYY-MM-DD` and seconds into the day in Pacific time, where YouTube's quota day runs. */
function pacific(now: Date): { day: string; seconds: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    seconds: Number(get('hour')) * 3600 + Number(get('minute')) * 60 + Number(get('second')),
  };
}

/** When the quota resets: the next midnight Pacific time (within the hour on a daylight-saving switch). */
export function nextQuotaReset(now: Date): Date {
  const { seconds } = pacific(now);
  return new Date(Math.floor(now.getTime() / 1000) * 1000 + (86_400 - seconds) * 1000);
}

interface ApiErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string }>;
    details?: Array<{ reason?: string }>;
  };
}

const RETRY = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError', 'network', 'server']);

export function createYoutubeApi(options: YoutubeApiOptions): YoutubeApi {
  const { apiKey } = options;
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => new Date());
  const limit = createLimiter(options.maxConcurrent ?? 4);

  const channels = new Map<string, string>();
  const missing = new Map<string, number>();
  const finished = new Map<string, YoutubeVideo>();
  let usage = { day: '', units: 0 };
  let blockedUntil: Date | undefined;

  function quotaError(): YoutubeApiError {
    const at = blockedUntil?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return new YoutubeApiError(`YouTube API quota used up${at ? `; resets ${at}` : ''}`, 'quotaExceeded', 403);
  }

  function spend(units: number): void {
    const { day } = pacific(now());
    if (usage.day !== day) usage = { day, units: 0 };
    usage.units += units;
  }

  /** One GET, retried once on a network error, a 5xx or a rate limit. */
  async function get<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    if (blockedUntil && now() < blockedUntil) throw quotaError();
    blockedUntil = undefined;
    const url = `${BASE}${endpoint}?${new URLSearchParams(params)}`;
    return limit(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await once<T>(url);
        } catch (err) {
          if (!(err instanceof YoutubeApiError) || !RETRY.has(err.reason) || attempt > 0) throw err;
          await sleep(500 + Math.random() * 1000);
        }
      }
    });
  }

  async function once<T>(url: string): Promise<T> {
    let res: Response;
    try {
      spend(1);
      res = await doFetch(url, {
        headers: { 'X-Goog-Api-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new YoutubeApiError(`YouTube API request failed: ${errorMessage(err)}`, 'network');
    }
    if (res.ok) return (await res.json()) as T;

    let body: ApiErrorBody = {};
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // not JSON: the status says enough
    }
    const reasons = [...(body.error?.errors ?? []), ...(body.error?.details ?? [])].map((e) => e.reason ?? '');
    const has = (...names: string[]) => names.some((n) => reasons.includes(n));
    const fail = (message: string, reason: string) => new YoutubeApiError(message, reason, res.status);

    if (has('quotaExceeded', 'dailyLimitExceeded')) {
      blockedUntil = nextQuotaReset(now());
      throw quotaError();
    }
    if (has('keyInvalid', 'API_KEY_INVALID')) throw fail('YouTube API key is not valid', 'keyInvalid');
    if (has('accessNotConfigured', 'SERVICE_DISABLED')) throw fail('Enable YouTube Data API v3 for this API key’s Google Cloud project', 'accessNotConfigured');
    if (has('API_KEY_SERVICE_BLOCKED')) throw fail('The YouTube API key is restricted to other APIs', 'API_KEY_SERVICE_BLOCKED');
    if (has('rateLimitExceeded', 'userRateLimitExceeded', 'RATE_LIMIT_EXCEEDED') || res.status === 429) {
      throw fail('YouTube API rate limit', 'rateLimitExceeded');
    }
    if (res.status >= 500) throw fail(`YouTube API HTTP ${res.status}`, 'server');
    const reason = reasons.find(Boolean) ?? body.error?.status ?? `http${res.status}`;
    const detail = body.error?.message ? `: ${body.error.message}` : '';
    throw fail(`YouTube API HTTP ${res.status}${detail}`, reason);
  }

  return {
    async channelId(channel) {
      const cached = channels.get(channel);
      if (cached) return cached;
      let params: Record<string, string>;
      if (CHANNEL_ID.test(channel)) params = { id: channel };
      else if (channel.startsWith('@')) params = { forHandle: channel };
      else if (channel.startsWith('user/')) params = { forUsername: channel.slice(5) };
      else throw new YoutubeApiError(`The YouTube API can’t look up ${channel}`, 'unsupported');

      const data = await get<{ items?: Array<{ id?: string }> }>('channels', { part: 'id', ...params, fields: 'items(id)' });
      const id = data.items?.[0]?.id;
      if (!id) throw new YoutubeApiError(`YouTube channel ${channel} not found`, 'channelNotFound', 404);
      channels.set(channel, id);
      return id;
    },

    async playlistItems(playlistId, max = 15) {
      const gone = missing.get(playlistId);
      if (gone !== undefined && now().getTime() - gone < MISSING_TTL_MS) return undefined;
      type Item = {
        snippet?: { title?: string; description?: string; publishedAt?: string; resourceId?: { videoId?: string } };
        contentDetails?: { videoId?: string; videoPublishedAt?: string };
        status?: { privacyStatus?: string };
      };
      let data: { items?: Item[] };
      try {
        data = await get('playlistItems', {
          part: 'snippet,contentDetails,status',
          playlistId,
          maxResults: String(Math.min(Math.max(1, max), MAX_IDS)),
          fields: 'items(snippet(title,description,publishedAt,resourceId/videoId),contentDetails(videoId,videoPublishedAt),status/privacyStatus)',
        });
      } catch (err) {
        if (err instanceof YoutubeApiError && err.status === 404) {
          missing.set(playlistId, now().getTime());
          return undefined;
        }
        throw err;
      }
      missing.delete(playlistId);
      return (data.items ?? []).flatMap((item): YoutubePlaylistItem[] => {
        const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
        if (!videoId) return [];
        return [{
          videoId,
          title: item.snippet?.title ?? '',
          description: item.snippet?.description ?? '',
          ...(item.contentDetails?.videoPublishedAt ? { videoPublishedAt: item.contentDetails.videoPublishedAt } : {}),
          ...(item.snippet?.publishedAt ? { publishedAt: item.snippet.publishedAt } : {}),
          ...(item.status?.privacyStatus ? { privacyStatus: item.status.privacyStatus } : {}),
        }];
      });
    },

    async videos(ids, { fresh = false } = {}) {
      const out = new Map<string, YoutubeVideo>();
      const ask: string[] = [];
      for (const id of new Set(ids)) {
        const cached = fresh ? undefined : finished.get(id);
        if (cached) out.set(id, cached);
        else ask.push(id);
      }
      const chunks: string[][] = [];
      for (let i = 0; i < ask.length; i += MAX_IDS) chunks.push(ask.slice(i, i + MAX_IDS));
      type Item = { id?: string; contentDetails?: { duration?: string }; snippet?: { liveBroadcastContent?: string } };
      const pages = await Promise.all(chunks.map((chunk) => get<{ items?: Item[] }>('videos', {
        part: 'contentDetails,snippet',
        id: chunk.join(','),
        maxResults: String(MAX_IDS),
        fields: 'items(id,contentDetails/duration,snippet/liveBroadcastContent)',
      })));
      for (const item of pages.flatMap((p) => p.items ?? [])) {
        if (!item.id) continue;
        const durationSeconds = parseIsoDuration(item.contentDetails?.duration);
        const video: YoutubeVideo = {
          id: item.id,
          liveBroadcastContent: item.snippet?.liveBroadcastContent ?? 'none',
          ...(durationSeconds ? { durationSeconds } : {}),
        };
        out.set(item.id, video);
        if (video.liveBroadcastContent === 'none' && durationSeconds) finished.set(item.id, video);
      }
      return out;
    },

    quota() {
      const { day } = pacific(now());
      const active = blockedUntil && now() < blockedUntil ? blockedUntil : undefined;
      return { unitsToday: usage.day === day ? usage.units : 0, ...(active ? { blockedUntil: active } : {}) };
    },
  };
}
