import React, { act } from 'react';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openMock = vi.hoisted(() => vi.fn(async (_url: string) => {}));
vi.mock('open', () => ({ default: openMock }));
import { DEFAULT_SETTINGS, retiredSources, sourceInfos } from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import type { DigestResult } from '@fomo/core/digest';
import { App, REGROUP_CONFIRM_MS } from '../src/ui/App.js';
import { createMemoryAuditLog } from '../src/audit.js';
import { DEFAULT_BACKUP_DIR, tildify, type LocalConfig } from '../src/config.js';
import type { GhAccount } from '../src/ghAccounts.js';
import { buildSettingsRows, configDisplay, editStartValue, findRow, firstFocusable, moveFocus, parseConfigEdit, settingsRowText } from '../src/ui/settings.js';

/** The built-in sources the config screen lists with the default settings. */
const SOURCES = sourceInfos(DEFAULT_SETTINGS);

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
      expect.objectContaining({ level: 'info', action: 'regroup', detail: expect.stringContaining('grouped') }),
      expect.objectContaining({ level: 'error', action: 'regroup', detail: 'planning: quota exceeded' }),
    ]));

    await press('a');
    expect(frame()).toContain('Audit trail');
    expect(frame()).toContain('planning: quota exceeded');
    expect(frame()).toContain('update(s)');

    await press('e');
    expect(frame()).toContain('errors only');
    expect(frame()).toContain('planning: quota exceeded');
    expect(frame()).not.toContain('update(s)');

    await press('\u001B');
    expect(frame()).not.toContain('Audit trail');
  });

  it('does not record normal operation such as switching views or moving the preview', async () => {
    const { audit, press } = await renderApp();
    await press('3');
    await press('2');
    await press('.');
    expect(audit.entries).toEqual([]);
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
    const rows = buildSettingsRows(SOURCES);
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

describe('Config → sources', () => {
  const updateSettings = vi.fn(async (patch: object) => ({ ...DEFAULT_SETTINGS, ...patch }));
  const fetch = vi.fn(async () => ({ added: 0, results: {} }));

  beforeEach(() => {
    updateSettings.mockClear();
    fetch.mockClear();
    Object.assign(service, { updateSettings, fetch });
  });
  afterEach(() => {
    delete (service as { updateSettings?: unknown }).updateSettings;
    delete (service as { fetch?: unknown }).fetch;
  });

  async function focusRow(press: (key: string) => Promise<void>, key: string) {
    await press('c');
    const rows = buildSettingsRows(SOURCES);
    const target = findRow(rows, key);
    for (let i = firstFocusable(rows); i < target; i = moveFocus(rows, i, 1)) await press('j');
  }

  it('adds a feed in steps, then fetches it', async () => {
    const { press, frame } = await renderApp();
    await focusRow(press, 'add-source');
    await press('\r');
    expect(frame()).toContain('feed URL(s) or github.com/owner/repo');
    await press('https://www.example.com/feed.xml');
    await press('\r');
    expect(frame()).toContain('Add source · name');
    expect(frame()).toContain('example.com');
    await press('\r');
    expect(frame()).toContain('keywords to keep');
    await press('copilot');
    await press('\r');
    const spec = { kind: 'feed', id: 'example-com', displayName: 'example.com', urls: ['https://www.example.com/feed.xml'], include: 'copilot' };
    expect(updateSettings).toHaveBeenCalledWith({ userSources: [spec] });
    expect(fetch).toHaveBeenCalledWith({ sources: ['example-com'] });
    expect(frame()).toMatch(/● example\.com/);
  });

  it('skips the keyword step for a GitHub repository and rejects a bad URL', async () => {
    const { press, frame } = await renderApp();
    await focusRow(press, 'add-source');
    await press('\r');
    await press('not a url');
    await press('\r');
    expect(frame()).toContain('⚠');
    expect(frame()).toContain('Add source · url');
    for (let i = 0; i < 'not a url'.length; i++) await press('\x7f');
    await press('https://github.com/octo/app');
    await press('\r');
    await press('\r');
    expect(updateSettings).toHaveBeenCalledWith({
      userSources: [{ kind: 'github-releases', id: 'octo-app-releases', displayName: 'octo/app releases', repo: 'octo/app' }],
    });
  });

  it('removes a built-in source on a second x and restores it', async () => {
    const { press, frame } = await renderApp();
    await focusRow(press, 's-github');
    await press('x');
    expect(frame()).toContain('press x again to remove');
    expect(updateSettings).not.toHaveBeenCalled();
    await press('x');
    expect(updateSettings).toHaveBeenCalledWith({ removedSources: ['github'], disabledSources: [] });
    const rows = buildSettingsRows(SOURCES.filter((s) => s.id !== 'github'), undefined, undefined, 1);
    for (let i = findRow(buildSettingsRows(SOURCES), 's-github') - 1; i < findRow(rows, 'restore-sources'); i++) await press('j');
    expect(frame()).toContain('Restore removed');
    expect(frame()).toContain('1 built-in source removed');
    await press('\r');
    expect(updateSettings).toHaveBeenLastCalledWith({ removedSources: [] });
    expect(frame()).not.toContain('Restore removed');
  });

  it('space toggles a source and ↵ opens its details', async () => {
    const { press, frame } = await renderApp();
    await focusRow(press, 's-github');
    await press(' ');
    expect(updateSettings).toHaveBeenCalledWith({ disabledSources: ['github'] });
    await press('\r');
    expect(frame()).toContain('built-in');
    expect(frame()).toContain('Fetches');
    expect(frame()).toContain('s save');
  });

  it('edits the label of a built-in and saves with s', async () => {
    const { press, frame } = await renderApp();
    await focusRow(press, 's-github');
    await press('\r');
    await press('j');
    await press('\r');
    await press('GH');
    await press('\r');
    expect(frame()).toContain('unsaved');
    await press('s');
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ sourceLabels: { github: 'GH' } }));
    expect(frame()).not.toContain('s save');
  });

  it('asks before dropping unsaved changes, and removes on a second x', async () => {
    const { press, frame } = await renderApp();
    await focusRow(press, 's-github');
    await press('\r');
    await press('\r');
    await press('\x1b');
    await new Promise((r) => setTimeout(r, 30));
    expect(frame()).toContain('Esc again to drop them');
    await press('x');
    expect(frame()).toContain('press x again to remove');
    await press('x');
    expect(updateSettings).toHaveBeenCalledWith({ removedSources: ['github'], disabledSources: [] });
    expect(frame()).not.toContain('s save');
  });

  describe('with stored items', () => {
    const deleteSourceUpdates = vi.fn(async () => 5);
    const stats = { total: 5, byStatus: { unread: 5, read: 0 }, bySource: { github: 5 }, savedBySource: { github: 2 }, saved: 2 };
    beforeEach(() => {
      deleteSourceUpdates.mockClear();
      Object.assign(service, { deleteSourceUpdates, getStats: async () => stats });
    });
    afterEach(() => {
      delete (service as { deleteSourceUpdates?: unknown }).deleteSourceUpdates;
      Object.assign(service, { getStats: async () => ({ total: 0, byStatus: { unread: 0, read: 0 }, bySource: {}, saved: 0 }) });
    });

    it('removes a source and deletes its items with x then d', async () => {
      const { press, frame } = await renderApp();
      await focusRow(press, 's-github');
      await press('x');
      expect(frame()).toContain('x again: remove, keep its 5 items · d: delete them too');
      await press('d');
      expect(updateSettings).toHaveBeenCalledWith({ removedSources: ['github'], disabledSources: [] });
      expect(deleteSourceUpdates).toHaveBeenCalledWith('github');
    });

    it('keeps the items of a removed source, shows it greyed out, and deletes them later', async () => {
      const { press, frame } = await renderApp();
      await focusRow(press, 's-github');
      await press('x');
      await press('x');
      expect(updateSettings).toHaveBeenCalledWith({ removedSources: ['github'], disabledSources: [] });
      expect(deleteSourceUpdates).not.toHaveBeenCalled();
      const retired = retiredSources({ ...DEFAULT_SETTINGS, removedSources: ['github'] }, stats.bySource);
      const rows = buildSettingsRows(SOURCES.filter((s) => s.id !== 'github'), undefined, undefined, 1, retired);
      for (let i = findRow(buildSettingsRows(SOURCES), 's-github') - 1; i < findRow(rows, 's-github'); i++) await press('j');
      expect(frame()).toContain('removed · 5 items still stored');
      await press('\r');
      expect(frame()).toContain('r restore');
      await press('d');
      expect(frame()).toContain('press d again to delete its 5 items (2 pending) and remove it for good');
      await press('d');
      expect(deleteSourceUpdates).toHaveBeenCalledWith('github');
    });

    it('deletes the items of an active source from its details with d d', async () => {
      const { press, frame } = await renderApp();
      await focusRow(press, 's-github');
      await press('\r');
      expect(frame()).toContain('d delete its 5 items');
      await press('d');
      expect(frame()).toContain('the next fetch adds them back as new');
      await press('d');
      expect(deleteSourceUpdates).toHaveBeenCalledWith('github');
      expect(updateSettings).not.toHaveBeenCalled();
      expect(frame()).toContain('s save');
    });
  });

  it('edits the URL of an own feed, keeping its id', async () => {
    const own = { kind: 'feed' as const, id: 'example-com', displayName: 'example.com', urls: ['https://example.com/feed.xml'] };
    const settings = { ...DEFAULT_SETTINGS, userSources: [own] };
    Object.assign(service, { getSettings: async () => settings });
    try {
      const { press, frame } = await renderApp();
      await press('c');
      const rows = buildSettingsRows(sourceInfos(settings));
      for (let i = firstFocusable(rows); i < findRow(rows, 's-example-com'); i = moveFocus(rows, i, 1)) await press('j');
      await press('\r');
      expect(frame()).toContain('yours');
      for (let i = 0; i < 4; i++) await press('j');
      await press('\r');
      await press('\x15');
      await press('https://example.com/other.xml');
      await press('\r');
      await press('s');
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ userSources: [{ ...own, urls: ['https://example.com/other.xml'] }] }));
    } finally {
      Object.assign(service, { getSettings: async () => ({ ...DEFAULT_SETTINGS }) });
    }
  });
});

