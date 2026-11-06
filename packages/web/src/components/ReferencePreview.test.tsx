import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MANUAL_SOURCE_ID, type Reference, type Update } from '@fomo/core';
import { ReferencePreview } from './ReferencePreview.js';

const reference: Reference = {
  id: 'r1', title: 'Saved note', url: 'fomo://manual/entry-1', updateId: 'manual__1',
  folder: 'learning', description: 'My note', createdAt: '2026-11-06', updatedAt: '2026-11-06',
};
const update: Update = {
  id: 'manual__1', source: MANUAL_SOURCE_ID, title: 'Saved note', url: reference.url,
  content: `Full manual body\n\n${'Details '.repeat(200)}\nLast paragraph`,
  dateAdded: '2026-11-06', datePublished: '2026-11-06', status: 'unread', saved: false,
};
const actions = { onEdit: vi.fn(), onClose: vi.fn() };

describe('ReferencePreview', () => {
  it('shows the full Manual body with paragraphs and no external Manual link', () => {
    const html = renderToStaticMarkup(<ReferencePreview reference={reference} update={update} loading={false} {...actions} />);
    expect(html).toContain(update.content);
    expect(html).toContain('e · Edit bookmark');
    expect(html).toContain('Close preview');
    expect(html).not.toContain('fomo://manual');
  });

  it('shows directly added links and their description without needing an update', () => {
    const html = renderToStaticMarkup(
      <ReferencePreview reference={{ ...reference, updateId: undefined, url: 'https://example.com' }} loading={false} {...actions} />,
    );
    expect(html).toContain('My note');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('Loading');
  });

  it('reports loading and failure explicitly', () => {
    expect(renderToStaticMarkup(<ReferencePreview reference={reference} loading {...actions} />)).toContain('Loading');
    const html = renderToStaticMarkup(
      <ReferencePreview reference={reference} loading={false} error="Could not load bookmark content" {...actions} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not load bookmark content');
    expect(html).toContain('My note');
  });

  it('renders saved external content safely and preserves the summary', () => {
    const html = renderToStaticMarkup(
      <ReferencePreview
        reference={{ ...reference, url: 'https://example.com' }}
        update={{ ...update, source: 'feed', content: '<p>Article body</p><script>bad()</script>', gist: { summary: 'Summary', points: ['Key point'] } }}
        loading={false}
        {...actions}
      />,
    );
    expect(html).toContain('Article body');
    expect(html).toContain('Summary');
    expect(html).toContain('Key point');
    expect(html).not.toContain('bad()');
  });
});
