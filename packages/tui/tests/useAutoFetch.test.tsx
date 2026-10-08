import React, { act } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_FETCH_INTERVAL_MS, useAutoFetch } from '../src/ui/hooks/useAutoFetch.js';

function Harness({ fetch }: { fetch: () => void }) {
  useAutoFetch(fetch);
  return null;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('automatic fetch timer', () => {
  it('fetches every 15 minutes, uses the latest callback and stops on unmount', async () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const latest = vi.fn();
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const stderr = new PassThrough();
    let instance!: ReturnType<typeof render>;
    await act(async () => {
      instance = render(<Harness fetch={first} />, {
        stdout,
        stdin,
        stderr,
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
      });
    });
    try {
      expect(AUTO_FETCH_INTERVAL_MS).toBe(900_000);
      expect(first).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(899_999); });
      expect(first).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(first).toHaveBeenCalledTimes(1);

      await act(async () => { vi.advanceTimersByTime(60_000); });
      await act(async () => { instance.rerender(<Harness fetch={latest} />); });
      await act(async () => { vi.advanceTimersByTime(840_000); });
      expect(first).toHaveBeenCalledTimes(1);
      expect(latest).toHaveBeenCalledTimes(1);
      await act(async () => { vi.advanceTimersByTime(900_000); });
      expect(latest).toHaveBeenCalledTimes(2);

      await act(async () => { instance.unmount(); });
      await act(async () => { vi.advanceTimersByTime(1_800_000); });
      expect(latest).toHaveBeenCalledTimes(2);
    } finally {
      instance.unmount();
      instance.cleanup();
      stdout.destroy();
      stdin.destroy();
      stderr.destroy();
    }
  });
});
