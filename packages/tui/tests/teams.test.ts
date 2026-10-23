import { describe, expect, it } from 'vitest';
import type { Update } from '@fomo/core';
import {
  chatUrl,
  classifyMeetings,
  factsLine,
  graphTime,
  isoSeconds,
  matchRecording,
  meetingFacts,
  meetingItem,
  mergeMeeting,
  recapUrl,
  recordingQuery,
  recordingStamp,
  seriesICalUId,
  shareId,
  teamsMeetingsProvider,
  threadOfJoinUrl,
  threadOfMeetingId,
  type CalendarEvent,
  type ChatEvents,
  type ChatMessage,
  type Meeting,
  type MeetingArtifact,
} from '../src/experimental/teams.js';
import { fileHits, graphPath, graphResult, type FileHit, type GraphResult, type WorkIQ } from '../src/experimental/workiq.js';
import { experimentalProviders, type ExperimentalSetups } from '../src/experimental/index.js';

const ME = 'me-id';
const OTHER = 'someone-else';
const NOW = new Date('2026-10-20T12:00:00Z');
const thread = (name: string) => `19:meeting_${name}@thread.v2`;
const joinUrl = (name: string) => `https://teams.microsoft.com/l/meetup-join/${encodeURIComponent(thread(name))}/0?context=%7b%7d`;
const meetingId = (name: string) => Buffer.from(`1*organizer-id*0**${thread(name)}`).toString('base64');
const utc = (iso: string) => ({ dateTime: iso.replace('Z', '.0000000'), timeZone: 'UTC' });

function event(name: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: `event-${name}-${start}`,
    iCalUId: `ical-${name}`,
    subject: `Meeting ${name}`,
    start: utc(start),
    end: utc(end),
    organizer: { emailAddress: { name: 'Ada Lovelace', address: 'ada@example.com' } },
    onlineMeeting: { joinUrl: joinUrl(name) },
    responseStatus: { response: 'accepted' },
    ...extra,
  };
}
const artifact = (name: string, created: string, id = `${name}-${created}`): MeetingArtifact => ({ id, meetingId: meetingId(name), createdDateTime: created });
const callEnded = (at: string, ...users: string[]): ChatMessage => ({
  createdDateTime: at,
  eventDetail: {
    '@odata.type': '#microsoft.graph.callEndedEventMessageDetail',
    callParticipants: users.map((id) => ({ participant: { user: { id } } })),
  },
});
const recorded = (at: string, duration: string, status = 'success', url?: string): ChatMessage => ({
  createdDateTime: at,
  eventDetail: {
    '@odata.type': '#microsoft.graph.callRecordingEventMessageDetail',
    callRecordingDuration: duration,
    callRecordingStatus: status,
    ...(url ? { callRecordingUrl: url } : {}),
  },
});
/** An Exchange iCalUId: series id with an occurrence date (bytes 16–19). */
const goid = (date = '07EA0A13') => `040000008200E00074C5B7101A82E008${date}E0509170635DDD0100000000000000001000000047CAED7E`;

describe('Graph helpers', () => {
  it('reads Graph times in UTC only', () => {
    expect(graphTime(utc('2026-10-19T09:00:00Z'))?.toISOString()).toBe('2026-10-19T09:00:00.000Z');
    expect(graphTime({ dateTime: '2026-10-19T09:00:00.1234567', timeZone: 'utc' })?.toISOString()).toBe('2026-10-19T09:00:00.123Z');
    expect(graphTime({ dateTime: '2026-10-19T09:00:00', timeZone: 'W. Europe Standard Time' })).toBeUndefined();
    expect(graphTime({ dateTime: 'soon' })).toBeUndefined();
    expect(graphTime(undefined)).toBeUndefined();
  });

  it('finds the meeting chat in a join link and in an online meeting id', () => {
    expect(threadOfJoinUrl(joinUrl('a'))).toBe(thread('a'));
    expect(threadOfJoinUrl(`https://teams.microsoft.com/l/meetup-join/${thread('raw')}/0`)).toBe(thread('raw'));
    expect(threadOfJoinUrl('https://teams.microsoft.com/meet/123?p=abc')).toBeUndefined();
    expect(threadOfJoinUrl(undefined)).toBeUndefined();
    expect(threadOfMeetingId(meetingId('a'))).toBe(thread('a'));
    expect(threadOfMeetingId('bm90IGEgbWVldGluZw==')).toBeUndefined();
  });

  it('reads ISO durations as seconds', () => {
    expect(isoSeconds('PT1H2M3.6S')).toBe(3724);
    expect(isoSeconds('PT45M')).toBe(2700);
    expect(isoSeconds('P1D')).toBe(86_400);
    expect(isoSeconds('PT0S')).toBeUndefined();
    expect(isoSeconds('45 minutes')).toBeUndefined();
  });

  it('turns next links into paths WorkIQ takes', () => {
    expect(graphPath('https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=x')).toBe('/me/calendarView?$skiptoken=x');
    expect(graphPath('https://graph.microsoft.com/beta/me/chats/x/messages')).toBe('/me/chats/x/messages');
  });

  it('reads the error of a WorkIQ result, also when it is the Graph error body passed through', () => {
    const nested = { error: { code: 'Forbidden', message: '3003: User does not have access to lookup meeting', innerError: { date: 'x' } } };
    expect(graphResult({ statusCode: 403, data: null, error: nested }).error).toBe('Forbidden: 3003: User does not have access to lookup meeting');
    expect(graphResult({ statusCode: 400, error: { code: 'BadRequest', message: 'userId must be a GUID.' } }).error).toBe('BadRequest: userId must be a GUID.');
    expect(graphResult({ statusCode: 401, error: 'Unauthorized' }).error).toBe('Unauthorized');
    expect(graphResult({ statusCode: 200, data: { id: 'x' } })).toEqual({ statusCode: 200, data: { id: 'x' } });
    expect(graphResult({ statusCode: 500, error: {} })).toEqual({ statusCode: 500 });
    expect(graphResult(undefined)).toEqual({ statusCode: 0, error: 'no result' });
  });
});

