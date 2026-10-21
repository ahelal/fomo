import React, { act } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutoFetch } from '../src/ui/hooks/useAutoFetch.js';

function Harness({ fetch }: { fetch: () => void }) {
  useAutoFetch(fetch, 15);
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

  it('does nothing while disabled and restarts the timer when re-enabled', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    const seen: (number | undefined)[] = [];
    function Probe({ enabled }: { enabled: boolean }) {
      seen.push(useAutoFetch(fetch, enabled ? 15 : undefined));
      return null;
    }
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const stderr = new PassThrough();
    let instance!: ReturnType<typeof render>;
    await act(async () => {
      instance = render(<Probe enabled={false} />, { stdout, stdin, stderr, debug: true, exitOnCtrlC: false, patchConsole: false });
    });
    try {
      await act(async () => { vi.advanceTimersByTime(3 * 900_000); });
      expect(fetch).not.toHaveBeenCalled();
      expect(seen.at(-1)).toBeUndefined();

      await act(async () => { instance.rerender(<Probe enabled />); });
      expect(seen.at(-1)).toBe(Date.now() + 900_000);
      await act(async () => { vi.advanceTimersByTime(900_000); });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(seen.at(-1)).toBe(Date.now() + 900_000);

      await act(async () => { instance.rerender(<Probe enabled={false} />); });
      await act(async () => { vi.advanceTimersByTime(3 * 900_000); });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(seen.at(-1)).toBeUndefined();
    } finally {
      instance.unmount();
      instance.cleanup();
      stdout.destroy();
      stdin.destroy();
      stderr.destroy();
    }
  });

  it('uses the configured number of minutes', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    function Probe({ minutes }: { minutes: number }) {
      useAutoFetch(fetch, minutes);
      return null;
    }
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const stderr = new PassThrough();
    let instance!: ReturnType<typeof render>;
    await act(async () => {
      instance = render(<Probe minutes={5} />, { stdout, stdin, stderr, debug: true, exitOnCtrlC: false, patchConsole: false });
    });
    try {
      await act(async () => { vi.advanceTimersByTime(300_000); });
      expect(fetch).toHaveBeenCalledTimes(1);
      await act(async () => { instance.rerender(<Probe minutes={60} />); });
      await act(async () => { vi.advanceTimersByTime(3_599_999); });
      expect(fetch).toHaveBeenCalledTimes(1);
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      instance.unmount();
      instance.cleanup();
      stdout.destroy();
      stdin.destroy();
      stderr.destroy();
    }
  });
});
