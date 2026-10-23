import React from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import type { DigestEntry, DigestRow, Update } from '@fomo/core';
import { DigestTable } from '../src/ui/components/DigestTable.js';

const update = (n: number): Update => ({
  id: `yt__${n}`, source: 'yt', title: `Video ${n}`, url: `https://example.com/${n}`,
  datePublished: '2026-10-01T00:00:00Z', dateAdded: '2026-10-01T00:00:00Z', status: 'unread', saved: false, content: '', summary: '',
});

const topicRow = (n: number): DigestRow => {
  const entry = {
    topic: { id: `t${n}`, title: `Topic ${n}`, summary: '' },
    items: [update(n)], latestDate: '2026-10-01T00:00:00Z', sources: ['yt'], synthetic: true,
  } as unknown as DigestEntry;
  return { kind: 'topic', key: `t${n}`, entry };
};

function frame(rows: DigestRow[], selectedIndex: number): string {
  const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 30 }) as unknown as NodeJS.WriteStream;
  let out = '';
  stdout.on('data', (chunk) => { out += String(chunk); });
  const app = render(<DigestTable rows={rows} expanded={new Set()} pending={0} selectedIndex={selectedIndex} height={20} columns={120} />, { stdout, debug: true, patchConsole: false });
  app.unmount();
  return out;
}

describe('DigestTable', () => {
  it('shows estimated reading time and video duration for single-update groups', () => {
    const article = topicRow(1);
    const video = topicRow(2);
    article.entry.items[0]!.readingTimeMinutes = 7;
    video.entry.items[0]!.durationSeconds = 849;
    const output = frame([article, video], 0);
    expect(output).toContain('TIME');
    expect(output).toContain('~7m');
    expect(output).toContain('15m');
  });

  it('shows per-item times in expanded groups without inventing a group total', () => {
    const parent = topicRow(1);
    const article = { ...update(2), readingTimeMinutes: 6, summary: 'Article summary' };
    const video = { ...update(3), durationSeconds: 600 };
    parent.entry.items = [article, video];
    const rows: DigestRow[] = [
      parent,
      { kind: 'item', key: 'article', entry: parent.entry, update: article },
      { kind: 'item', key: 'video', entry: parent.entry, update: video },
    ];
    const output = frame(rows, 0);
    expect(output).toContain('~6m');
    expect(output).toContain('10m');
    expect(output).toContain('Article summary');
    expect(output).not.toContain('16m');
  });

  it('leaves unknown durations empty', () => {
    expect(frame([topicRow(1)], 0)).not.toContain('NaN');
    expect(frame([topicRow(1)], 0)).not.toContain('0m');
  });

  it('renders when the selection is past the end, as right after grouping shrinks the list', () => {
    const rows = Array.from({ length: 6 }, (_, i) => topicRow(i));
    expect(() => frame(rows, 29)).not.toThrow();
    expect(frame(rows, 29)).toContain('Video 5');
  });
});
