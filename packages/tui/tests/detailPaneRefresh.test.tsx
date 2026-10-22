import React, { type ComponentProps } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import type { Update } from '@fomo/core';
import { DetailPane } from '../src/ui/components/DetailPane.js';

const POST: Update = {
  id: 'blog__a',
  source: 'blog',
  title: 'A post',
  url: 'https://example.com/a',
  datePublished: '2026-10-01T00:00:00Z',
  dateAdded: '2026-10-01T00:00:00Z',
  status: 'unread',
  saved: false,
  content: 'The body of the post',
};

const plain = (text: string) => text.replace(/\u001B\[[0-9;]*m/g, '');

function pane(props: Partial<ComponentProps<typeof DetailPane>>): string {
  const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 40 }) as unknown as NodeJS.WriteStream;
  let out = '';
  stdout.on('data', (chunk) => { out = String(chunk); });
  const app = render(<DetailPane update={POST} height={20} columns={120} {...props} />, { stdout, debug: true, patchConsole: false });
  app.unmount();
  return plain(out);
}

describe('DetailPane refresh (u)', () => {
  it('offers u next to g, and only u once there is a summary', () => {
    expect(pane({})).toContain('g summarise · u refresh');
    const out = pane({ update: { ...POST, gist: { summary: 'In short.', points: [] } } });
    expect(out).toContain('u refresh');
    expect(out).not.toContain('g summarise');
  });

  it('says when the page is being re-read', () => {
    const out = pane({ refreshing: true });
    expect(out).toContain('Refreshing from the page…');
    expect(out).not.toContain('u refresh');
  });

  it('shows the reading time or the video length', () => {
    expect(pane({ update: { ...POST, readingTimeMinutes: 9 } })).toMatch(/Published 2026-10-01\s+Reading ~9m/);
    expect(pane({ update: { ...POST, durationSeconds: 849 } })).toMatch(/Length 14:09/);
    expect(pane({})).not.toMatch(/Reading ~|Length /);
  });

  it('points to u when there is no preview', () => {
    expect(pane({ update: { ...POST, content: '' } })).toMatch(/No preview — press u/);
  });
});
