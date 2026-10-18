import React, { act } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import type { DigestResult } from '@fomo/core/digest';
import { App, REGROUP_CONFIRM_MS } from '../src/ui/App.js';

type FakeStdin = PassThrough & { isTTY: boolean; setRawMode(on: boolean): void; ref(): void; unref(): void };

const service = {
  getSettings: async () => ({ ...DEFAULT_SETTINGS }),
  getSources: async () => [],
  getDigest: async () => ({ entries: [], pending: 0 }),
  listUpdates: async () => ({ updates: [], total: 0 }),
  getStats: async () => ({ total: 0, byStatus: { unread: 0, read: 0 }, bySource: {}, saved: 0 }),
} as unknown as FomoDirectService;

const result: DigestResult = { processed: 0, remaining: 0, created: 0, updated: 0, errors: [] };

let columns: PropertyDescriptor | undefined;
let unmount: (() => void) | undefined;

beforeEach(() => {
  // Wide enough for the whole status bar message.
  columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  Object.defineProperty(process.stdout, 'columns', { value: 200, configurable: true });
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  if (columns) Object.defineProperty(process.stdout, 'columns', columns);
  else delete (process.stdout as { columns?: number }).columns;
  vi.useRealTimers();
});

async function renderApp() {
  const digest = vi.fn(async () => result);
  const stdin = new PassThrough() as FakeStdin;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = new PassThrough();
  let frame = '';
  stdout.on('data', (chunk: Buffer) => { frame = chunk.toString(); });
  await act(async () => {
    const instance = render(<App service={service} config={{}} onConfigChange={() => undefined} digest={digest} />, {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stderr: new PassThrough() as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    unmount = () => instance.unmount();
  });
  const press = async (key: string) => {
    await act(async () => {
      stdin.write(key);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  };
  return { digest, press, frame: () => frame };
}

describe('z regroup shortcut', () => {
  it('asks first, then regroups all topics on the second z', async () => {
    const { digest, press, frame } = await renderApp();
    await press('z');
    expect(digest).not.toHaveBeenCalled();
    expect(frame()).toContain('z again to regroup all topics');
    await press('z');
    expect(digest).toHaveBeenCalledTimes(1);
    expect(digest).toHaveBeenCalledWith(expect.any(Function), { reset: true });
  });

  it('cancels when another key or Esc comes in between', async () => {
    const { digest, press, frame } = await renderApp();
    await press('z');
    await press('k');
    expect(frame()).not.toContain('z again');
    await press('z');
    await press('\u001B');
    await press('z');
    expect(digest).not.toHaveBeenCalled();
    await press('z');
    expect(digest).toHaveBeenCalledTimes(1);
  });

  it('expires if the second z comes too late', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { digest, press } = await renderApp();
    await press('z');
    vi.setSystemTime(Date.now() + REGROUP_CONFIRM_MS);
    await press('z');
    expect(digest).not.toHaveBeenCalled();
    await press('z');
    expect(digest).toHaveBeenCalledTimes(1);
  });
});

describe('navigation', () => {
  it('j / ↓ on an empty view keeps the app running', async () => {
    const { press, frame } = await renderApp();
    await press('j');
    await press('\u001B[B');
    expect(frame()).toContain('FOMO');
    expect(frame()).not.toMatch(/ERROR|TypeError/);
  });
});
