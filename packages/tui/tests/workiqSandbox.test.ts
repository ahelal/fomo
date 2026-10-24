import { describe, expect, it } from 'vitest';
import { openWorkIQ, runWorkIQ, validateWorkIQCall, workiqSignedIn } from '../src/experimental/workiq.js';

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

  it('requires profile approval before opening the host WorkIQ process', async () => {
    await expect(openWorkIQ(`no-consent-${Date.now()}`, new AbortController().signal)).rejects.toThrow(
      process.platform === 'darwin' ? 'explicit host-account sign-in' : 'only on macOS',
    );
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