describe('Config → web app', () => {
  const webUrl = 'https://fomo.example.com/';

  async function focusRow(press: (key: string) => Promise<void>, key: string) {
    await press('c');
    const rows = buildSettingsRows(SOURCES);
    const target = findRow(rows, key);
    for (let i = firstFocusable(rows); i < target; i = moveFocus(rows, i, 1)) await press('j');
  }

  beforeEach(() => openMock.mockClear());

  it('shows the web app URL as a QR code and opens it with o', async () => {
    const { press, frame } = await renderApp(undefined, { config: { webUrl } });
    await focusRow(press, 'a-webapp');
    expect(frame()).toContain('o open in browser');

    await press('\r');
    expect(frame()).toContain('📱 Web app');
    expect(frame()).toContain(webUrl);

    await press('o');
    expect(openMock).toHaveBeenCalledWith(webUrl);
    await press('\u001B');
    expect(frame()).not.toContain('📱 Web app');
  });

  it('opens the browser with o on the action and the Web app URL rows', async () => {
    const { press } = await renderApp(undefined, { config: { webUrl } });
    await focusRow(press, 'a-webapp');
    await press('O');
    expect(openMock).toHaveBeenCalledWith(webUrl);
    await press('\u001B');
    await focusRow(press, 'c-webUrl');
    await press('o');
    expect(openMock).toHaveBeenCalledTimes(2);
  });

  it('asks for the Web app URL when it is not set', async () => {
    const { press, frame } = await renderApp();
    await focusRow(press, 'a-webapp');
    await press('\r');
    expect(frame()).toContain('Set “Web app URL” first');
    expect(openMock).not.toHaveBeenCalled();
  });
});

