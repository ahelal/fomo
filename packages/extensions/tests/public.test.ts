import { describe, expect, it, vi } from 'vitest';
import type { ExtensionContext, GithubRelease } from '@fomo/core/extension-api';
import { fetch as fetchCopilot, parseChangelog } from '../src/copilot-cli/index.js';
import { fetch as fetchAnthropic, parsePosts } from '../src/anthropic/index.js';

function context(releases: GithubRelease[] = [], changelog: string | Error = ''): ExtensionContext {
  return {
    options: {}, signal: new AbortController().signal,
    http: {
      text: async () => { if (changelog instanceof Error) throw changelog; return changelog; },
      json: async <T>() => releases as T,
    },
    state: { get: async () => undefined, set: async () => {} },
    mcp: { call: async () => { throw new Error('No MCP access'); } },
    log: vi.fn(),
  };
}
const release = (tag: string, body: string): GithubRelease => ({
  name: tag.replace(/^v/, ''), tag_name: tag, body,
  html_url: `https://github.com/github/copilot-cli/releases/tag/${tag}`,
  published_at: '2026-10-08T00:00:00Z', created_at: '2026-10-08T00:00:00Z',
});

describe('Copilot CLI extension', () => {
  it('parses release notes and strips markdown', async () => {
    const [item] = await fetchCopilot(context([release('v1.0.27', "## What's Changed\n\n* **New feature**\n* Fixed [bug](https://example.com)")]));
    expect(item).toMatchObject({ title: '1.0.27', url: 'https://github.com/github/copilot-cli/releases/tag/v1.0.27' });
    expect(item.content).toContain('New feature');
    expect(item.content).not.toMatch(/\*\*|##/);
  });
  it('uses exact changelog sections and replaces only placeholder prerelease bodies', async () => {
    const items = await fetchCopilot(context([
      release('v1.0.95-0', 'Fixes and changes'), release('v1.0.94', '2026-10-08'),
      release('v1.0.94-2', 'Fixes and changes'), release('v1.0.94-1', '**Fixed**\n- Real notes'),
    ], '# Changelog\n## 1.0.94 - 2026-10-08\n- Add model\n- `copilot mcp add` recovers\n## 1.0.93\n- Earlier'));
    const notes = Object.fromEntries(items.map((i) => [i.title, i.content]));
    expect(notes['1.0.94']).toBe('- Add model\n- copilot mcp add recovers');
    expect(notes['1.0.94-2']).toContain('Add model');
    expect(notes['1.0.94-1']).toBe('Fixed\n- Real notes');
    expect(notes['1.0.95-0']).toBe('Fixes and changes');
  });
  it('logs changelog failure and preserves release-body fallback', async () => {
    const ctx = context([release('v1.0.94', '- Something new')], new Error('offline'));
    expect((await fetchCopilot(ctx))[0].content).toContain('Something new');
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('offline'));
  });
  it('parses changelog headings', () => {
    const sections = parseChangelog('## 1.0.2 - 2026-01-02\n\n- two\n\n## v1.0.1\n- one\n');
    expect([...sections]).toEqual([['1.0.2', '- two'], ['1.0.1', '- one']]);
  });
  it('propagates release API failures', async () => {
    const ctx = context();
    ctx.http.json = async () => { throw new Error('offline'); };
    await expect(fetchCopilot(ctx)).rejects.toThrow('offline');
  });
});

describe('Anthropic extension', () => {
  it('preserves post titles, dates, section filtering and URL deduplication', () => {
    const html = '<a href="/news/post-one"><span class="Card__title">Post one &amp; more</span><time>Oct 18, 2026</time></a><a href="/news/post-one">duplicate</a><a href="/research/other"><span class="x__title">Other</span></a>';
    expect(parsePosts(html, 'news')).toEqual([
      { title: 'Post one & more', url: 'https://www.anthropic.com/news/post-one', datePublished: new Date('Oct 18, 2026') },
    ]);
  });
  it('rejects paths disguised as section options', async () => {
    const ctx = context();
    ctx.options = { section: '../secrets' };
    await expect(fetchAnthropic(ctx)).rejects.toThrow('invalid section');
  });
});
