import React, { act } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import type { DigestResult } from '@fomo/core/digest';
import { App, REGROUP_CONFIRM_MS } from '../src/ui/App.js';
import { createMemoryAuditLog } from '../src/audit.js';
import type { LocalConfig } from '../src/config.js';
import type { GhAccount } from '../src/ghAccounts.js';
import { buildSettingsRows, findRow, firstFocusable, moveFocus } from '../src/ui/settings.js';

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
  vi.unstubAllEnvs();
});

interface RenderOptions {
  config?: LocalConfig;
  listAccounts?: () => Promise<GhAccount[]>;
}

async function renderApp(digestRun: () => Promise<DigestResult> = async () => result, options: RenderOptions = {}) {
  const digest = vi.fn(digestRun);
  const onConfigChange = vi.fn((_patch: Partial<LocalConfig>): string | undefined => undefined);
  const audit = createMemoryAuditLog();
  const stdin = new PassThrough() as FakeStdin;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = new PassThrough();
  let frame = '';
  stdout.on('data', (chunk: Buffer) => { frame = chunk.toString(); });
  await act(async () => {
    const instance = render(
      <App
        service={service}
        config={options.config ?? {}}
        onConfigChange={onConfigChange}
        digest={digest}
        audit={audit}
        auditFile="/tmp/audit.log"
        listAccounts={options.listAccounts}
      />,
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: new PassThrough() as unknown as NodeJS.WriteStream,
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
    unmount = () => instance.unmount();
  });
  const press = async (key: string) => {
    await act(async () => {
      stdin.write(key);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  };
  return { digest, onConfigChange, audit, press, frame: () => frame };
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

  it('shows the first digest error when regrouping fails', async () => {
    const failure: DigestResult = { ...result, remaining: 66, errors: ['planning: quota exceeded'] };
    const { digest, press, frame } = await renderApp(async () => failure);

    await press('z');
    await press('z');

    expect(digest).toHaveBeenCalledTimes(1);
    expect(frame()).toContain('planning: quota exceeded');
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

describe('a audit trail', () => {
  it('records regroup errors and shows them, with e for errors only', async () => {
    const failure: DigestResult = { ...result, remaining: 66, errors: ['planning: quota exceeded'] };
    const { audit, press, frame } = await renderApp(async () => failure);

    await press('3');
    await press('z');
    await press('z');
    expect(audit.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'info', action: 'view', detail: 'read' }),
      expect.objectContaining({ level: 'info', action: 'regroup' }),
      expect.objectContaining({ level: 'error', action: 'regroup', detail: 'planning: quota exceeded' }),
    ]));

    await press('a');
    expect(frame()).toContain('Audit trail');
    expect(frame()).toContain('planning: quota exceeded');
    expect(frame()).toContain('view');

    await press('e');
    expect(frame()).toContain('errors only');
    expect(frame()).toContain('planning: quota exceeded');
    expect(frame()).not.toMatch(/·\s+view\b/);

    await press('\u001B');
    expect(frame()).not.toContain('Audit trail');
  });

  it('shows new entries while it is open', async () => {
    const { audit, press, frame } = await renderApp();
    await press('a');
    expect(frame()).toContain('Nothing recorded yet');
    await act(async () => { audit.error('fetch', 'GitHub: 401'); });
    expect(frame()).toContain('GitHub: 401');
  });
});

describe('Config → Copilot account', () => {
  const accounts: GhAccount[] = [{ login: 'work-emu', active: true }, { login: 'personal', active: false }];

  beforeEach(() => {
    for (const name of ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) vi.stubEnv(name, '');
  });

  /** Open the config screen (c) and move to the Copilot account row. */
  async function focusAccountRow(press: (key: string) => Promise<void>) {
    await press('c');
    const rows = buildSettingsRows([]);
    const target = findRow(rows, 'c-copilotAccount');
    for (let i = firstFocusable(rows); i < target; i = moveFocus(rows, i, 1)) await press('j');
  }

  it('lists the gh accounts and saves the chosen one', async () => {
    const listAccounts = vi.fn(async () => accounts);
    const { onConfigChange, audit, press, frame } = await renderApp(undefined, { listAccounts });

    await focusAccountRow(press);
    expect(frame()).toContain('automatic — gh’s active account');
    expect(frame()).toContain('↵ choose');

    await press('\r');
    expect(listAccounts).toHaveBeenCalledTimes(1);
    expect(frame()).toContain('👤 Copilot account');
    expect(frame()).toMatch(/work-emu\s+gh’s active account/);
    expect(frame()).toContain('personal');

    await press('j');
    await press('j');
    await press('\r');
    expect(onConfigChange).toHaveBeenCalledWith({ copilotAccount: 'personal' });
    expect(audit.entries).toContainEqual(expect.objectContaining({ level: 'info', action: 'config', detail: 'copilotAccount = personal' }));
    expect(frame()).toContain('✓ Copilot account: personal');
    expect(frame()).not.toContain('👤 Copilot account');
  });

  it('still offers Automatic when gh can’t list the accounts', async () => {
    const listAccounts = vi.fn(async (): Promise<GhAccount[]> => { throw new Error('GitHub CLI (gh) not found — install it and run gh auth login'); });
    const { onConfigChange, audit, press, frame } = await renderApp(undefined, { listAccounts, config: { copilotAccount: 'personal' } });

    await focusAccountRow(press);
    expect(frame()).toMatch(/Copilot account\s+personal/);
    await press('\r');
    expect(frame()).toContain('Couldn’t list gh accounts: GitHub CLI (gh) not found');
    expect(frame()).toMatch(/personal\s+not signed in to gh/);
    expect(audit.entries).toContainEqual(expect.objectContaining({ level: 'error', action: 'config', detail: expect.stringContaining('list gh accounts') }));

    await press('k');
    await press('\r');
    expect(onConfigChange).toHaveBeenCalledWith({ copilotAccount: undefined });
    expect(audit.entries).toContainEqual(expect.objectContaining({ level: 'info', action: 'config', detail: 'copilotAccount = (default)' }));
    expect(frame()).toContain('✓ Copilot account: automatic (gh’s active account)');
  });

  it('closes without saving on Esc or when the saved account is picked again', async () => {
    const { onConfigChange, press, frame } = await renderApp(undefined, { listAccounts: async () => accounts, config: { copilotAccount: 'work-emu' } });

    await focusAccountRow(press);
    await press('\r');
    expect(frame()).toContain('👤 Copilot account');
    await press('\u001B');
    expect(frame()).not.toContain('👤 Copilot account');
    expect(frame()).toContain('Config');

    await press('\r');
    await press('\r');
    expect(frame()).not.toContain('👤 Copilot account');
    expect(onConfigChange).not.toHaveBeenCalled();
  });
});
