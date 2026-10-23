import { TEAMS_MEETINGS_SOURCE, type ExperimentalProvider, type KeyedChange, type ScrapedItem, type Update } from '@fomo/core';
import { connectWorkIQ, graphPath, type FileHit, type GraphResult, type WorkIQ } from './workiq.js';

/**
 * Experimental source: Teams meetings of the last days that I missed, or that have a recording or a
 * transcript, one item per meeting occurrence, linking to the meeting recap in Teams.
 *
 * Read through WorkIQ (Microsoft Graph with the user's own sign-in):
 * - the calendar gives the occurrences and, from the join link, the meeting chat (thread) id;
 * - `getAllRecordings` / `getAllTranscripts` give the artifacts, by thread;
 * - the meeting chat's "call ended" events list who joined: not me = missed;
 * - the thread id with the occurrence's calendar iCalUId form a direct recap link when there is a
 *   recording or transcript, plus the recording file: from the sharing link in the meeting chat, or
 *   else found with a file search (by its name, which holds the meeting's subject and start time).
 *
 * Every fetch looks at the whole window again; a stored meeting is merged (see `mergeMeeting`), so a
 * recording or transcript that appears later is added to it.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const QUARTER_MS = 15 * 60_000;
/** How far back a fetch looks. */
export const TEAMS_WINDOW_DAYS = 7;
/** A call may start a bit before the meeting does. */
const EARLY_START_MS = 15 * 60_000;
/** Artifacts and call events this long after an occurrence's end belong to no occurrence. */
const LATE_END_MS = 6 * HOUR_MS;
/** Most pages read for one list (calendar, artifacts, one meeting chat). */
const MAX_PAGES = 20;
/** Meeting chats read per WorkIQ call, and calls at once. */
const CHAT_BATCH = 5;
const CHAT_CONCURRENCY = 4;
/** A file search takes seconds: this many at once. */
const SEARCH_CONCURRENCY = 3;
/** After this many failed searches in a fetch, searching stops for a while. */
const SEARCH_FAILURES = 2;
const SEARCH_PAUSE_MS = 15 * 60_000;
/** A recording not found is searched for again after this long (the search index lags). */
const NOT_FOUND_TTL_MS = HOUR_MS;
/** How far a recording's name stamp may be from its artifact's creation time. */
const STAMP_SLACK_MS = 45_000;
const NO_SUBJECT = '(no subject)';

// ─── Graph shapes (only what is read) ──────────────────────────────────────

export interface GraphTime {
  dateTime?: string;
  timeZone?: string;
}

export interface CalendarEvent {
  id?: string;
  iCalUId?: string;
  subject?: string;
  bodyPreview?: string;
  isCancelled?: boolean;
  start?: GraphTime;
  end?: GraphTime;
  organizer?: { emailAddress?: { name?: string; address?: string } };
  onlineMeeting?: { joinUrl?: string } | null;
  responseStatus?: { response?: string };
}

/** A recording or transcript from `getAllRecordings` / `getAllTranscripts`. */
export interface MeetingArtifact {
  id?: string;
  meetingId?: string;
  createdDateTime?: string;
}

export interface ChatMessage {
  createdDateTime?: string;
  eventDetail?: {
    '@odata.type'?: string;
    callParticipants?: { participant?: { user?: { id?: string } | null } | null }[];
    callRecordingDuration?: string;
    callRecordingStatus?: string;
    callRecordingUrl?: string;
  } | null;
}

/** A recording file in OneDrive / SharePoint. */
export interface RecordingFile {
  driveId: string;
  driveItemId: string;
}

/** A meeting chat's call events, or why they could not be read. */
export type ChatEvents = ChatMessage[] | 'forbidden' | 'failed';

// ─── Classifier ────────────────────────────────────────────────────────────

/** A meeting occurrence, with what happened in it. */
export interface Meeting {
  key: string;
  threadId: string;
  iCalUId?: string;
  subject: string;
  start: Date;
  end: Date;
  organizer?: string;
  preview?: string;
  missed: boolean;
  recordings: number;
  transcripts: number;
  recordingSeconds?: number;
  /** Sharing link of the (longest) recording, from the meeting chat. */
  recordingUrl?: string;
  recordingFile?: RecordingFile;
  /** When each recording / transcript of this occurrence was created (about when it started). */
  recordingStarts?: Date[];
  transcriptStarts?: Date[];
}

