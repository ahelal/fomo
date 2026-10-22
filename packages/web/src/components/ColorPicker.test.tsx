import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_COLOR, PALETTE, type ColorRequest } from '@fomo/core';
import { ColorButton, ColorPickerDialog } from './ColorPicker.js';

function render(request: Partial<ColorRequest> = {}) {
  return renderToStaticMarkup(
    <ColorPickerDialog request={{ title: 'folder ai/', onPick: vi.fn(), ...request }} onClose={vi.fn()} />,
  );
}

/** The swatch the highlight is on. */
const checked = (html: string) => html.match(/aria-checked="true" aria-label="([^"]+)"/)?.[1];
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('ColorPickerDialog', () => {
  it('offers every palette color as a swatch', () => {
    const html = render();
    expect(html.match(/role="radio"/g)).toHaveLength(PALETTE.length);
    expect(html).toContain('aria-label="Red #f85149"');
    expect(html).toContain('Pick a color');
    expect(html).toContain('folder ai/');
  });

  it('highlights its own color and shows it as what it was', () => {
    const html = render({ color: '#F85149', fallback: '#3fb950', fallbackLabel: 'folder color' });
    expect(checked(html)).toBe('Red #f85149');
    expect(text(html)).toContain('Was Red #f85149');
    expect(html).not.toContain('color-picker__tag');
    expect(html).toContain('value="#f85149"');
  });

  it('highlights the fallback when it has no color of its own', () => {
    const html = render({ fallback: '#3fb950', fallbackLabel: 'folder color' });
    expect(checked(html)).toBe('Green #3fb950');
    expect(text(html)).toContain('Was folder color (Green)');
    // ↵ keeps it inherited until the highlight moves.
    expect(html).toContain('<span class="color-picker__tag">folder color</span>');
    expect(text(html)).toContain('↺ folder color');
    expect(text(html)).toContain('d folder color');
  });

  it('falls back to the default color', () => {
    const html = render();
    expect(checked(html)).toBe(`Blue ${DEFAULT_COLOR}`);
    expect(text(html)).toContain('Was default (Blue)');
  });

  it('shows a color outside the palette as a custom one', () => {
    const html = render({ color: '#123456' });
    expect(checked(html)).toBeUndefined();
    expect(text(html)).toContain('#123456 · custom');
    expect(html).toContain('type="color" value="#123456"');
  });

  it('previews the sample in the color', () => {
    expect(render({ color: '#f85149', sample: '▾ ai/' })).toContain('style="color:#f85149">▾ ai/</dd>');
    expect(render({ color: '#f85149' })).not.toContain('Sample');
  });
});

describe('ColorButton', () => {
  it('shows its own color and its name', () => {
    const html = renderToStaticMarkup(<ColorButton color="#f85149" onClick={vi.fn()} />);
    expect(html).toContain('background-color:#f85149');
    expect(text(html)).toContain('Red #f85149');
    expect(html).toContain('aria-label="Color: Red #f85149"');
  });

  it('shows the fallback as a ring without a color of its own', () => {
    const html = renderToStaticMarkup(<ColorButton color="" fallback="#3fb950" fallbackLabel="folder color" onClick={vi.fn()} />);
    expect(html).toContain('color-button__chip--none');
    expect(html).toContain('border-color:#3fb950');
    expect(text(html)).toContain('folder color');
    expect(html).toContain('aria-label="Color: folder color (Green)"');
  });

  it('is a bare chip when compact', () => {
    const html = renderToStaticMarkup(<ColorButton compact color="#f85149" onClick={vi.fn()} />);
    expect(html).not.toContain('color-button__label');
  });
});