describe('classifyMeetings', () => {
  const classify = (events: CalendarEvent[], more: { recordings?: MeetingArtifact[]; transcripts?: MeetingArtifact[]; chats?: [string, ChatEvents][] } = {}) =>
    classifyMeetings({ me: ME, now: NOW, events, recordings: more.recordings ?? [], transcripts: more.transcripts ?? [], chats: new Map(more.chats ?? []) });

  it('keeps each occurrence of a recurring meeting apart', () => {
    const meetings = classify(
      [event('weekly', '2026-10-18T09:00:00Z', '2026-10-18T09:30:00Z'), event('weekly', '2026-10-19T09:00:00Z', '2026-10-19T09:30:00Z')],
      {
        recordings: [artifact('weekly', '2026-10-19T09:31:00Z')],
        chats: [[thread('weekly'), [
          callEnded('2026-10-18T09:29:00Z', OTHER),
          callEnded('2026-10-19T09:30:00Z', OTHER, ME),
          recorded('2026-10-19T09:30:30Z', 'PT28M10S'),
        ]]],
      },
    );
    expect(meetings.map((m) => [m.key, m.missed, m.recordings, m.transcripts, m.recordingSeconds])).toEqual([
      [`teams:${thread('weekly')}:2026-10-19T09:00:00.000Z`, false, 1, 0, 1690],
      [`teams:${thread('weekly')}:2026-10-18T09:00:00.000Z`, true, 0, 0, undefined],
    ]);
    expect(meetings[0]).toMatchObject({ subject: 'Meeting weekly', organizer: 'Ada Lovelace', iCalUId: 'ical-weekly', threadId: thread('weekly') });
  });

  it('keeps meetings with only a transcript, and counts each artifact once', () => {
    const [m] = classify([event('t', '2026-10-19T10:00:00Z', '2026-10-19T11:00:00Z')], {
      transcripts: [artifact('t', '2026-10-19T11:05:00Z', 'tr1'), artifact('t', '2026-10-19T11:05:00Z', 'tr1')],
    });
    expect(m).toMatchObject({ missed: false, recordings: 0, transcripts: 1 });
  });

  it('leaves out declined, cancelled, future, offline and uneventful meetings', () => {
    const meetings = classify(
      [
        event('declined', '2026-10-19T09:00:00Z', '2026-10-19T09:30:00Z', { responseStatus: { response: 'declined' } }),
        event('cancelled', '2026-10-19T10:00:00Z', '2026-10-19T10:30:00Z', { isCancelled: true }),
        event('future', '2026-10-20T11:30:00Z', '2026-10-20T12:30:00Z'),
        event('offline', '2026-10-19T12:00:00Z', '2026-10-19T12:30:00Z', { onlineMeeting: null }),
        event('quiet', '2026-10-19T13:00:00Z', '2026-10-19T13:30:00Z'),
      ],
      {
        recordings: ['declined', 'cancelled', 'future'].map((n) => artifact(n, '2026-10-19T10:31:00Z')),
        chats: [[thread('quiet'), [callEnded('2026-10-19T13:30:00Z', ME)]]],
      },
    );
    expect(meetings).toEqual([]);
  });

  it('only skips the missed check when the meeting chat cannot be read', () => {
    const meetings = classify(
      [event('locked', '2026-10-19T09:00:00Z', '2026-10-19T09:30:00Z'), event('rec', '2026-10-19T10:00:00Z', '2026-10-19T10:30:00Z')],
      { recordings: [artifact('rec', '2026-10-19T10:31:00Z')], chats: [[thread('locked'), 'forbidden'], [thread('rec'), 'failed']] },
    );
    expect(meetings.map((m) => [m.subject, m.missed, m.recordings])).toEqual([['Meeting rec', false, 1]]);
  });

  it('ignores failed recordings and artifacts long after the meeting', () => {
    const meetings = classify([event('late', '2026-10-19T09:00:00Z', '2026-10-19T09:30:00Z')], {
      recordings: [artifact('late', '2026-10-19T20:00:00Z')],
      chats: [[thread('late'), [recorded('2026-10-19T09:30:00Z', 'PT20M', 'failure')]]],
    });
    expect(meetings).toEqual([]);
  });

  it('keeps the sharing link of the longest recording of each occurrence', () => {
    const meetings = classify(
      [event('parts', '2026-10-18T09:00:00Z', '2026-10-18T10:00:00Z'), event('parts', '2026-10-19T09:00:00Z', '2026-10-19T10:00:00Z')],
      {
        recordings: [artifact('parts', '2026-10-18T10:01:00Z'), artifact('parts', '2026-10-19T10:01:00Z')],
        chats: [[thread('parts'), [
          recorded('2026-10-19T09:20:00Z', 'PT20M', 'success', 'https://sp/part1'),
          recorded('2026-10-19T09:59:00Z', 'PT39M', 'success', 'https://sp/part2'),
          recorded('2026-10-19T09:59:30Z', 'PT39M', 'chunkFinished'),
          recorded('2026-10-18T09:59:00Z', 'PT5M', 'success', 'https://sp/day1'),
        ]]],
      },
    );
    expect(meetings.map((m) => [m.start.toISOString(), m.recordingUrl, m.recordingSeconds])).toEqual([
      ['2026-10-19T09:00:00.000Z', 'https://sp/part2', 2340],
      ['2026-10-18T09:00:00.000Z', 'https://sp/day1', 300],
    ]);
    expect(meetings[0]).not.toHaveProperty('fileSeconds');
  });
});

