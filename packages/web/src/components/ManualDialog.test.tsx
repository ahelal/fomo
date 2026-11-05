import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FomoService } from '@fomo/core';
import { ManualDialog } from './ManualDialog.js';

describe('ManualDialog', () => {
  it('shows required title and body fields, the Manual source and the save shortcut', () => {
    const html = renderToStaticMarkup(
      <ManualDialog service={{} as FomoService} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    expect(html).toContain('Add manual item');
    expect(html).toContain('Source: Manual · starts unread');
    expect(html).toMatch(/<input[^>]*required/);
    expect(html).toMatch(/<textarea[^>]*required/);
    expect(html).toContain('Ctrl/Cmd+S');
    expect(html).not.toContain('Learning Manual entries');
  });
});
