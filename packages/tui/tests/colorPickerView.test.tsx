import React, { act } from 'react';
import { PassThrough } from 'node:stream';
import { Box, render } from 'ink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLOR_PALETTE, PALETTE_COLUMNS } from '@fomo/core';
import { ColorPicker } from '../src/ui/components/ColorPicker.js';
import { pickerState } from '../src/ui/hooks/useColorPicker.js';

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

/** Renders the popup on a `columns`×`rows` screen and returns its text. */
async function draw(color: string, columns: number, rows: number): Promise<string> {
  const stdout = Object.assign(new PassThrough(), { columns, rows });
  let frame = '';
  stdout.on('data', (chunk: Buffer) => { frame = chunk.toString(); });
  const state = pickerState({ title: 'work/', color, onPick: vi.fn() });
  await act(async () => {
    // The popup is absolutely placed, so it needs a screen-sized parent to show up.
    const screen = <Box width={columns} height={rows}><ColorPicker state={state} columns={columns} rows={rows} /></Box>;
    const instance = render(screen, {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: new PassThrough() as unknown as NodeJS.ReadStream,
      stderr: new PassThrough() as unknown as NodeJS.WriteStream,
      debug: true,
      patchConsole: false,
    });
    unmount = () => instance.unmount();
  });
  return frame;
}

// Every swatch width (2, 3, 5) with and without the airy spacing (28+ rows).
const SIZES: [number, number][] = [[40, 20], [60, 20], [100, 20], [40, 40], [60, 40], [100, 40]];

describe('ColorPicker popup', () => {
  it.each(SIZES)('shows a custom color (outside the palette) on %i×%i', async (columns, rows) => {
    const frame = await draw('#123456', columns, rows);
    expect(frame).toContain('#123456');
    expect(frame).not.toMatch(/[▁▔]/);
  });

  it.each(SIZES)('frames the chosen swatch on %i×%i', async (columns, rows) => {
    // A swatch in the first row, so the frame line above it is drawn too.
    const frame = await draw(COLOR_PALETTE[PALETTE_COLUMNS - 1]!, columns, rows);
    expect(frame).toContain('✓');
    if (rows >= 28) expect(frame).toMatch(/▁/);
  });
});