describe('meeting items', () => {
  const meeting: Meeting = {
    key: `teams:${thread('a')}:2026-10-19T09:00:00.000Z`,
    threadId: thread('a'),
    iCalUId: 'ical-a',
    subject: 'Planning',
    start: new Date('2026-10-19T09:00:00Z'),
    end: new Date('2026-10-19T09:30:00Z'),
    organizer: 'Ada Lovelace',
    preview: 'Agenda: things',
    missed: true,
    recordings: 2,
    transcripts: 1,
    recordingSeconds: 1500,
  };
  const recap = 'https://teams.microsoft.com/l/meetingrecap?iCalUid=ical-a&threadId=19%3Ameeting_a%40thread.v2';
  const stored: Update = {
    ...meetingItem(meeting),
    id: 'x',
    source: 'teams-meetings',
    datePublished: meeting.end.toISOString(),
    dateAdded: NOW.toISOString(),
    status: 'read',
    saved: true,
    content: meetingItem(meeting).content ?? '',
  };

  it('says what the meeting has on its first line, and reads it back', () => {
    const item = meetingItem(meeting);
    expect(item).toMatchObject({ key: meeting.key, title: 'Planning', url: recap, datePublished: meeting.end, durationSeconds: 1500 });
    expect(item.content).toBe(`Missed · 2 recordings · 1 transcript\nOrganizer: Ada Lovelace\nMeeting chat: ${chatUrl(thread('a'))}\n\nAgenda: things`);
    expect(meetingFacts(item.content)).toEqual({ missed: true, recordings: 2, transcripts: 1 });
    expect(factsLine({ missed: false, recordings: 1, transcripts: 0 })).toBe('1 recording');
    expect(meetingFacts('1 transcript\nMissed')).toEqual({ missed: false, recordings: 0, transcripts: 1 });
  });

  it.each([
    { recordings: 1, transcripts: 0 },
    { recordings: 0, transcripts: 1 },
  ])('links directly to recap for $recordings recordings and $transcripts transcripts', (artifacts) => {
    expect(meetingItem({ ...meeting, ...artifacts, missed: false }).url).toBe(recap);
  });

  it('encodes each recap identifier without adding recording-file parameters', () => {
    const threadId = '19:meeting_a+b/&?=#@thread.v2';
    const iCalUId = 'occurrence_a+b/&?=# 2';
    const url = new URL(meetingItem({ ...meeting, threadId, iCalUId }).url);
    expect(url.origin + url.pathname).toBe('https://teams.microsoft.com/l/meetingrecap');
    expect([...url.searchParams]).toEqual([['iCalUid', iCalUId], ['threadId', threadId]]);
    expect(url.hash).toBe('');
  });

  it('links the chat for missed-only meetings or missing occurrence identifiers', () => {
    expect(meetingItem({ ...meeting, recordings: 0, transcripts: 0 }).url).toBe(chatUrl(meeting.threadId));
    expect(meetingItem({ ...meeting, iCalUId: undefined }).url).toBe(chatUrl(meeting.threadId));
    expect(meetingItem({ ...meeting, iCalUId: '' }).url).toBe(chatUrl(meeting.threadId));
  });

  it('merges a fetched meeting without losing a known recap or stored facts', () => {
    const fetched = meetingItem({ ...meeting, iCalUId: undefined, subject: 'Planning (renamed)', missed: false, recordings: 1, transcripts: 3, recordingSeconds: undefined });
    expect(fetched.url).toBe(chatUrl(meeting.threadId));
    const change = mergeMeeting(stored, fetched);
    expect(change).toMatchObject({ title: 'Planning (renamed)', url: recap, durationSeconds: 1500 });
    expect(meetingFacts(change?.content)).toEqual({ missed: true, recordings: 2, transcripts: 3 });
    expect(change?.content).toContain('Organizer: Ada Lovelace');
  });

  it.each([
    chatUrl(thread('a')),
    'https://teams.microsoft.com/l/meetingrecap?threadId=19%3Ameeting_a%40thread.v2&iCalUid=ical-old',
  ])('replaces an existing link (%s) with the direct recap on refresh', (url) => {
    const previous = { ...stored, url };
    const change = mergeMeeting(previous, meetingItem(meeting));
    expect(change.url).toBe(recap);
    expect({ ...previous, ...change }).toMatchObject({ id: 'x', status: 'read', saved: true });
  });

  it('uses the occurrence id and the recording file, or else the series id too, in the recap link', () => {
    expect(seriesICalUId(goid())).toBe(goid('00000000'));
    expect(seriesICalUId(goid('00000000'))).toBe(goid('00000000'));
    expect(seriesICalUId('ical-a')).toBe('ical-a');
    const url = new URL(recapUrl({ ...meeting, iCalUId: goid(), recordingFile: { driveId: 'b!drive/+', driveItemId: '01ITEM' } })!);
    expect([...url.searchParams]).toEqual([
      ['driveId', 'b!drive/+'],
      ['driveItemId', '01ITEM'],
      ['iCalUid', goid()],
      ['threadId', meeting.threadId],
    ]);
    expect([...new URL(recapUrl({ ...meeting, iCalUId: goid() })!).searchParams]).toEqual([
      ['iCalUid', goid()],
      ['masterICalUid', goid('00000000').toLowerCase()],
      ['threadId', meeting.threadId],
    ]);
    expect([...new URL(recapUrl({ ...meeting, iCalUId: goid('00000000') })!).searchParams].map(([k]) => k)).toEqual(['iCalUid', 'threadId']);
    expect(recapUrl({ ...meeting, recordings: 0, transcripts: 0 })).toBeUndefined();
  });

  it('turns a sharing link into the id Graph takes', () => {
    const link = 'https://contoso-my.sharepoint.com/personal/ada/Documents/Recordings/Planning-20261019.mp4?web=1';
    const id = shareId(link);
    expect(id).toMatch(/^u![A-Za-z0-9_-]+$/);
    expect(Buffer.from(id.slice(2), 'base64url').toString('utf8')).toBe(link);
  });

  it('keeps a recap link that opens the recording when the refresh could not find the file', () => {
    const withFile = recapUrl({ ...meeting, recordingFile: { driveId: 'd', driveItemId: 'f' } })!;
    const previous = { ...stored, url: withFile };
    expect(mergeMeeting(previous, meetingItem(meeting)).url).toBe(withFile);
    const newer = meetingItem({ ...meeting, recordingFile: { driveId: 'd', driveItemId: 'g' } });
    expect(mergeMeeting(previous, newer).url).toBe(newer.url);
    // An older format (the series id alone) gives way, even with the file.
    const old = 'https://teams.microsoft.com/l/meetingrecap?driveId=d&driveItemId=f&threadId=19%3Ameeting_a%40thread.v2&iCalUid=ical-old';
    expect(mergeMeeting({ ...stored, url: old }, meetingItem(meeting)).url).toBe(meetingItem(meeting).url);
  });

  it('keeps a stored recording file of a recurring meeting in the link without the series id', () => {
    const recurring = { ...meeting, iCalUId: goid() };
    const fetched = meetingItem(recurring);
    expect(new URL(fetched.url).searchParams.has('masterICalUid')).toBe(true);
    const withSeries = `https://teams.microsoft.com/l/meetingrecap?driveId=d&driveItemId=f&iCalUid=${goid()}&masterICalUid=${goid('00000000').toLowerCase()}&threadId=${encodeURIComponent(meeting.threadId)}`;
    expect(mergeMeeting({ ...stored, url: withSeries }, fetched).url).toBe(recapUrl({ ...recurring, recordingFile: { driveId: 'd', driveItemId: 'f' } }));
    // Not for another occurrence.
    expect(mergeMeeting({ ...stored, url: withSeries }, meetingItem({ ...meeting, iCalUId: goid('07EA0A14') })).url).toBe(meetingItem({ ...meeting, iCalUId: goid('07EA0A14') }).url);
  });
});

