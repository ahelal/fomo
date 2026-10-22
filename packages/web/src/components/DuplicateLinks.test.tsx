import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Update } from '@fomo/core';
import { DuplicateLinks } from './DuplicateLinks.js';
import { DetailPane } from './DetailPane.js';

function update(source: string, hash: string, extra: Partial<Update> = {}): Update {
  return {
    id: `${source}__${hash}`,
    source,
    title: `Title from ${source}`,
    url: `https://example.com/${source}/${hash}`,
    datePublished: '2025-03-04T10:00:00.000Z',
    dateAdded: '2025-03-04T11:00:00.000Z',
    status: 'unread',
    saved: false,
    content: '',
    ...extra,
  };
}

const original = update('hn', 'aaa', { title: 'Original post' });
const copy = update('devto', 'bbb', { title: 'Copy of the post', duplicateOf: original.id });
const sameSourceCopy = update('hn', 'ccc', { title: 'Copy from the same source', duplicateOf: original.id });

const labelOf = (s: string) => ({ hn: 'Hacker News', devto: 'DEV' })[s] ?? s;

function render(props: Partial<React.ComponentProps<typeof DuplicateLinks>> & Pick<React.ComponentProps<typeof DuplicateLinks>, 'source' | 'duplicates'>) {
  return renderToStaticMarkup(
    <DuplicateLinks listed={new Set()} onJump={() => {}} labelOf={labelOf} colorOf={() => undefined} {...props} />,
  );
}

describe('DuplicateLinks', () => {
  it('renders nothing without duplicates', () => {
    expect(render({ source: 'hn', duplicates: [] })).toBe('');
  });

  it('shows the original on a copy, with its source and a flag when the source differs', () => {
    const html = render({ source: 'devto', duplicates: [original] });
    expect(html).toContain('dup-link__role--original');
    expect(html).toContain('>original<');
    expect(html).toContain('>Hacker News<');
    expect(html).toContain('other source');
    expect(html).toContain('2025-03-04');
  });

  it('shows the copies on the original, in the order given', () => {
    const html = render({ source: 'hn', duplicates: [copy, sameSourceCopy] });
    expect(html).toContain('dup-link__role--copy');
    expect(html).toContain('>duplicate<');
    expect(html.indexOf('Copy of the post')).toBeLessThan(html.indexOf('Copy from the same source'));
  });

  it('flags only the entries from another source', () => {
    const html = render({ source: 'hn', duplicates: [copy, sameSourceCopy] });
    expect(html.match(/other source/g)).toHaveLength(1);
    expect(html.indexOf('other source')).toBeLessThan(html.indexOf('Copy from the same source'));
  });

  it('links the title to the update, even when it is not in this view', () => {
    const html = render({ source: 'devto', duplicates: [original] });
    expect(html).toContain(`href="${original.url}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('>Original post<');
    expect(html).toContain('not in this view');
    expect(html).not.toContain('<button');
  });

  it('offers a jump only to the updates in this view', () => {
    const html = render({ source: 'hn', duplicates: [copy, sameSourceCopy], listed: new Set([sameSourceCopy.id]) });
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html.match(/not in this view/g)).toHaveLength(1);
    expect(html.indexOf('not in this view')).toBeLessThan(html.indexOf('<button'));
  });

  it('colours the source like the lists do', () => {
    const html = render({ source: 'hn', duplicates: [copy], colorOf: (s) => (s === 'devto' ? '#ff00aa' : undefined) });
    expect(html).toContain('style="color:#ff00aa"');
  });

  it('names a source without a label by its id', () => {
    const html = render({ source: 'hn', duplicates: [update('blog', 'ddd', { duplicateOf: original.id })], labelOf: (s) => s });
    expect(html).toContain('>blog<');
  });
});

describe('DetailPane duplicates', () => {
  const pane = (props: Partial<React.ComponentProps<typeof DetailPane>> = {}) =>
    renderToStaticMarkup(
      <DetailPane
        update={update('hn', 'aaa', { content: '<p>Body of the post</p>' })}
        onSetStatus={vi.fn()}
        onToggleSaved={vi.fn()}
        {...props}
      />,
    );

  it('lists them last, after the content', () => {
    const html = pane({ duplicates: [copy], listed: new Set(), labelOf });
    expect(html).toContain('detail-pane__duplicates');
    expect(html.indexOf('detail-pane__duplicates')).toBeGreaterThan(html.indexOf('detail-pane__content'));
    expect(html).toContain('>DEV<');
    expect(html).toContain('other source');
  });

  it('shows no block without duplicates', () => {
    expect(pane()).not.toContain('detail-pane__duplicates');
    expect(pane({ duplicates: [] })).not.toContain('detail-pane__duplicates');
  });

  it('falls back to the source id and no colour when no helpers are given', () => {
    const html = pane({ duplicates: [copy] });
    expect(html).toContain('>devto<');
  });
});