/** A Graph `dateTimeTimeZone` as an instant. Graph answers in UTC unless asked otherwise. */
export function graphTime(t: GraphTime | undefined): Date | undefined {
  if (!t?.dateTime || (t.timeZone && t.timeZone.toUpperCase() !== 'UTC')) return undefined;
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d{1,3})?/.exec(t.dateTime);
  if (!m) return undefined;
  const d = new Date(`${m[1]}${m[2] ?? ''}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const THREAD = /19:[^/?#\s]+@thread\.(?:v2|skype|tacv2)/;

/** The meeting chat id in a Teams join link. */
export function threadOfJoinUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return THREAD.exec(decodeURIComponent(url))?.[0];
  } catch {
    return THREAD.exec(url)?.[0];
  }
}

/** The meeting chat id in an online meeting id (base64 of `1*<organizer>*0**<thread>`). */
export function threadOfMeetingId(meetingId: string | undefined): string | undefined {
  if (!meetingId) return undefined;
  try {
    return THREAD.exec(Buffer.from(meetingId, 'base64').toString('utf8'))?.[0];
  } catch {
    return undefined;
  }
}

/** Seconds in an ISO 8601 duration (`PT1H2M3.5S`). */
export function isoSeconds(duration: string | undefined): number | undefined {
  const m = duration ? /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(duration) : null;
  if (!m) return undefined;
  const s = (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  return s > 0 ? Math.round(s) : undefined;
}

export function chatUrl(threadId: string): string {
  return `https://teams.microsoft.com/l/chat/${encodeURIComponent(threadId)}/conversations`;
}

export function isRecapUrl(url: string | undefined): boolean {
  return !!url && /^https:\/\/teams\.microsoft\.com\/l\/meetingrecap\?/.test(url);
}

const EXCHANGE_GOID = /^040000008200E00074C5B7101A82E008[0-9A-F]{8}/i;

/**
 * The iCalUId of a meeting's series: Exchange gives each occurrence its series id with the date in
 * bytes 16–19; the recap wants them zeroed. Other ids are returned as they are.
 */
export function seriesICalUId(iCalUId: string): string {
  return EXCHANGE_GOID.test(iCalUId) ? `${iCalUId.slice(0, 32)}00000000${iCalUId.slice(40)}` : iCalUId;
}

/** Graph's id for a sharing link (`/shares/{id}`). */
export function shareId(url: string): string {
  return `u!${Buffer.from(url, 'utf8').toString('base64url')}`;
}

/**
 * The meeting recap in Teams (undocumented, verified by hand, the parameters of the links Teams
 * shares): the occurrence id and the thread, with the recording file when known. Without the file
 * a recurring meeting needs its series id too, which makes Teams show a list of its occurrences.
 */
export function recapUrl(m: Meeting): string | undefined {
  if (!m.iCalUId || (m.recordings === 0 && m.transcripts === 0)) return undefined;
  return recapLink(m.iCalUId, m.threadId, m.recordingFile);
}

