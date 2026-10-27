import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Update } from '@fomo/core';
import { DetailPane } from './DetailPane.js';

const update: Update = {
  id: 'app__1', source: 'app', title: 'Release notes', url: 'https://example.com/1',
  datePublished: '2026-10-27', dateAdded: '2026-10-27', status: 'unread', saved: false, content: '',
};

function render(content: string) {
  return renderToStaticMarkup(<DetailPane update={{ ...update, content }} onSetStatus={() => {}} onToggleSaved={() => {}} />);
}

describe('release-note previews', () => {
  it('keeps line breaks and bullets instead of flattening them', () => {
    expect(render('Highlights\n\n- First fix\n- Second fix')).toContain('Highlights\n\n- First fix\n- Second fix</pre>');
  });

  it('does not truncate the scrollable content at 1000 characters', () => {
    const content = `${'Release details '.repeat(100).trimEnd()}\n\n- Last release note`;
    expect(render(content)).toContain(content);
  });

  it('renders HTML lists as safe, separate text lines', () => {
    const html = render('<p>Features</p><ul><li>First</li><li>Second</li></ul><script>alert(1)</script>');
    expect(html).toContain('- First\n\n- Second</pre>');
    expect(html).not.toContain('alert(1)');
  });
});
