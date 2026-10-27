import React, { act, createRef } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, describe, expect, it } from 'vitest';
import { PreviewViewport, type PreviewScroll } from '../src/ui/components/PreviewViewport.js';

let unmount: (() => void) | undefined;
afterEach(() => { unmount?.(); });

async function viewport(text: string, columns = 30, height = 5) {
  const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 40 }) as unknown as NodeJS.WriteStream;
  const scrollRef = createRef<PreviewScroll>();
  const lines = [{ text }];
  let output = '';
  stdout.on('data', (chunk) => { output = String(chunk).replace(/\u001b\[[0-9;]*m/g, ''); });
  let instance: ReturnType<typeof render>;
  await act(async () => {
    instance = render(<PreviewViewport lines={lines} columns={columns} height={height} focused scrollRef={scrollRef} />, {
      stdout, debug: true, patchConsole: false,
    });
  });
  unmount = () => instance.unmount();
  return {
    output: () => output,
    scroll: async (delta: number) => {
      await act(async () => { scrollRef.current!.scroll(delta); });
    },
    resize: async (width: number, rows: number) => {
      await act(async () => {
        instance.rerender(<PreviewViewport lines={lines} columns={width} height={rows} focused scrollRef={scrollRef} />);
      });
    },
  };
}

describe('preview viewport', () => {
  it('uses a divider instead of a focus text bar', async () => {
    const pane = await viewport('Preview body', 30, 5);
    expect(pane.output()).toContain('─'.repeat(26));
    expect(pane.output()).not.toContain('focused');
    expect(pane.output()).not.toContain('Tab');
  });

  it('wraps at words and keeps explicit line breaks and blank lines', async () => {
    const pane = await viewport('First paragraph\n\n- This release adds readable previews', 30, 8);
    const lines = pane.output().split('\n').map((line) => line.trim());
    expect(lines).toContain('First paragraph');
    expect(lines).toContain('');
    expect(lines).toContain('- This release adds');
    expect(lines).toContain('readable previews');
  });

  it('can reach every line, clamps at both ends, and fits the available height', async () => {
    const pane = await viewport(Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join('\n'), 80, 5);
    expect(pane.output()).toContain('1–4/60');
    expect(pane.output()).toContain('Line 1');
    await pane.scroll(100);
    expect(pane.output()).toContain('57–60/60');
    expect(pane.output()).toContain('Line 60');
    await pane.scroll(100);
    expect(pane.output()).toContain('57–60/60');
    await pane.scroll(-100);
    expect(pane.output()).toContain('1–4/60');
    expect(pane.output().trimEnd().split('\n')).toHaveLength(5);
  });

  it('handles long words and wide glyphs and clamps scrolling after a resize', async () => {
    const pane = await viewport(`First\n${'界'.repeat(20)}\n${'x'.repeat(80)}\nLast`, 20, 4);
    await pane.scroll(100);
    expect(pane.output()).toContain('Last');
    await pane.resize(120, 10);
    expect(pane.output()).toContain('First');
    expect(pane.output()).toContain('Last');
  });
});
