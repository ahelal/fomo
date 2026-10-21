import { describe, it, expect } from 'vitest';
import type { SourceDraft } from '@fomo/core';
import { detailsFields } from '../src/ui/components/SourceDetailsPane.js';

const draft = (url: string): SourceDraft => ({ enabled: true, label: '', color: '', name: 'n', url, include: '', shorts: false });

describe('source details fields', () => {
  it('offers the Shorts toggle only for a YouTube channel of your own', () => {
    expect(detailsFields(true, draft('https://www.youtube.com/@GitHub'))).toEqual(['enabled', 'label', 'color', 'name', 'url', 'include', 'shorts']);
    expect(detailsFields(true, draft('https://www.youtube.com/playlist?list=PL123456789012'))).not.toContain('shorts');
    expect(detailsFields(true, draft('https://example.com/rss'))).toEqual(['enabled', 'label', 'color', 'name', 'url', 'include']);
    expect(detailsFields(true, draft('https://github.com/o/r'))).toEqual(['enabled', 'label', 'color', 'name', 'url']);
    expect(detailsFields(false, draft(''))).toEqual(['enabled', 'label', 'color']);
  });
});