function recapLink(iCalUId: string, threadId: string, file: RecordingFile | undefined): string {
  const series = seriesICalUId(iCalUId);
  const params: [string, string][] = file
    ? [['driveId', file.driveId], ['driveItemId', file.driveItemId], ['iCalUid', iCalUId], ['threadId', threadId]]
    : [['iCalUid', iCalUId], ...(series !== iCalUId ? [['masterICalUid', series.toLowerCase()]] as [string, string][] : []), ['threadId', threadId]];
  return `https://teams.microsoft.com/l/meetingrecap?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

function urlParam(url: string, name: string): string | undefined {
  try {
    return new URL(url).searchParams.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

const time = (s: string | undefined) => {
  const d = s ? new Date(s) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
};

interface Slot extends Meeting {
  /** Artifact id → when it was created. */
  recordingIds: Map<string, Date>;
  transcriptIds: Map<string, Date>;
  callEnded: boolean;
  attended: boolean;
  /** Length of the recording `recordingUrl` points at. */
  fileSeconds?: number;
}

/** The meeting chat and times of an online occurrence that ended by `now`, unless cancelled or declined. */
function eligible(e: CalendarEvent, now: Date): { threadId: string; start: Date; end: Date } | undefined {
  const threadId = threadOfJoinUrl(e.onlineMeeting?.joinUrl);
  const start = graphTime(e.start);
  const end = graphTime(e.end);
  if (!threadId || !start || !end || e.isCancelled || e.responseStatus?.response === 'declined') return undefined;
  return end.getTime() <= now.getTime() ? { threadId, start, end } : undefined;
}

/**
 * The meetings worth an item: every online occurrence that ended by `now` (not cancelled or
 * declined) where a call ended without me, or that has a recording or a transcript.
 * A meeting chat that could not be read only loses the "missed" check.
 */
export function classifyMeetings(input: {
  me: string;
  now: Date;
  events: CalendarEvent[];
  recordings: MeetingArtifact[];
  transcripts: MeetingArtifact[];
  chats: Map<string, ChatEvents>;
}): Meeting[] {
  const byThread = new Map<string, Slot[]>();
  for (const e of input.events) {
    const occurrence = eligible(e, input.now);
    if (!occurrence) continue;
    const { threadId, start, end } = occurrence;
    const organizer = e.organizer?.emailAddress?.name || e.organizer?.emailAddress?.address;
    const preview = e.bodyPreview?.trim();
    const slot: Slot = {
      key: `teams:${threadId}:${start.toISOString()}`,
      threadId,
      ...(e.iCalUId ? { iCalUId: e.iCalUId } : {}),
      subject: e.subject?.trim() || NO_SUBJECT,
      start,
      end,
      ...(organizer ? { organizer } : {}),
      ...(preview ? { preview } : {}),
      missed: false,
      recordings: 0,
      transcripts: 0,
      recordingIds: new Map(),
      transcriptIds: new Map(),
      callEnded: false,
      attended: false,
    };
    const list = byThread.get(threadId) ?? [];
    if (!list.some((s) => s.key === slot.key)) list.push(slot);
    byThread.set(threadId, list);
  }
  for (const list of byThread.values()) list.sort((a, b) => a.start.getTime() - b.start.getTime());

  // The occurrence of the thread a moment belongs to: the last one started (give or take) by then.
  const slotAt = (threadId: string | undefined, at: Date | undefined): Slot | undefined => {
    if (!threadId || !at) return undefined;
    const t = at.getTime();
    const slot = byThread.get(threadId)?.filter((s) => s.start.getTime() - EARLY_START_MS <= t).pop();
    return slot && t <= slot.end.getTime() + LATE_END_MS ? slot : undefined;
  };

  for (const r of input.recordings) {
    const at = time(r.createdDateTime);
    const slot = slotAt(threadOfMeetingId(r.meetingId), at);
    if (slot && at && r.id) slot.recordingIds.set(r.id, at);
  }
  for (const r of input.transcripts) {
    const at = time(r.createdDateTime);
    const slot = slotAt(threadOfMeetingId(r.meetingId), at);
    if (slot && at && r.id) slot.transcriptIds.set(r.id, at);
  }
  for (const [threadId, events] of input.chats) {
    if (!Array.isArray(events)) continue;
    for (const m of events) {
      const kind = m.eventDetail?.['@odata.type'] ?? '';
      const slot = slotAt(threadId, time(m.createdDateTime));
      if (!slot) continue;
      if (kind.endsWith('callEndedEventMessageDetail')) {
        slot.callEnded = true;
        if (m.eventDetail?.callParticipants?.some((p) => p.participant?.user?.id === input.me)) slot.attended = true;
      } else if (kind.endsWith('callRecordingEventMessageDetail') && m.eventDetail?.callRecordingStatus !== 'failure') {
        const seconds = isoSeconds(m.eventDetail?.callRecordingDuration);
        if (seconds && seconds > (slot.recordingSeconds ?? 0)) slot.recordingSeconds = seconds;
        const url = m.eventDetail?.callRecordingUrl;
        if (url && (slot.fileSeconds === undefined || (seconds ?? 0) > slot.fileSeconds)) {
          slot.recordingUrl = url;
          slot.fileSeconds = seconds ?? 0;
        }
      }
    }
  }

  const meetings: Meeting[] = [];
  for (const list of byThread.values()) {
    for (const { recordingIds, transcriptIds, callEnded, attended, fileSeconds: _, ...m } of list) {
      const meeting: Meeting = {
        ...m,
        missed: callEnded && !attended,
        recordings: recordingIds.size,
        transcripts: transcriptIds.size,
        ...(recordingIds.size ? { recordingStarts: [...recordingIds.values()] } : {}),
        ...(transcriptIds.size ? { transcriptStarts: [...transcriptIds.values()] } : {}),
      };
      if (meeting.missed || meeting.recordings > 0 || meeting.transcripts > 0) meetings.push(meeting);
    }
  }
  return meetings.sort((a, b) => b.start.getTime() - a.start.getTime());
}

// ─── Recording files found by name ─────────────────────────────────────────

/** A recording file's name: `<subject>-<yyyyMMdd>_<HHmmss>[UTC]-<kind>`, started at the organizer's local time (or UTC). */
export interface RecordingStamp {
  title: string;
  /** The stamp read as if it were UTC. */
  at: Date;
  utc: boolean;
}

/** The stamp in a recording's name; the kind ("Meeting Recording") is in the organizer's language. */
export function recordingStamp(name: string): RecordingStamp | undefined {
  const m = /^(.*)-(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)(\d\d)(UTC)?-.+$/su.exec(name);
  if (!m) return undefined;
  const [, title, y, mo, d, h, mi, s, utc] = m;
  const at = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  return Number.isNaN(at.getTime()) ? undefined : { title: title!, at, utc: !!utc };
}

/** A subject as Teams names files after it: only its letters and digits count (`|` and `:` go, `&` becomes `_`). */
const nameKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** How far a stamp is from `at` once the organizer's time zone (a quarter-hour offset, −12 h…+14 h) is taken out. */
function stampError(stamp: RecordingStamp, at: Date): number | undefined {
  const diff = stamp.at.getTime() - at.getTime();
  const offset = stamp.utc ? 0 : Math.round(diff / QUARTER_MS) * QUARTER_MS;
  if (offset < -12 * HOUR_MS || offset > 14 * HOUR_MS) return undefined;
  const error = Math.abs(diff - offset);
  return error <= STAMP_SLACK_MS ? error : undefined;
}

/**
 * The recording file of a meeting among search hits: named after its subject (or a cut of it), with
 * a stamp that fits when one of its recordings was created, else one of its transcripts; the closest.
 */
export function matchRecording(m: Meeting, hits: FileHit[]): RecordingFile | undefined {
  const subject = nameKey(m.subject);
  if (!subject) return undefined;
  const named = hits.flatMap((hit) => {
    const stamp = hit.title ? recordingStamp(hit.title) : undefined;
    const title = stamp ? nameKey(stamp.title) : '';
    return stamp && title && (title.startsWith(subject) || subject.startsWith(title)) ? [{ hit, stamp }] : [];
  });
  for (const starts of [m.recordingStarts ?? [], m.transcriptStarts ?? []]) {
    let best: { hit: FileHit; error: number } | undefined;
    for (const { hit, stamp } of named) {
      for (const at of starts) {
        const error = stampError(stamp, at);
        if (error !== undefined && (!best || error < best.error)) best = { hit, error };
      }
    }
    if (best) return { driveId: best.hit.driveId, driveItemId: best.hit.driveItemId };
  }
  return undefined;
}

/** What to search for a meeting's recording: its subject, quoted, and the day (as in the file's stamp). */
export function recordingQuery(m: Meeting): string {
  const day = m.start.toISOString().slice(0, 10).replaceAll('-', '');
  return `"${m.subject.replaceAll('"', ' ').replace(/\s+/g, ' ').trim()}" ${day}`;
}

