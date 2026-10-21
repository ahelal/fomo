import React from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import { FilterBar } from '../src/ui/components/FilterBar.js';

function frame(unreadGrouped: boolean): string {
  const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 10 }) as unknown as NodeJS.WriteStream;
  let out = '';
  stdout.on('data', (chunk) => { out += String(chunk); });
  const app = render(
    <FilterBar
      active="unread"
      groupedViews={{ unread: unreadGrouped, saved: true }}
      columns={100}
    />,
    { stdout, debug: true, patchConsole: false },
  );
  app.unmount();
  return out.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

describe('FilterBar', () => {
  it('shows a fixed-width mode icon without shifting later tabs', () => {
    const topics = frame(true);
    const list = frame(false);

    expect(topics).toContain('2 Unread ▤');
    expect(list).toContain('2 Unread ≡');
    expect(topics.indexOf('3 Read')).toBe(list.indexOf('3 Read'));
    expect(topics.indexOf('4 Pending')).toBe(list.indexOf('4 Pending'));
  });
});
