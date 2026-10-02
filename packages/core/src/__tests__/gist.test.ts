import { describe, it, expect, vi } from 'vitest';
import type { Update } from '../types.js';
import {
  buildGistPrompt,
  gistSource,
  GIST_MAX_INPUT_CHARS,
  mentionsTitle,
  parseGist,
  POST_GIST_SYSTEM_PROMPT,
  writeGist,
} from '../digest/gist.js';

const upd = (over: Partial<Update> = {}): Update => ({
  id: 'github__1',
  source: 'github',
  title: 'Copilot code review gets agentic tools',
  url: 'https://example.com',
  datePublished: '2026-10-01T10:00:00Z',
  dateAdded: 'x',
  status: 'unread',
  saved: false,
  content: '',
  ...over,
});

describe('mentionsTitle', () => {
  it('needs most of the title words in the text', () => {
    expect(mentionsTitle('Today Copilot code review gained tools that are agentic', 'Copilot code review gets agentic tools')).toBe(true);
    expect(mentionsTitle('Get the latest Azure updates', 'Public Preview: SQL performance monitoring for SQL Server')).toBe(false);
    expect(mentionsTitle('anything', 'v1.0.92')).toBe(true);
  });
});

describe('gistSource', () => {
  it('uses the page when it is longer and about the post, else the html-free preview', () => {
    const update = upd({ content: '<p>Preview&nbsp;text</p>' });
    expect(gistSource(update, 'Copilot code review gets agentic tools and more text')).toEqual({
      text: 'Copilot code review gets agentic tools and more text',
      from: 'page',
    });
    expect(gistSource(update, 'Generic page shell with much more text than the preview')).toEqual({ text: 'Preview text', from: 'preview' });
    expect(gistSource(update, undefined)).toEqual({ text: 'Preview text', from: 'preview' });
  });
});

describe('buildGistPrompt / parseGist / writeGist', () => {
  it('sends title, source, date and the capped post text with low effort', () => {
    const p = buildGistPrompt(upd(), 'x'.repeat(GIST_MAX_INPUT_CHARS + 50));
    expect(p.system).toBe(POST_GIST_SYSTEM_PROMPT);
    expect(p.effort).toBe('low');
    expect(p.prompt.startsWith('TITLE: Copilot code review gets agentic tools\nSOURCE: github · 2026-10-01\n\nPOST:\n')).toBe(true);
    expect(p.prompt.endsWith('…')).toBe(true);
  });

  it('cleans bullets, drops blanks and keeps at most 5 points', () => {
    expect(parseGist({ summary: '  A  gist ', points: ['• one', '', 2, '- two', 'three', 'four', 'five', 'six'] })).toEqual({
      summary: 'A gist',
      points: ['one', 'two', 'three', 'four', 'five'],
    });
    expect(parseGist({ summary: 'Only' })).toEqual({ summary: 'Only', points: [] });
    expect(() => parseGist({ points: ['x'] })).toThrow(/no summary/);
    expect(() => parseGist(null)).toThrow(/no summary/);
  });

  it('asks the summarizer with a timeout and parses the reply', async () => {
    const summarizer = { generateJson: vi.fn().mockResolvedValue({ summary: 'S', points: ['P'] }) };
    expect(await writeGist(upd(), 'text', summarizer, 5000)).toEqual({ summary: 'S', points: ['P'] });
    expect(summarizer.generateJson).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5000, effort: 'low' }));
  });
});