// ─── Items ─────────────────────────────────────────────────────────────────

export interface MeetingFacts {
  missed: boolean;
  recordings: number;
  transcripts: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** First line of a meeting's preview: what it has, e.g. "Missed · 2 recordings · 1 transcript". */
export function factsLine(f: MeetingFacts): string {
  return [
    ...(f.missed ? ['Missed'] : []),
    ...(f.recordings ? [plural(f.recordings, 'recording')] : []),
    ...(f.transcripts ? [plural(f.transcripts, 'transcript')] : []),
  ].join(' · ');
}

/** What the first line of a stored meeting says it has. */
export function meetingFacts(content: string | undefined): MeetingFacts {
  const line = (content ?? '').split('\n', 1)[0] ?? '';
  return {
    missed: /(^|· )Missed( ·|$)/.test(line),
    recordings: Number(/(\d+) recordings?\b/.exec(line)?.[1] ?? 0),
    transcripts: Number(/(\d+) transcripts?\b/.exec(line)?.[1] ?? 0),
  };
}

function withFacts(content: string, facts: MeetingFacts): string {
  const rest = content.split('\n').slice(1).join('\n');
  return rest ? `${factsLine(facts)}\n${rest}` : factsLine(facts);
}

export function meetingItem(m: Meeting): ScrapedItem {
  const lines = [
    factsLine(m),
    ...(m.organizer ? [`Organizer: ${m.organizer}`] : []),
    `Meeting chat: ${chatUrl(m.threadId)}`,
    ...(m.preview ? ['', m.preview] : []),
  ];
  return {
    key: m.key,
    title: m.subject,
    url: recapUrl(m) ?? chatUrl(m.threadId),
    datePublished: m.end,
    content: lines.join('\n'),
    ...(m.recordingSeconds ? { durationSeconds: m.recordingSeconds } : {}),
  };
}

/**
 * The link a stored meeting keeps: a recap link beats the chat link, and one with the recording file
 * beats the same link without it (the file may just not have been found this time); it is kept in
 * today's format. A link of an older format is replaced.
 */
function keptUrl(existing: string, fetched: string): string {
  if (!isRecapUrl(fetched)) return isRecapUrl(existing) ? existing : fetched;
  const same = (name: string) => urlParam(existing, name) === urlParam(fetched, name);
  const driveId = isRecapUrl(existing) ? urlParam(existing, 'driveId') : undefined;
  const driveItemId = isRecapUrl(existing) ? urlParam(existing, 'driveItemId') : undefined;
  const iCalUId = urlParam(fetched, 'iCalUid');
  const threadId = urlParam(fetched, 'threadId');
  if (!driveId || !driveItemId || urlParam(fetched, 'driveItemId') || !iCalUId || !threadId || !same('iCalUid') || !same('threadId')) return fetched;
  return recapLink(iCalUId, threadId, { driveId, driveItemId });
}

/**
 * How a fetched meeting changes its stored row: nothing it had is lost (missed stays missed, counts
 * only grow, a better link is kept, see `keptUrl`), the rest is the fetched version.
 */
export function mergeMeeting(existing: Update, fetched: ScrapedItem): KeyedChange {
  const a = meetingFacts(existing.content);
  const b = meetingFacts(fetched.content);
  const facts = { missed: a.missed || b.missed, recordings: Math.max(a.recordings, b.recordings), transcripts: Math.max(a.transcripts, b.transcripts) };
  const durationSeconds = Math.max(existing.durationSeconds ?? 0, fetched.durationSeconds ?? 0);
  return {
    title: fetched.title,
    url: keptUrl(existing.url, fetched.url),
    content: withFacts(fetched.content ?? '', facts),
    ...(durationSeconds ? { durationSeconds } : {}),
  };
}

// ─── Fetch ─────────────────────────────────────────────────────────────────

const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z');

function failure(what: string, r: GraphResult): Error {
  const auth = r.statusCode === 401 || /unauthori|sign.?in|token|consent/i.test(r.error ?? '');
  return new Error(auth
    ? `WorkIQ could not read your ${what}: sign in again (config → Teams meetings → l)`
    : `Could not read your ${what} (${r.statusCode || 'no answer'}${r.error ? `: ${r.error}` : ''})`);
}

interface Page {
  value?: unknown[];
  '@odata.nextLink'?: string;
}

/** Every item of a Graph list, following its next links. */
async function readAll<T>(what: string, first: string, get: (path: string) => Promise<GraphResult>): Promise<T[]> {
  const out: T[] = [];
  let path: string | undefined = first;
  for (let n = 0; path && n < MAX_PAGES; n++) {
    const r = await get(path);
    if (r.statusCode !== 200 || !r.data) throw failure(what, r);
    const page = r.data as Page;
    out.push(...((page.value ?? []) as T[]));
    path = page['@odata.nextLink'] ? graphPath(page['@odata.nextLink']) : undefined;
  }
  return out;
}

/** Run `work` on every item, at most `limit` at once. */
async function eachLimit<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The call events of each meeting chat since `since`, several chats per WorkIQ call. */
async function readChats(wq: WorkIQ, threads: string[], since: Date, signal?: AbortSignal): Promise<Map<string, ChatEvents>> {
  const out = new Map<string, ChatEvents>();
  let queue = threads.map((threadId) => ({
    threadId,
    path: `/me/chats/${threadId}/messages?$top=50&$filter=lastModifiedDateTime gt ${iso(since)}&$orderby=lastModifiedDateTime desc`,
    page: 0,
  }));
  // A chat is in one batch per round, so the batches of a round never touch the same entry.
  while (queue.length > 0) {
    const next: typeof queue = [];
    await eachLimit(chunks(queue, CHAT_BATCH), CHAT_CONCURRENCY, async (batch) => {
      signal?.throwIfAborted();
      let results: GraphResult[];
      try {
        results = await wq.fetch(batch.map((b) => b.path), signal);
      } catch {
        if (signal?.aborted) throw signal.reason;
        for (const b of batch) out.set(b.threadId, 'failed');
        return;
      }
      batch.forEach((b, j) => {
        const r = results[j];
        if (out.get(b.threadId) === 'failed') return;
        if (r?.statusCode !== 200 || !r.data) {
          out.set(b.threadId, r?.statusCode === 403 ? 'forbidden' : 'failed');
          return;
        }
        const page = r.data as Page;
        const events = (page.value ?? []) as ChatMessage[];
        const known = out.get(b.threadId);
        out.set(b.threadId, [...(Array.isArray(known) ? known : []), ...events.filter((m) => m.eventDetail)]);
        const link = page['@odata.nextLink'];
        if (link && b.page + 1 < MAX_PAGES) next.push({ threadId: b.threadId, path: graphPath(link), page: b.page + 1 });
      });
    });
    queue = next;
  }
  return out;
}

export interface TeamsMeetingsOptions {
  connect?: (signal?: AbortSignal) => Promise<WorkIQ>;
  now?: () => Date;
  days?: number;
}

/**
 * Look `keys` up with Graph, several per WorkIQ call, remembering the answers in `cache`: what Graph
 * refuses or cannot find is remembered as `null`, other failures are tried again next time.
 */
async function lookUp<T>(
  wq: WorkIQ,
  keys: string[],
  path: (key: string) => string,
  read: (data: unknown) => T | undefined,
  cache: Map<string, T | null>,
  signal?: AbortSignal,
): Promise<void> {
  const todo = [...new Set(keys)].filter((k) => !cache.has(k));
  await eachLimit(chunks(todo, CHAT_BATCH), CHAT_CONCURRENCY, async (batch) => {
    signal?.throwIfAborted();
    let results: GraphResult[];
    try {
      results = await wq.fetch(batch.map(path), signal);
    } catch {
      if (signal?.aborted) throw signal.reason;
      return;
    }
    batch.forEach((k, j) => {
      const r = results[j];
      const value = r?.statusCode === 200 ? read(r.data) : undefined;
      if (value !== undefined) cache.set(k, value);
      else if (r?.statusCode === 200 || r?.statusCode === 403 || r?.statusCode === 404) cache.set(k, null);
    });
  });
}

function driveItem(data: unknown): RecordingFile | undefined {
  const item = data as { id?: string; parentReference?: { driveId?: string } } | undefined;
  return item?.id && item.parentReference?.driveId ? { driveId: item.parentReference.driveId, driveItemId: item.id } : undefined;
}

/** Find the drive item of each meeting's recording from the sharing link in its chat; `cache` remembers them across fetches. */
async function findRecordingFiles(wq: WorkIQ, meetings: Meeting[], cache: Map<string, RecordingFile | null>, signal?: AbortSignal): Promise<void> {
  const shared = meetings.map((m) => m.recordingUrl).filter((u): u is string => !!u);
  await lookUp(wq, shared, (u) => `/shares/${shareId(u)}/driveItem?$select=id,parentReference`, driveItem, cache, signal);
  for (const m of meetings) {
    const file = m.recordingUrl ? cache.get(m.recordingUrl) : undefined;
    if (file) m.recordingFile = file;
  }
}

/** What file searches found (by meeting key), when they found nothing, and until when searching rests. */
interface SearchMemory {
  found: Map<string, RecordingFile>;
  missing: Map<string, number>;
  pausedUntil: number;
}

/**
 * Search the recording file of each meeting that still has none (its meeting chat may be closed to
 * me). Failed searches are not remembered; after a few, searching rests for a while.
 */
async function searchRecordingFiles(wq: WorkIQ, meetings: Meeting[], memory: SearchMemory, now: number, signal?: AbortSignal): Promise<void> {
  const todo = meetings.filter((m) => !m.recordingFile && m.subject !== NO_SUBJECT);
  let failures = 0;
  await eachLimit(todo, SEARCH_CONCURRENCY, async (m) => {
    const known = memory.found.get(m.key);
    if (known) {
      m.recordingFile = known;
      return;
    }
    if (now < memory.pausedUntil || now - (memory.missing.get(m.key) ?? -Infinity) < NOT_FOUND_TTL_MS) return;
    signal?.throwIfAborted();
    try {
      const file = matchRecording(m, await wq.searchFiles(recordingQuery(m), signal));
      if (file) {
        memory.found.set(m.key, file);
        m.recordingFile = file;
      } else {
        memory.missing.set(m.key, now);
      }
    } catch {
      if (signal?.aborted) throw signal.reason;
      if (++failures >= SEARCH_FAILURES) memory.pausedUntil = now + SEARCH_PAUSE_MS;
    }
  });
}

export function teamsMeetingsProvider(options: TeamsMeetingsOptions = {}): ExperimentalProvider {
  const connect = options.connect ?? connectWorkIQ;
  const cache = new Map<string, RecordingFile | null>();
  const searched: SearchMemory = { found: new Map(), missing: new Map(), pausedUntil: 0 };
  return {
    id: TEAMS_MEETINGS_SOURCE,
    merge: mergeMeeting,
    async fetch(signal) {
      const now = options.now?.() ?? new Date();
      const since = new Date(now.getTime() - (options.days ?? TEAMS_WINDOW_DAYS) * DAY_MS);
      const wq = await connect(signal);
      try {
        const [meResult] = await wq.fetch(['/me?$select=id'], signal);
        const me = (meResult?.data as { id?: string } | undefined)?.id;
        if (meResult?.statusCode !== 200 || !me) throw failure('profile', meResult ?? { statusCode: 0 });

        const window = `startDateTime=${iso(since)},endDateTime=${iso(now)}`;
        const [events, recordings, transcripts] = await Promise.all([
          readAll<CalendarEvent>(
            'calendar',
            `/me/calendarView?startDateTime=${iso(since)}&endDateTime=${iso(now)}&$select=id,iCalUId,subject,bodyPreview,isCancelled,start,end,organizer,onlineMeeting,responseStatus&$top=50`,
            async (p) => (await wq.fetch([p], signal))[0] ?? { statusCode: 0 },
          ),
          readAll<MeetingArtifact>('recordings', `/me/onlineMeetings/getAllRecordings(meetingOrganizerUserId='${me}',${window})`, (p) => wq.callFunction(p, signal)),
          readAll<MeetingArtifact>('transcripts', `/me/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='${me}',${window})`, (p) => wq.callFunction(p, signal)),
        ]);

        const threads = [...new Set(events.map((e) => eligible(e, now)?.threadId).filter((t): t is string => !!t))];
        const chats = await readChats(wq, threads, since, signal);
        const meetings = classifyMeetings({ me, now, events, recordings, transcripts, chats });
        const withRecap = meetings.filter((m) => recapUrl(m));
        await findRecordingFiles(wq, withRecap, cache, signal);
        await searchRecordingFiles(wq, withRecap, searched, now.getTime(), signal);

        signal?.throwIfAborted();
        return meetings.map(meetingItem);
      } finally {
        await wq.close();
      }
    },
  };
}