describe('Config → auto-fetch', () => {
  it('takes whole minutes from 5 to 1440, off, or empty for the default', () => {
    expect(parseConfigEdit('autoFetch', '30')).toEqual({ patch: { autoFetch: undefined, autoFetchMinutes: 30 } });
    expect(parseConfigEdit('autoFetch', '5')).toEqual({ patch: { autoFetch: undefined, autoFetchMinutes: 5 } });
    expect(parseConfigEdit('autoFetch', '1440')).toEqual({ patch: { autoFetch: undefined, autoFetchMinutes: 1440 } });
    expect(parseConfigEdit('autoFetch', 'off')).toEqual({ patch: { autoFetch: false } });
    expect(parseConfigEdit('autoFetch', '')).toEqual({ patch: { autoFetch: undefined, autoFetchMinutes: undefined } });
    for (const bad of ['4', '1441', '7.5', 'soon', '-10']) expect(parseConfigEdit('autoFetch', bad)).toHaveProperty('error');
  });

  it('shows the interval or off', () => {
    expect(configDisplay({}, 'autoFetch', {}).value).toBe('every 15 minutes while open (default)');
    expect(configDisplay({ autoFetchMinutes: 60 }, 'autoFetch', {}).value).toBe('every 60 minutes while open');
    expect(configDisplay({ autoFetch: false, autoFetchMinutes: 60 }, 'autoFetch', {}).value).toMatch(/^off/);
  });
});