describe('recording files found by name', () => {
  const at = (iso: string) => new Date(iso);
  const meeting: Meeting = {
    key: 'k',
    threadId: thread('zoe'),
    iCalUId: goid(),
    subject: 'ZOE | Office Hours: Q&A ',
    start: at('2026-10-16T09:00:00Z'),
    end: at('2026-10-16T10:00:00Z'),
    missed: false,
    recordings: 1,
    transcripts: 1,
    recordingStarts: [at('2026-10-16T09:04:31Z')],
    transcriptStarts: [at('2026-10-16T08:59:10Z')],
  };
  const hit = (title: string | undefined, driveItemId = title ?? 'none'): FileHit => ({ driveId: 'drive', driveItemId, ...(title ? { title } : {}) });

  it('reads the start stamp in a recording name, in any language', () => {
    expect(recordingStamp('ZOE  Office Hours Q_A-20261016_110423-Meeting Recording')).toEqual({ title: 'ZOE  Office Hours Q_A', at: at('2026-10-16T11:04:23Z'), utc: false });
    expect(recordingStamp('Sync - Weekly-20261016_165907UTC-Besprechungstranskript')).toEqual({ title: 'Sync - Weekly', at: at('2026-10-16T16:59:07Z'), utc: true });
    expect(recordingStamp('Sync notes 2026-10-16')).toBeUndefined();
  });

  it('matches the file named after the meeting and stamped at its recording, in the organizer’s time zone', () => {
    const hits = [
      hit('ZOE Office Hours Notes 2026-10-16', 'doc'),
      hit('Other meeting-20261016_110423-Meeting Recording', 'other'),
      hit('ZOE  Office Hours Q_A-20261009_110425-Meeting Recording', 'last-week'),
      hit('ZOE  Office Hours Q_A-20261016_110423-Registrazione della riunione', 'this-one'),
      hit(undefined),
    ];
    expect(matchRecording(meeting, hits)).toEqual({ driveId: 'drive', driveItemId: 'this-one' });
    // −7 h (Pacific), and a name cut short.
    expect(matchRecording(meeting, [hit('ZOE Office-20261016_020440-Meeting Recording', 'pacific')])?.driveItemId).toBe('pacific');
    // Not off the quarter-hour grid, not a stamp in UTC that is not the time, not a day off.
    expect(matchRecording(meeting, [hit('ZOE Office Hours QA-20261016_110923-Meeting Recording')])).toBeUndefined();
    expect(matchRecording(meeting, [hit('ZOE Office Hours QA-20261016_110423UTC-Meeting Recording')])).toBeUndefined();
    expect(matchRecording(meeting, [hit('ZOE Office Hours QA-20261017_110423-Meeting Recording')])).toBeUndefined();
  });

  it('prefers the recording to a transcript-only file, else takes the transcript one', () => {
    const transcript = hit('ZOE Office Hours QA-20261016_085910UTC-Meeting Transcript', 'transcript');
    const recording = hit('ZOE Office Hours QA-20261016_020430-Meeting Recording', 'recording');
    expect(matchRecording(meeting, [transcript, recording])?.driveItemId).toBe('recording');
    expect(matchRecording(meeting, [transcript])?.driveItemId).toBe('transcript');
    expect(matchRecording({ ...meeting, recordingStarts: undefined, transcriptStarts: undefined }, [recording])).toBeUndefined();
  });

  it('searches the quoted subject and the day', () => {
    expect(recordingQuery({ ...meeting, subject: 'Say "hi"  team' })).toBe('"Say hi team" 20261016');
  });

  it('reads the files of a search answer, and fails on a failed search', () => {
    const answer = {
      'application/vnd.ms-workiq.retrieval': {
        stoppedReason: 'completed',
        results: [
          { driveId: 'b!d', itemId: '01A', resourceMetadata: { video: { title: 'Rec-20261016_110423-Meeting Recording' } } },
          { entityUrl: '/drives/b!e/items/01B', resourceMetadata: { document: { title: 'Notes' } } },
          { id: 'mail', resourceMetadata: {} },
        ],
      },
    };
    expect(fileHits(answer)).toEqual([
      { driveId: 'b!d', driveItemId: '01A', title: 'Rec-20261016_110423-Meeting Recording' },
      { driveId: 'b!e', driveItemId: '01B', title: 'Notes' },
    ]);
    expect(fileHits({ results: [], stoppedReason: 'completed' })).toEqual([]);
    expect(() => fileHits({ results: [], stoppedReason: 'error', errorCode: 'InternalError', error: 'Try later' })).toThrow('InternalError: Try later');
    expect(() => fileHits({ 'application/vnd.ms-workiq.retrieval': { results: [], stoppedReason: 'error' } })).toThrow('search failed');
    expect(() => fileHits({ text: 'no' })).toThrow('search failed');
  });
});

