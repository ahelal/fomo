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
  it('renders when the selection is past the end, as right after grouping shrinks the list', () => {
    const rows = Array.from({ length: 6 }, (_, i) => topicRow(i));
    expect(() => frame(rows, 29)).not.toThrow();
    expect(frame(rows, 29)).toContain('Video 5');
  });
});