describe('Config sections', () => {
  it('collapses and expands a section from its header', async () => {
    const { press, frame } = await renderApp();
    await press('c');
    expect(frame()).toContain('Link a device');
    await press('k'); // first row → Actions header
    expect(frame()).toContain('↵/← collapse');
    await press('\r');
    expect(frame()).toContain('▸ Actions (6)');
    expect(frame()).not.toContain('Link a device');
    await press('\u001B[C'); // →
    expect(frame()).toContain('▾ Actions');
    expect(frame()).toContain('Link a device');
  });

  it('← on a row folds its section and focuses the header', async () => {
    const { press, frame } = await renderApp();
    await press('c');
    await press('j');
    await press('\u001B[D'); // ←
    expect(frame()).toContain('▸ Actions (6)');
    expect(frame()).toContain('↵/→ expand');
  });

  it('expands a folded section to focus a row in it', async () => {
    const { press, frame } = await renderApp();
    await press('c');
    const rows = buildSettingsRows(SOURCES);
    for (let i = firstFocusable(rows); i < findRow(rows, 'h-local'); i = moveFocus(rows, i, 1)) await press('j');
    await press('\r');
    expect(frame()).toContain('▸ This computer');
    const folded = buildSettingsRows(SOURCES, new Set(['h-local']));
    for (let i = findRow(folded, 'h-local'); i > findRow(folded, 'a-webapp'); i--) await press('k');
    await press('\r');
    expect(frame()).toContain('Set “Web app URL” first');
    expect(frame()).toContain('▾ This computer');
    expect(frame()).toMatch(/Web app URL\s+\(not set/);
  });
});

describe('/ search', () => {
  it('filters the config rows per section and Esc clears it', async () => {
    const { press, frame } = await renderApp();
    await press('c');
    await press('/');
    for (const ch of 'backup') await press(ch);
    expect(frame()).toContain('Back up updates');
    expect(frame()).toContain('Backup folder');
    expect(frame()).not.toContain('Link a device');
    expect(frame()).not.toContain('Copilot model');
    await press('q'); // typed, does not quit
    expect(frame()).toContain('no matches');
    await press('\u007F'); // ⌫
    await press('\r');
    expect(frame()).toContain('/ backup');
    await press('\u001B');
    expect(frame()).toContain('Link a device');
    expect(frame()).toContain('⚙️  Config');
  });

  it('keeps the whole section when its header matches', async () => {
    const { press, frame } = await renderApp();
    await press('c');
    await press('/');
    for (const ch of 'actions') await press(ch);
    expect(frame()).toContain('Link a device');
    expect(frame()).toContain('Restore from backup');
    expect(frame()).not.toContain('Copilot model');
  });

  it('filters the help keys', async () => {
    const { press, frame } = await renderApp();
    await press('c');
    await press('h');
    expect(frame()).toContain('Cycle source color');
    await press('/');
    for (const ch of 'color') await press(ch);
    expect(frame()).toContain('Cycle source color');
    expect(frame()).not.toContain('Fetch this source now');
    await press('\u001B'); // clears the search
    await press('\u001B'); // closes help
    expect(frame()).toContain('⚙️  Config');
  });
});

describe('settings rows', () => {
  it('filters rows and drops sections without matches', () => {
    const rows = buildSettingsRows([], new Set(['h-actions']), (r) => r.kind === 'config' && r.field === 'webUrl');
    expect(rows.map((r) => r.key)).toEqual(['h-local', 'c-webUrl']);
    expect(rows[0]).toMatchObject({ collapsed: false, count: 1 });
  });

  it('leaves out the rows of collapsed sections', () => {
    const rows = buildSettingsRows([], new Set(['h-local', 'h-actions']));
    expect(rows.map((r) => r.key)).toEqual(['h-actions', 'h-sources', 'add-source', 'h-display', 'preview', 'h-local']);
    expect(rows[0]).toMatchObject({ collapsed: true, count: 6 });
    expect(moveFocus(rows, 5, 10)).toBe(5);
    expect(moveFocus(rows, 1, -10)).toBe(0);
  });

  it('names the profile in the title of the local section only when told to', () => {
    const title = (profile?: string) => {
      const header = buildSettingsRows([], new Set(), undefined, 0, [], profile).find((r) => r.key === 'h-local');
      return header?.kind === 'header' ? header.label : undefined;
    };
    expect(title()).toMatch(/^This computer · .*config\.json$/);
    expect(title('work')).toMatch(/^This computer · profile work · .*config\.json$/);
  });

  it('offers the profile list as an action', () => {
    const row = buildSettingsRows([]).find((r) => r.key === 'a-profiles');
    expect(row).toMatchObject({ kind: 'action', action: 'profiles', label: 'Switch profile' });
  });
});

describe('config values per profile', () => {
  it('defaults the backup folder to one named after the profile, except for the default profile', () => {
    expect(configDisplay({}, 'backupDir', {}).value).toBe(`${tildify(DEFAULT_BACKUP_DIR)} (default)`);
    expect(configDisplay({}, 'backupDir', {}, 'work').value).toBe(`${tildify(join(DEFAULT_BACKUP_DIR, 'work'))} (default)`);
    expect(configDisplay({ backupDir: '/b' }, 'backupDir', { backupDir: '/b' }, 'work').value).toBe('/b');
  });

  it('starts an edit from the profile’s own stored value', () => {
    expect(editStartValue('interests', { interests: 'ai' })).toBe('ai');
    expect(editStartValue('interests', {})).toBe('');
    expect(editStartValue('connectionString', { connectionString: 'AccountKey=secret' })).toBe('');
    expect(editStartValue('autoFetch', { autoFetch: false })).toBe('off');
    expect(editStartValue('autoFetch', { autoFetchMinutes: 30 })).toBe('30');
  });

  it('searches the values of the profile in use', () => {
    const row = buildSettingsRows([]).find((r) => r.key === 'c-interests')!;
    expect(settingsRowText(row, { interests: 'rust' }, { interests: 'rust' }, 'work')).toContain('rust');
  });
});