// ─── Provider, with a fake WorkIQ ──────────────────────────────────────────

interface FakeOptions {
  me?: GraphResult;
  events?: CalendarEvent[][];
  recordings?: MeetingArtifact[];
  transcripts?: MeetingArtifact[];
  chats?: Record<string, ChatMessage[] | number>;
  /** Drive items by sharing link, or the status Graph answers with. */
  files?: Record<string, { driveId: string; id: string } | number>;
  /** What a file search finds (all searches find nothing by default), or how it fails. */
  search?: (query: string) => FileHit[] | Error;
  onFetch?: (paths: string[]) => void;
}

function fakeWorkIQ(o: FakeOptions) {
  const calls = { fetch: [] as string[], callFunction: [] as string[], search: [] as string[], connect: 0, close: 0 };
  const pages = o.events ?? [[]];
  const calendar = (path: string): GraphResult => {
    const n = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? 0);
    return {
      statusCode: 200,
      data: { value: pages[n] ?? [], ...(n + 1 < pages.length ? { '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/calendarView?page=${n + 1}` } : {}) },
    };
  };
  const wq: WorkIQ = {
    async fetch(paths) {
      calls.fetch.push(...paths);
      o.onFetch?.(paths);
      return paths.map((p) => {
        if (p.startsWith('/me?')) return o.me ?? { statusCode: 200, data: { id: ME } };
        if (p.startsWith('/me/calendarView')) return calendar(p);
        const share = /^\/shares\/u!([^/]+)\/driveItem/.exec(p)?.[1];
        if (share) {
          const file = o.files?.[Buffer.from(share, 'base64url').toString('utf8')];
          if (typeof file === 'number') return { statusCode: file, error: 'Nope' };
          return file ? { statusCode: 200, data: { id: file.id, parentReference: { driveId: file.driveId } } } : { statusCode: 404, error: 'itemNotFound' };
        }
        const chat = /^\/me\/chats\/([^/]+)\/messages/.exec(p)?.[1];
        const found = chat ? o.chats?.[chat] : undefined;
        if (typeof found === 'number') return { statusCode: found, error: 'Forbidden' };
        return { statusCode: 200, data: { value: found ?? [] } };
      });
    },
    async callFunction(path) {
      calls.callFunction.push(path);
      return { statusCode: 200, data: { value: path.includes('getAllRecordings') ? o.recordings ?? [] : o.transcripts ?? [] } };
    },
    async searchFiles(query) {
      calls.search.push(query);
      const found = o.search?.(query) ?? [];
      if (found instanceof Error) throw found;
      return found;
    },
    async close() {
      calls.close++;
    },
  };
  return { calls, connect: async () => { calls.connect++; return wq; } };
}

describe('teamsMeetingsProvider', () => {
  const weekly = [event('a', '2026-10-19T09:00:00Z', '2026-10-19T09:30:00Z')];
  const second = [event('b', '2026-10-19T10:00:00Z', '2026-10-19T10:30:00Z'), event('c', '2026-10-19T11:00:00Z', '2026-10-19T11:30:00Z')];
  const recap = (name: string) => `https://teams.microsoft.com/l/meetingrecap?iCalUid=ical-${name}&threadId=19%3Ameeting_${name}%40thread.v2`;

  it('reads every calendar page and builds recap links even when chat access is denied', async () => {
    const fake = fakeWorkIQ({
      events: [weekly, second],
      recordings: [artifact('a', '2026-10-19T09:31:00Z'), artifact('c', '2026-10-19T11:31:00Z')],
      chats: { [thread('b')]: [callEnded('2026-10-19T10:30:00Z', OTHER)], [thread('c')]: 403 },
    });
    const provider = teamsMeetingsProvider({ connect: fake.connect, now: () => NOW });
    const items = await provider.fetch();
    expect(items.map((i) => [i.title, i.url, i.content?.split('\n')[0]])).toEqual([
      ['Meeting c', recap('c'), '1 recording'],
      ['Meeting b', chatUrl(thread('b')), 'Missed'],
      ['Meeting a', recap('a'), '1 recording'],
    ]);
    expect(fake.calls.fetch.filter((p) => p.startsWith('/me/calendarView'))).toHaveLength(2);
    expect(fake.calls.fetch.filter((p) => p.startsWith('/me/chats/'))).toHaveLength(3);
    expect(fake.calls.fetch).toHaveLength(6);
    expect(fake.calls.callFunction).toHaveLength(2);
    expect(fake.calls.callFunction.some((p) => p.includes(`meetingOrganizerUserId='${ME}'`))).toBe(true);
    expect(fake.calls.close).toBe(1);

    const again = await provider.fetch();
    expect(again).toEqual(items);
    expect(fake.calls.fetch).toHaveLength(12);
    expect(fake.calls.callFunction).toHaveLength(4);
    expect(fake.calls.close).toBe(2);
  });

  it('links the meeting chat when the calendar occurrence has no iCalUId', async () => {
    const fake = fakeWorkIQ({ events: [weekly.map((e) => ({ ...e, iCalUId: undefined }))], recordings: [artifact('a', '2026-10-19T09:31:00Z')] });
    const [item] = await teamsMeetingsProvider({ connect: fake.connect, now: () => NOW }).fetch();
    expect(item?.url).toBe(chatUrl(thread('a')));
  });

  it('uses the occurrence iCalUId for recurring meetings sharing a name and chat', async () => {
    const fake = fakeWorkIQ({
      events: [[
        event('weekly', '2026-10-18T09:00:00Z', '2026-10-18T09:30:00Z', { iCalUId: 'ical-first' }),
        event('weekly', '2026-10-19T09:00:00Z', '2026-10-19T09:30:00Z', { iCalUId: 'ical-second' }),
      ]],
      recordings: [artifact('weekly', '2026-10-18T09:31:00Z')],
      transcripts: [artifact('weekly', '2026-10-19T09:31:00Z')],
      chats: { [thread('weekly')]: 403 },
    });
    const items = await teamsMeetingsProvider({ connect: fake.connect, now: () => NOW }).fetch();
    expect(items.map((item) => [item.key, [...new URL(item.url).searchParams]])).toEqual([
      [`teams:${thread('weekly')}:2026-10-19T09:00:00.000Z`, [['iCalUid', 'ical-second'], ['threadId', thread('weekly')]]],
      [`teams:${thread('weekly')}:2026-10-18T09:00:00.000Z`, [['iCalUid', 'ical-first'], ['threadId', thread('weekly')]]],
    ]);
  });

  it('opens each occurrence at its own recording, looking each file up once', async () => {
    const fake = fakeWorkIQ({
      events: [[
        event('weekly', '2026-10-18T09:00:00Z', '2026-10-18T09:30:00Z', { iCalUId: goid('07EA0A12') }),
        event('weekly', '2026-10-19T09:00:00Z', '2026-10-19T09:30:00Z', { iCalUId: goid('07EA0A13') }),
        event('locked', '2026-10-19T10:00:00Z', '2026-10-19T10:30:00Z'),
        event('busy', '2026-10-19T11:00:00Z', '2026-10-19T11:30:00Z'),
      ]],
      recordings: ['2026-10-18T09:31:00Z', '2026-10-19T09:31:00Z'].map((t) => artifact('weekly', t))
        .concat(artifact('locked', '2026-10-19T10:31:00Z'), artifact('busy', '2026-10-19T11:31:00Z')),
      chats: {
        [thread('weekly')]: [
          recorded('2026-10-18T09:30:00Z', 'PT29M', 'success', 'https://sp/day1'),
          recorded('2026-10-19T09:30:00Z', 'PT29M', 'success', 'https://sp/day2'),
        ],
        [thread('locked')]: [recorded('2026-10-19T10:30:00Z', 'PT29M', 'success', 'https://sp/locked')],
        [thread('busy')]: [recorded('2026-10-19T11:30:00Z', 'PT29M', 'success', 'https://sp/busy')],
      },
      files: { 'https://sp/day1': { driveId: 'drive', id: 'item1' }, 'https://sp/day2': { driveId: 'drive', id: 'item2' }, 'https://sp/locked': 403, 'https://sp/busy': 503 },
    });
    const provider = teamsMeetingsProvider({ connect: fake.connect, now: () => NOW });
    const params = (items: { url: string }[]) => items.map((i) => Object.fromEntries(new URL(i.url).searchParams));
    const items = await provider.fetch();
    expect(params(items)).toEqual([
      { threadId: thread('busy'), iCalUid: 'ical-busy' },
      { threadId: thread('locked'), iCalUid: 'ical-locked' },
      { driveId: 'drive', driveItemId: 'item2', iCalUid: goid('07EA0A13'), threadId: thread('weekly') },
      { driveId: 'drive', driveItemId: 'item1', iCalUid: goid('07EA0A12'), threadId: thread('weekly') },
    ]);
    const shares = () => fake.calls.fetch.filter((p) => p.startsWith('/shares/')).map((p) => Buffer.from(/u!([^/]+)/.exec(p)![1]!, 'base64url').toString());
    expect(shares().sort()).toEqual(['https://sp/busy', 'https://sp/day1', 'https://sp/day2', 'https://sp/locked']);

    // Found and refused files are remembered; a failed lookup is tried again.
    expect(params(await provider.fetch())).toEqual(params(items));
    expect(shares().filter((u) => u === 'https://sp/busy')).toHaveLength(2);
    expect(shares()).toHaveLength(5);
  });

  it('opens the occurrence by its ids alone when the meeting chat is closed and no file is found', async () => {
    const fake = fakeWorkIQ({
      events: [[event('office', '2026-10-19T09:00:00Z', '2026-10-19T10:00:00Z', { iCalUId: goid('07EA0A13') })]],
      recordings: [{ id: 'r', meetingId: meetingId('office'), createdDateTime: '2026-10-19T09:04:29Z' }],
      chats: { [thread('office')]: 403 },
    });
    const items = await teamsMeetingsProvider({ connect: fake.connect, now: () => NOW }).fetch();
    expect(items.map((i) => Object.fromEntries(new URL(i.url).searchParams))).toEqual([
      { iCalUid: goid('07EA0A13'), masterICalUid: goid('00000000').toLowerCase(), threadId: thread('office') },
    ]);
    expect(fake.calls.fetch.some((p) => p.startsWith('/shares/') || p.startsWith('/users/'))).toBe(false);
    expect(fake.calls.search).toEqual(['"Meeting office" 20261019']);
  });

  describe('searching the recording file', () => {
    const recordingOf = (name: string, stamp: string, id: string): FileHit => ({ driveId: 'drive', driveItemId: id, title: `Meeting ${name}-${stamp}-Meeting Recording` });
    const closed = (names: string[]) => ({
      events: [names.map((n, i) => event(n, `2026-10-19T0${i}:00:00Z`, `2026-10-19T0${i}:30:00Z`, { iCalUId: goid() }))],
      recordings: names.map((n, i) => artifact(n, `2026-10-19T0${i}:00:20Z`)),
      chats: Object.fromEntries(names.map((n) => [thread(n), 403])),
    });
    const file = (item: { url: string } | undefined) => new URL(item!.url).searchParams.get('driveItemId');

    it('finds the file of a meeting whose chat is closed, and remembers it', async () => {
      // The organizer is two hours ahead of UTC.
      const fake = fakeWorkIQ({ ...closed(['a']), search: () => [recordingOf('a', '20261019_020016', 'found')] });
      const provider = teamsMeetingsProvider({ connect: fake.connect, now: () => NOW });
      const [item] = await provider.fetch();
      expect(Object.fromEntries(new URL(item!.url).searchParams)).toEqual({ driveId: 'drive', driveItemId: 'found', iCalUid: goid(), threadId: thread('a') });
      await provider.fetch();
      expect(fake.calls.search).toHaveLength(1);
    });

    it('does not search when the meeting chat shares the recording', async () => {
      const fake = fakeWorkIQ({
        events: [weekly],
        recordings: [artifact('a', '2026-10-19T09:31:00Z')],
        chats: { [thread('a')]: [recorded('2026-10-19T09:30:00Z', 'PT29M', 'success', 'https://sp/a')] },
        files: { 'https://sp/a': { driveId: 'drive', id: 'shared' } },
      });
      const [item] = await teamsMeetingsProvider({ connect: fake.connect, now: () => NOW }).fetch();
      expect(file(item)).toBe('shared');
      expect(fake.calls.search).toEqual([]);
    });

    it('searches again for a file not found after an hour', async () => {
      let clock = NOW;
      let hits: FileHit[] = [];
      const fake = fakeWorkIQ({ ...closed(['a']), search: () => hits });
      const provider = teamsMeetingsProvider({ connect: fake.connect, now: () => clock });
      expect(file((await provider.fetch())[0])).toBeNull();
      hits = [recordingOf('a', '20261019_000020', 'late')];
      clock = new Date(NOW.getTime() + 30 * 60_000);
      expect(file((await provider.fetch())[0])).toBeNull();
      clock = new Date(NOW.getTime() + 61 * 60_000);
      expect(file((await provider.fetch())[0])).toBe('late');
      expect(fake.calls.search).toHaveLength(2);
    });

    it('rests after failed searches, without taking them for "not found"', async () => {
      let clock = NOW;
      let failing = true;
      const fake = fakeWorkIQ({
        ...closed(['a', 'b', 'c', 'd']),
        search: (q) => (failing ? new Error('InternalError') : [recordingOf(/Meeting (\w)/.exec(q)![1]!, `20261019_0${'abcd'.indexOf(/Meeting (\w)/.exec(q)![1]!)}0020`, q)]),
      });
      const provider = teamsMeetingsProvider({ connect: fake.connect, now: () => clock });
      const first = await provider.fetch();
      expect(first.map(file)).toEqual([null, null, null, null]);
      expect(fake.calls.search.length).toBeGreaterThanOrEqual(2);
      expect(fake.calls.search.length).toBeLessThan(4);
      const tried = fake.calls.search.length;

      failing = false;
      clock = new Date(NOW.getTime() + 10 * 60_000);
      await provider.fetch();
      expect(fake.calls.search).toHaveLength(tried);

      clock = new Date(NOW.getTime() + 16 * 60_000);
      const later = await provider.fetch();
      expect(later.map(file).every((f) => f !== null)).toBe(true);
      expect(fake.calls.search).toHaveLength(tried + 4);
    });
  });

  it('upgrades a missed meeting to a recap on the next fetch when a recording arrives', async () => {
    const recordings: MeetingArtifact[] = [];
    const fake = fakeWorkIQ({
      events: [weekly],
      recordings,
      chats: { [thread('a')]: [callEnded('2026-10-19T09:30:00Z', OTHER)] },
    });
    const provider = teamsMeetingsProvider({ connect: fake.connect, now: () => NOW });
    const [before] = await provider.fetch();
    expect(before?.url).toBe(chatUrl(thread('a')));
    recordings.push(artifact('a', '2026-10-19T09:31:00Z'));
    const [after] = await provider.fetch();
    expect(after?.key).toBe(before?.key);
    expect(after?.url).toBe(recap('a'));
  });

  it('asks to sign in again when WorkIQ cannot read the profile, and still stops WorkIQ', async () => {
    const fake = fakeWorkIQ({ me: { statusCode: 401, error: 'Unauthorized' } });
    await expect(teamsMeetingsProvider({ connect: fake.connect, now: () => NOW }).fetch()).rejects.toThrow('sign in again');
    expect(fake.calls.close).toBe(1);
  });

  it('stops WorkIQ when the fetch is cancelled', async () => {
    const abort = new AbortController();
    const fake = fakeWorkIQ({
      events: [weekly],
      recordings: [artifact('a', '2026-10-19T09:31:00Z')],
      onFetch: (paths) => { if (paths.some((p) => p.startsWith('/me/chats/'))) abort.abort(); },
    });
    const provider = teamsMeetingsProvider({ connect: fake.connect, now: () => NOW });
    await expect(provider.fetch(abort.signal)).rejects.toThrow();
    expect(fake.calls.close).toBe(1);
  });

  it('merges like mergeMeeting and has the source id', () => {
    const provider = teamsMeetingsProvider();
    expect(provider.id).toBe('teams-meetings');
    expect(provider.merge).toBe(mergeMeeting);
  });
});

describe('experimentalProviders', () => {
  it('gives the providers of the known ids that are on', () => {
    const provider = teamsMeetingsProvider();
    const setups: ExperimentalSetups = { 'teams-meetings': { consent: 'ok', signIn: async () => ({ ok: true, output: '' }), provider: () => provider } };
    expect(experimentalProviders(['teams-meetings', 'nope'], setups)).toEqual([provider]);
    expect(experimentalProviders(undefined, setups)).toEqual([]);
  });
});
