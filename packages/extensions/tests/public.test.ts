import { describe, expect, it } from 'vitest';
import type { ExtensionContext } from '@fomo/core/extension-api';
import { fetch as fetchAnthropic, parsePosts } from '../src/anthropic/index.js';

function context(): ExtensionContext {
  return {
    options: {}, signal: new AbortController().signal,
    http: {
      text: async () => '',
      json: async <T>() => null as T,
    },
    state: { get: async () => undefined, set: async () => {} },
    mcp: { call: async () => { throw new Error('No MCP access'); } },
    log: () => {},
  };
}

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
