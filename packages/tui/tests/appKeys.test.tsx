import React, { act } from 'react';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openMock = vi.hoisted(() => vi.fn(async (_url: string) => {}));
vi.mock('open', () => ({ default: openMock }));
import { COLOR_PALETTE, DEFAULT_COLOR, DEFAULT_SETTINGS, moveInGrid, paletteIndex, retiredSources, sourceInfos } from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import type { DigestInspection, DigestResult } from '@fomo/core/digest';
import { App, REGROUP_CONFIRM_MS, type DigestRunOptions } from '../src/ui/App.js';
import { createMemoryAuditLog } from '../src/audit.js';
import { DEFAULT_BACKUP_DIR, tildify, type LocalConfig } from '../src/config.js';
import type { GhAccount } from '../src/ghAccounts.js';
import type { ExperimentalSetups } from '../src/experimental/index.js';
import type { GroupingHistory } from '../src/groupingHistory.js';
import { DEFAULT_SOURCE_COLOR } from '../src/ui/components/UpdatesTable.js';
import { fixedColumn } from '../src/ui/components/SettingsPane.js';
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
  /** Keep the config in state, so a change shows like it does in Root (the mock alone leaves it as it was). */
  liveConfig?: boolean;
  listAccounts?: () => Promise<GhAccount[]>;
  experimental?: ExperimentalSetups;
  service?: FomoDirectService;
  refineGrouping?: (current: string, feedback: string, inspection?: DigestInspection) => Promise<string>;
  groupingHistory?: GroupingHistory;
}

type AppProps = React.ComponentProps<typeof App>;

function LiveConfigApp({ config: initial, onConfigChange, ...props }: AppProps) {
  const [config, setConfig] = React.useState(initial);
  const change = (patch: Partial<LocalConfig>) => {
    const err = onConfigChange(patch);
    if (!err) setConfig((c) => ({ ...c, ...patch }));
    return err;
  };
  return <App {...props} config={config} onConfigChange={change} />;
}

async function renderApp(digestRun: (progress: (message: string) => void, options?: DigestRunOptions) => Promise<DigestResult> = async () => result, options: RenderOptions = {}) {
  const digest = vi.fn(digestRun);
  const onConfigChange = vi.fn((_patch: Partial<LocalConfig>): string | undefined => undefined);
  const audit = createMemoryAuditLog();
  const stdin = new PassThrough() as FakeStdin;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = new PassThrough();
  let frame = '';
  stdout.on('data', (chunk: Buffer) => { frame = chunk.toString(); });
  const props: AppProps = {
    service: options.service ?? service,
    config: options.config ?? {},
    onConfigChange,
    digest,
    refineGrouping: options.refineGrouping,
    groupingHistory: options.groupingHistory,
    audit,
    auditFile: '/tmp/audit.log',
    listAccounts: options.listAccounts,
    experimental: options.experimental,
  };
  await act(async () => {
    const instance = render(
      options.liveConfig ? <LiveConfigApp {...props} /> : <App {...props} />,
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
  it.each([['2', false], ['2', true], ['4', false], ['4', true]])('opens the inspector directly without regrouping in view %s (list=%s)', async (view, list) => {
    const { digest, press, frame } = await renderApp();
    await press('1');
    await press(view);
    if (list) await press(view);
    await press('I');
    expect(frame()).toContain('Behind the grouping');
    expect(frame()).toContain('No grouping run recorded');
    expect(digest).not.toHaveBeenCalled();
    await press('\u001B');
    await press('i');
    expect(frame()).toContain('Behind the grouping');
    expect(digest).not.toHaveBeenCalled();
    await press('r');
    expect(digest).toHaveBeenCalledTimes(1);
  });

  it('asks first, then regroups all topics on the second z', async () => {
    const { digest, press, frame } = await renderApp();
    await press('z');
    expect(digest).not.toHaveBeenCalled();
    expect(frame()).toContain('z again to regroup all topics');
    await press('z');
    expect(digest).toHaveBeenCalledTimes(1);
    expect(digest).toHaveBeenCalledWith(expect.any(Function), { reset: true, onInspection: expect.any(Function) });
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

  it.each([['2', false], ['2', true], ['4', false], ['4', true]])('opens the inspector on a third z in view %s (list=%s)', async (view, list) => {
    const { digest, press, frame } = await renderApp();
    await press('1');
    await press(view);
    if (list) await press(view);
    await press('z');
    await press('z');
    await press('z');
    expect(digest).toHaveBeenCalledTimes(1);
    expect(frame()).toContain('Behind the grouping');
    await press('r');
    expect(digest).toHaveBeenCalledTimes(2);
    await press('\u001B');
    expect(frame()).not.toContain('Behind the grouping');
  });

  it('accepts rapid zzz delivered as a single terminal input chunk', async () => {
    const { digest, press, frame } = await renderApp();
    await press('ZZZ');
    expect(digest).toHaveBeenCalledTimes(1);
    expect(frame()).toContain('Behind the grouping');
  });

  it('opens the latest saved run by default and browses older runs without regrouping', async () => {
    const snapshot = (guidance: string): DigestInspection => ({ startedAt: '2026-10-23T12:00:00Z', guidance, items: [], calls: [] });
    const groupingHistory: GroupingHistory = {
      list: () => ['new', 'old'],
      read: (id) => snapshot(id === 'new' ? 'Latest saved guidance' : 'Previous saved guidance'),
      save: vi.fn(() => 'new'),
    };
    const { press, frame, digest } = await renderApp(undefined, { groupingHistory });
    await press('i');
    expect(frame()).toContain('Latest saved guidance');
    expect(frame()).toContain('Run 1/2');
    await press('[');
    expect(frame()).toContain('Previous saved guidance');
    expect(frame()).toContain('Run 2/2');
    await press('\u001B'); await press('i');
    expect(frame()).toContain('Latest saved guidance');
    await press('['); await press(']');
    expect(frame()).toContain('Latest saved guidance');
    expect(digest).not.toHaveBeenCalled();
  });

  it('saves live snapshots and reports disk failures without breaking grouping', async () => {
    const groupingHistory: GroupingHistory = {
      list: () => [], read: () => { throw new Error('missing'); },
      save: vi.fn(() => { throw new Error('disk full'); }),
    };
    const { press, frame, audit } = await renderApp(async (_progress, options) => {
      options?.onInspection?.({ startedAt: '2026-10-23T12:00:00Z', guidance: 'Live guidance', items: [], calls: [] });
      return result;
    }, { groupingHistory });
    await press('zz');
    expect(groupingHistory.save).toHaveBeenCalledTimes(1);
    expect(audit.recent()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'grouping-history', level: 'error', detail: 'disk full' }),
    ]));
    await press('z');
    expect(frame()).toContain('Live guidance');
  });

  it('shows live evidence on the third z without starting a second run', async () => {
    let finish!: (value: DigestResult) => void;
    const { digest, press, frame } = await renderApp(async (_progress, options) => {
      options?.onInspection?.({
        startedAt: 'now', guidance: 'Keep CLI separate', items: [{ id: 'one', title: 'CLI extensions' }],
        calls: [{ label: 'Planning', system: 'system rules', prompt: 'LEXICAL SIMILARITY: cli extensions', state: 'running' }],
      });
      return new Promise((resolve) => { finish = resolve; });
    });
    await press('z'); await press('z'); await press('z');
    expect(digest).toHaveBeenCalledTimes(1);
    expect(frame()).toContain('Planning: running');
    await press('i');
    expect(frame()).toContain('system rules');
    expect(frame()).toContain('LEXICAL SIMILARITY');
    await press('r');
    expect(digest).toHaveBeenCalledTimes(1);
    await act(async () => { finish(result); });
  });

  it('requires review before saving suggested guidance and does not rerun automatically', async () => {
    const refineGrouping = vi.fn(async () => 'Keep CLI and editor releases separate');
    const { digest, press, frame, onConfigChange } = await renderApp(undefined, { refineGrouping });
    await press('z'); await press('z'); await press('z');
    await press('f');
    await press('Separate CLI from editors');
    await press('\u0013');
    expect(refineGrouping).toHaveBeenCalledWith('', 'Separate CLI from editors', undefined);
    expect(onConfigChange).not.toHaveBeenCalled();
    expect(frame()).toContain('Review/edit guidance');
    await press('\u0013');
    expect(onConfigChange).toHaveBeenCalledWith({ groupingHints: 'Keep CLI and editor releases separate' });
    expect(digest).toHaveBeenCalledTimes(1);
  });

  it('preserves feedback and surfaces a failed suggestion without saving', async () => {
    const refineGrouping = vi.fn(async () => { throw new Error('quota exceeded'); });
    const { press, frame, onConfigChange } = await renderApp(undefined, { refineGrouping });
    await press('zzz'); await press('f'); await press('Separate products'); await press('\u0013');
    expect(frame()).toContain('quota exceeded');
    expect(frame()).toContain('Separate products');
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it('does not silently save guidance overridden by the environment', async () => {
    vi.stubEnv('FOMO_GROUPING_HINTS', 'environment guidance');
    const { press, frame, onConfigChange } = await renderApp();
    await press('zzz'); await press('e'); await press('my guidance'); await press('\u0013');
    expect(frame()).toContain('Remove FOMO_GROUPING_HINTS');
    expect(onConfigChange).not.toHaveBeenCalled();
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

  it('Tab focuses the preview, arrows scroll it, and Shift+Tab returns to the list', async () => {
    const updates = ['First release', 'Second release'].map((title, i) => ({
      id: `app__${i}`, source: 'app', title, url: `https://example.com/${i}`,
      datePublished: '2026-10-27', dateAdded: '2026-10-27',
      status: 'unread' as const, saved: false,
      content: Array.from({ length: 60 }, (_, n) => `- Release note ${n + 1}`).join('\n'),
    }));
    const listUpdates = vi.fn(async () => ({ updates, total: updates.length }));
    const { press, frame } = await renderApp(undefined, {
      service: { ...service, listUpdates, getDuplicates: async () => [] } as unknown as FomoDirectService,
    });
    await press('1');
    await press('\r');
    expect(frame()).not.toContain('List focused');
    expect(frame()).toContain('- Release note 1');
    await press('\t');
    expect(frame()).not.toContain('Preview focused');
    const calls = listUpdates.mock.calls.length;
    await press('\u001b[B');
    expect(frame()).toContain('- Release note 2');
    expect(frame()).not.toContain('- Release note 1\n');
    expect(listUpdates).toHaveBeenCalledTimes(calls);
    expect(frame().split('\n').find((line) => line.includes('▎'))).toContain('First release');
    await press('\u001b[A');
    expect(frame()).toContain('- Release note 1');
    await press('\u001b[Z');
    expect(frame()).not.toContain('List focused');
    await press('\u001b[B');
    expect(frame().split('\n').find((line) => line.includes('▎'))).toContain('Second release');
    expect(frame()).toContain('- Release note 1');
  });

  it('scrolls topic previews and resets scrolling on close and selection changes', async () => {
    const item = (id: string) => ({
      id, source: 'app', title: `Release ${id}`, url: `https://example.com/${id}`,
      datePublished: '2026-10-27', dateAdded: '2026-10-27',
      status: 'unread' as const, saved: false, content: '',
    });
    const entries = [{
      topic: {
        id: 'topic', title: 'App releases', summary: 'Topic overview',
        highlights: Array.from({ length: 60 }, (_, n) => `Topic point ${n + 1}`),
        createdAt: '2026-10-27', updatedAt: '2026-10-27',
      },
      items: [item('app__1'), item('app__2')], latestDate: '2026-10-27', sources: ['app'], synthetic: false,
    }];
    const { press, frame } = await renderApp(undefined, {
      service: { ...service, getDigest: async () => ({ entries, pending: 0 }) } as unknown as FomoDirectService,
    });
    await press('.');
    await press('\t');
    expect(frame()).not.toContain('Preview focused');
    await press('\u001b[6~');
    expect(frame()).not.toContain('Topic overview');
    await press('\u001b');
    await press('.');
    expect(frame()).not.toContain('List focused');
    expect(frame()).toContain('Topic overview');
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

  it('masks the YouTube API key while it is typed and in the audit log', async () => {
    const key = 'fake-youtube-key-0123456789-abcdefghi-rstu';
    const { onConfigChange, audit, press, frame } = await renderApp();
    await press('c');
    const rows = buildSettingsRows(SOURCES);
    const target = findRow(rows, 'c-youtubeApiKey');
    for (let i = firstFocusable(rows); i < target; i = moveFocus(rows, i, 1)) await press('j');
    expect(frame()).toContain('public feeds, no video lengths');

    await press('\r');
    await press(key);
    expect(frame()).toContain('••••rstu');
    expect(frame()).not.toContain(key.slice(0, 12));

    await press('\r');
    expect(onConfigChange).toHaveBeenCalledWith({ youtubeApiKey: key });
    expect(audit.entries).toContainEqual(expect.objectContaining({ action: 'config', detail: 'youtubeApiKey = ••••rstu' }));
    expect(JSON.stringify(audit.entries)).not.toContain(key.slice(0, 12));
  });

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

  it('shows source types and fetch metrics in separate columns', async () => {
    const { press, frame } = await renderApp();
    await press('c');
    expect(frame()).toContain('Type');
    expect(frame()).toContain('RSS/Atom');
    expect(frame()).toContain('Items');
    expect(frame()).toContain('Last new');
    expect(frame()).toContain('Fetched');
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
    expect(frame()).toContain('changelog file path');
    await press('CHANGELOG.md');
    await press('\r');
    expect(updateSettings).toHaveBeenCalledWith({
      userSources: [{ kind: 'github-releases', id: 'octo-app-releases', displayName: 'octo/app releases', repo: 'octo/app', changelogPath: 'CHANGELOG.md' }],
    });
  });

  it('removes a built-in source on a second x and restores it', async () => {
    const { press, frame } = await renderApp();
    await focusRow(press, 's-fomo-releases');
    await press('x');
    expect(frame()).toContain('press x again to remove');
    expect(updateSettings).not.toHaveBeenCalled();
    await press('x');
    expect(updateSettings).toHaveBeenCalledWith({ removedSources: ['fomo-releases'], disabledSources: [] });
    const rows = buildSettingsRows(SOURCES.filter((s) => s.id !== 'fomo-releases'), undefined, undefined, 1);
    for (let i = findRow(buildSettingsRows(SOURCES), 's-fomo-releases') - 1; i < findRow(rows, 'restore-sources'); i++) await press('j');
    expect(frame()).toContain('Restore removed');
    expect(frame()).toContain('1 built-in source removed');
    await press('\r');
    expect(updateSettings).toHaveBeenLastCalledWith({ removedSources: [] });
    expect(frame()).not.toContain('Restore removed');
  });

  it('picks a source color in the popup with d, and d in the popup goes back to the default', async () => {
    const start = DEFAULT_SOURCE_COLOR['fomo-releases'] ?? DEFAULT_COLOR;
    const next = COLOR_PALETTE[moveInGrid(paletteIndex(start), 'right')]!;
    const { press, frame } = await renderApp();
    await focusRow(press, 's-fomo-releases');
    await press('d');
    expect(frame()).toContain('Pick a color · ');
    await press('q'); // the picker keeps every key, so q doesn't quit
    await press('\u001B[C');
    await press('\r');
    expect(updateSettings).toHaveBeenCalledWith({ sourceColors: { 'fomo-releases': next } });
    expect(frame()).not.toContain('Pick a color');
    await press('d');
    expect(frame()).toContain('Was     ■ ');
    await press('d');
    expect(updateSettings).toHaveBeenLastCalledWith({ sourceColors: {} });
  });

  it('Esc closes only the color picker', async () => {
    const { press, frame } = await renderApp();
    await focusRow(press, 's-fomo-releases');
    await press('d');
    await press('\u001B[C');
    await press('\u001B');
    await new Promise((r) => setTimeout(r, 30));
    expect(frame()).not.toContain('Pick a color');
    expect(frame()).toContain('d color'); // still on the config screen
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('picks the color in the source details and saves it with s', async () => {
    const start = DEFAULT_SOURCE_COLOR['fomo-releases'] ?? DEFAULT_COLOR;
    const next = COLOR_PALETTE[moveInGrid(paletteIndex(start), 'right')]!;
    const { press, frame } = await renderApp();
    await focusRow(press, 's-fomo-releases');
    await press('\r');
    await press('j');
    await press('j');
    expect(frame()).toContain('pick color');
    await press('\r');
    expect(frame()).toContain('Pick a color · ');
    await press('\u001B[C');
    await press('\r');
    expect(frame()).toContain('unsaved');
    await press('s');
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ sourceColors: { 'fomo-releases': next } }));
  });

  it('space toggles a source and ↵ opens its details', async () => {
    const { press, frame } = await renderApp();
    await focusRow(press, 's-fomo-releases');
    await press(' ');
    expect(updateSettings).toHaveBeenCalledWith({ disabledSources: ['fomo-releases'] });
    await press('\r');
    expect(frame()).toContain('built-in');
    expect(frame()).toContain('Fetches');
    expect(frame()).toContain('s save');
  });

  it('edits the label of a built-in and saves with s', async () => {
    const { press, frame } = await renderApp();
    await focusRow(press, 's-fomo-releases');
    await press('\r');
    await press('j');
    await press('\r');
    await press('GH');
    await press('\r');
    expect(frame()).toContain('unsaved');
    await press('s');
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ sourceLabels: { 'fomo-releases': 'GH' } }));
    expect(frame()).not.toContain('s save');
  });

  it('asks before dropping unsaved changes, and removes on a second x', async () => {
    const { press, frame } = await renderApp();
    await focusRow(press, 's-fomo-releases');
    await press('\r');
    await press('\r');
    await press('\x1b');
    await new Promise((r) => setTimeout(r, 30));
    expect(frame()).toContain('Esc again to drop them');
    await press('x');
    expect(frame()).toContain('press x again to remove');
    await press('x');
    expect(updateSettings).toHaveBeenCalledWith({ removedSources: ['fomo-releases'], disabledSources: [] });
    expect(frame()).not.toContain('s save');
  });

  describe('with stored items', () => {
    const deleteSourceUpdates = vi.fn(async () => 5);
    const stats = { total: 5, byStatus: { unread: 5, read: 0 }, bySource: { 'fomo-releases': 5 }, savedBySource: { 'fomo-releases': 2 }, saved: 2 };
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
      await focusRow(press, 's-fomo-releases');
      await press('x');
      expect(frame()).toContain('x again: remove, keep its 5 items · d: delete them too');
      await press('d');
      expect(updateSettings).toHaveBeenCalledWith({ removedSources: ['fomo-releases'], disabledSources: [] });
      expect(deleteSourceUpdates).toHaveBeenCalledWith('fomo-releases');
    });

    it('keeps the items of a removed source, shows it greyed out, and deletes them later', async () => {
      const { press, frame } = await renderApp();
      await focusRow(press, 's-fomo-releases');
      await press('x');
      await press('x');
      expect(updateSettings).toHaveBeenCalledWith({ removedSources: ['fomo-releases'], disabledSources: [] });
      expect(deleteSourceUpdates).not.toHaveBeenCalled();
      const retired = retiredSources({ ...DEFAULT_SETTINGS, removedSources: ['fomo-releases'] }, stats.bySource);
      const rows = buildSettingsRows(SOURCES.filter((s) => s.id !== 'fomo-releases'), undefined, undefined, 1, retired);
      for (let i = findRow(buildSettingsRows(SOURCES), 's-fomo-releases') - 1; i < findRow(rows, 's-fomo-releases'); i++) await press('j');
      expect(frame()).toContain('removed · 5 items still stored');
      await press('\r');
      expect(frame()).toContain('r restore');
      await press('d');
      expect(frame()).toContain('press d again to delete its 5 items (2 pending) and remove it for good');
      await press('d');
      expect(deleteSourceUpdates).toHaveBeenCalledWith('fomo-releases');
    });

    it('deletes the items of an active source from its details with d d', async () => {
      const { press, frame } = await renderApp();
      await focusRow(press, 's-fomo-releases');
      await press('\r');
      expect(frame()).toContain('d delete its 5 items');
      await press('d');
      expect(frame()).toContain('the next fetch adds them back as new');
      await press('d');
      expect(deleteSourceUpdates).toHaveBeenCalledWith('fomo-releases');
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
    // The QR code library is loaded lazily, so give it more than one key tick under load.
    await vi.waitFor(() => expect(frame()).toContain('📱 Web app'));
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

describe('experimental source row', () => {
  const ID = 'teams-meetings';
  function setup(signIn: ExperimentalSetups[string]['signIn'] = async () => ({ ok: true, output: 'Signed in' })) {
    const setups: ExperimentalSetups = {
      [ID]: {
        isolation: 'unsandboxed',
        consent: 'UNSANDBOXED host filesystem/network access; read-only meeting lookup',
        signIn: vi.fn(signIn),
        provider: () => ({ id: ID, fetch: async () => [] }),
      },
    };
    const svc = {
      ...service,
      getStats: async () => ({ total: 3, byStatus: { unread: 3, read: 0 }, bySource: { [ID]: 3 }, saved: 0 }),
      fetch: vi.fn(async () => ({ added: 2, results: { [ID]: { added: 2 } } })),
      deleteSourceUpdates: vi.fn(async () => 3),
      updateSettings: vi.fn(async (patch: object) => ({ ...DEFAULT_SETTINGS, ...patch })),
    } as unknown as FomoDirectService & {
      fetch: ReturnType<typeof vi.fn>;
      deleteSourceUpdates: ReturnType<typeof vi.fn>;
      updateSettings: ReturnType<typeof vi.fn>;
    };
    return { setups, signIn: setups[ID]!.signIn as ReturnType<typeof vi.fn>, svc };
  }
  async function openRow(options: RenderOptions) {
    const app = await renderApp(undefined, options);
    await app.press('c');
    const rows = buildSettingsRows(SOURCES);
    for (let i = firstFocusable(rows); i < findRow(rows, `x-${ID}`); i = moveFocus(rows, i, 1)) await app.press('j');
    expect(app.frame()).toContain('Experimental sources');
    expect(app.frame()).toContain('l sign in again');
    return app;
  }

  it('space asks first, then signs in, turns it on and fetches it', async () => {
    const { setups, signIn, svc } = setup();
    const { press, frame, onConfigChange } = await openRow({ experimental: setups, service: svc });
    await press(' ');
    expect(frame()).toContain('space again to UNSANDBOXED host filesystem/network access');
    expect(signIn).not.toHaveBeenCalled();
    await press(' ');
    await vi.waitFor(() => expect(svc.fetch).toHaveBeenCalledWith({ sources: [ID] }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(onConfigChange).toHaveBeenCalledWith({ experimentalSources: [ID] });
  });

  it('stays off when signing in fails', async () => {
    const { setups, svc } = setup(async () => ({ ok: false, output: 'WorkIQ sign-in failed: cancelled' }));
    const { press, frame, onConfigChange, audit } = await openRow({ experimental: setups, service: svc });
    await press(' ');
    await press(' ');
    await vi.waitFor(() => expect(frame()).toContain('cancelled · Teams meetings stays off'));
    expect(onConfigChange).not.toHaveBeenCalled();
    expect(svc.fetch).not.toHaveBeenCalled();
    expect(audit.recent().some((e) => e.level === 'error' && e.detail?.includes('sign-in failed'))).toBe(true);
  });

  it('only fetches it when it is on', async () => {
    const { setups, svc } = setup();
    const { press, frame } = await openRow({ experimental: setups, service: svc });
    await press('f');
    expect(frame()).toContain('Teams meetings is off · space turns it on');
    expect(svc.fetch).not.toHaveBeenCalled();
  });

  it('when on: f fetches it, l signs in again, space turns it off without asking', async () => {
    const { setups, signIn, svc } = setup();
    const { press, frame, onConfigChange } = await openRow({ experimental: setups, service: svc, config: { experimentalSources: [ID] } });
    await press('f');
    await vi.waitFor(() => expect(svc.fetch).toHaveBeenCalledWith({ sources: [ID] }));
    await press('l');
    await vi.waitFor(() => expect(frame()).toContain('✓ Signed in for Teams meetings'));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(onConfigChange).not.toHaveBeenCalled();
    await press(' ');
    expect(onConfigChange).toHaveBeenCalledWith({ experimentalSources: [] });
    expect(frame()).toContain('its 3 items stay (x deletes them)');
  });

  it('x twice deletes its items', async () => {
    const { setups, svc } = setup();
    const { press, frame } = await openRow({ experimental: setups, service: svc });
    await press('x');
    expect(frame()).toContain('press x again to delete its 3 items');
    expect(svc.deleteSourceUpdates).not.toHaveBeenCalled();
    await press('x');
    await vi.waitFor(() => expect(svc.deleteSourceUpdates).toHaveBeenCalledWith(ID));
    await vi.waitFor(() => expect(frame()).toContain('✓ Deleted 3 items of Teams meetings · f fetches them again'));
  });

  it('e edits its label inline, capped at 10 characters', async () => {
    const { setups, svc } = setup();
    const { press } = await openRow({ experimental: setups, service: svc });
    await press('e');
    await press('Meetings and more');
    await press('\r');
    await vi.waitFor(() => expect(svc.updateSettings).toHaveBeenCalledWith({ sourceLabels: { [ID]: 'Meetings a' } }));
  });

  it('d picks its color', async () => {
    const { setups, svc } = setup();
    const start = DEFAULT_SOURCE_COLOR[ID] ?? DEFAULT_COLOR;
    const next = COLOR_PALETTE[moveInGrid(paletteIndex(start), 'right')]!;
    const { press, frame } = await openRow({ experimental: setups, service: svc });
    await press('d');
    expect(frame()).toContain('Pick a color · ');
    await press('\u001B[C');
    await press('\r');
    await vi.waitFor(() => expect(svc.updateSettings).toHaveBeenCalledWith({ sourceColors: { [ID]: next } }));
  });

  it('↵ opens its details with the same fields as a source, without remove', async () => {
    const { setups, svc } = setup();
    const { press, frame } = await openRow({ experimental: setups, service: svc });
    await press('\r');
    for (const text of ['UNSANDBOXED · host access', 'UNSANDBOXED: WorkIQ has host filesystem/network access', 'Enabled', 'Label', 'Color', 'Name', 'Extension name', 'l sign in again', 's save']) {
      expect(frame()).toContain(text);
    }
    expect(frame()).not.toContain('x remove');
    await press('x');
    expect(frame()).not.toContain('press x again to remove');
  });

  it('labels host-executed experimental sources as unsandboxed and states the consent', async () => {
    const { setups, svc } = setup();
    const { press, frame } = await openRow({ experimental: setups, service: svc });
    expect(frame()).toContain('UNSANDBOXED');
    await press(' ');
    expect(frame()).toContain('space again to UNSANDBOXED host filesystem/network access');
  });

  it('renames it in its details without turning it on', async () => {
    const { setups, signIn, svc } = setup();
    const { press, frame, onConfigChange } = await openRow({ experimental: setups, service: svc });
    await press('\r');
    for (let i = 0; i < 3; i++) await press('j');
    await press('\r');
    for (let i = 0; i < 'Teams meetings'.length; i++) await press('\x7f');
    await press('Calls');
    await press('\r');
    await press('s');
    await vi.waitFor(() => expect(svc.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ sourceNames: { [ID]: 'Calls' } })));
    expect(svc.updateSettings.mock.calls[0]![0]).not.toHaveProperty('disabledSources');
    expect(signIn).not.toHaveBeenCalled();
    expect(onConfigChange).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(frame()).toContain('Calls'));
  });

  it('turning it on in its details asks for a second s, then signs in', async () => {
    const { setups, signIn, svc } = setup();
    const { press, frame, onConfigChange } = await openRow({ experimental: setups, service: svc });
    await press('\r');
    await press('\r');
    await press('s');
    expect(frame()).toContain('press s again to UNSANDBOXED host filesystem/network access');
    expect(signIn).not.toHaveBeenCalled();
    await press('s');
    await vi.waitFor(() => expect(onConfigChange).toHaveBeenCalledWith({ experimentalSources: [ID] }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(svc.updateSettings).not.toHaveBeenCalled();
  });

  it('turning it off in its details needs no sign-in', async () => {
    const { setups, signIn, svc } = setup();
    const { press, onConfigChange } = await openRow({ experimental: setups, service: svc, config: { experimentalSources: [ID] } });
    await press('\r');
    await press('\r');
    await press('s');
    expect(onConfigChange).toHaveBeenCalledWith({ experimentalSources: [] });
    expect(signIn).not.toHaveBeenCalled();
  });

  /** A sign-in that runs until the test finishes it, and the signal that cancels it. */
  function pendingSignIn() {
    const run: { signal?: AbortSignal; finish: (r: { ok: boolean; output: string }) => void } = { finish: () => {} };
    const signIn: ExperimentalSetups[string]['signIn'] = (_onLine, signal) => new Promise((resolve) => {
      run.signal = signal;
      run.finish = resolve;
    });
    return { run, signIn };
  }

  it('shows a running sign-in, and space twice cancels it and leaves it off', async () => {
    const { run, signIn: slow } = pendingSignIn();
    const { setups, signIn, svc } = setup(slow);
    const { press, frame, onConfigChange, audit } = await openRow({ experimental: setups, service: svc });
    await press(' ');
    await press(' ');
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(frame()).toContain('sign-in…');
    expect(frame()).toContain('⟳ signing in — check your browser or account picker');
    await press(' ');
    expect(frame()).toContain('still signing in — space again to cancel the sign-in');
    await press('\u001B');
    expect(frame()).not.toContain('still signing in');
    expect(run.signal?.aborted).toBe(false);
    await press(' ');
    await press(' ');
    expect(run.signal?.aborted).toBe(true);
    await act(async () => run.finish({ ok: false, output: 'WorkIQ sign-in failed: aborted' }));
    await vi.waitFor(() => expect(frame()).toContain('Sign-in cancelled · Teams meetings stays off'));
    expect(frame()).not.toContain('sign-in…');
    expect(onConfigChange).not.toHaveBeenCalled();
    expect(svc.fetch).not.toHaveBeenCalled();
    expect(audit.recent().some((e) => e.detail?.includes('sign-in cancelled'))).toBe(true);
    expect(audit.recent().some((e) => e.level === 'error')).toBe(false);
  });

  it('a space pressed while signing in cannot turn it off once it is on', async () => {
    const { run, signIn } = pendingSignIn();
    const { setups, svc } = setup(signIn);
    let fetched: (r: unknown) => void = () => {};
    svc.fetch.mockImplementation(() => new Promise((resolve) => { fetched = resolve; }));
    const { press, frame, onConfigChange } = await openRow({ experimental: setups, service: svc, liveConfig: true });
    await press(' ');
    await press(' ');
    await press(' ');
    expect(frame()).toContain('still signing in — space again to cancel the sign-in');
    await act(async () => run.finish({ ok: true, output: 'Signed in' }));
    await vi.waitFor(() => expect(svc.fetch).toHaveBeenCalledWith({ sources: [ID] }));
    expect(onConfigChange).toHaveBeenCalledWith({ experimentalSources: [ID] });
    expect(run.signal?.aborted).toBe(false);
    expect(frame()).not.toContain('still signing in');
    expect(frame()).toContain('⟳ fetching…');
    await press(' ');
    expect(frame()).toContain('fetching now — space again to stop it and turn the source off');
    expect(onConfigChange).toHaveBeenCalledTimes(1);
    await press('\u001B');
    await act(async () => fetched({ added: 1, results: { [ID]: { fetched: 1, added: 1 } } }));
    await vi.waitFor(() => expect(frame()).toContain('✓ Added 1 update'));
    expect(frame()).not.toContain('⟳ fetching…');
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  it('space twice while it fetches turns it off, and the stopped fetch is not a failure', async () => {
    const { setups, svc } = setup();
    let fetched: (r: unknown) => void = () => {};
    svc.fetch.mockImplementation(() => new Promise((resolve) => { fetched = resolve; }));
    const { press, frame, onConfigChange, digest, audit } = await openRow({ experimental: setups, service: svc, config: { experimentalSources: [ID] }, liveConfig: true });
    await press('f');
    await vi.waitFor(() => expect(frame()).toContain('⟳ fetching…'));
    await press(' ');
    expect(frame()).toContain('fetching now — space again to stop it and turn the source off');
    expect(onConfigChange).not.toHaveBeenCalled();
    await press(' ');
    expect(onConfigChange).toHaveBeenCalledWith({ experimentalSources: [] });
    expect(frame()).toContain('Teams meetings off · its fetch was stopped');
    expect(frame()).not.toContain('⟳ fetching…');
    await act(async () => fetched({ added: 0, results: { [ID]: { fetched: 0, added: 0, stopped: true } } }));
    await vi.waitFor(() => expect(audit.recent().some((e) => e.detail?.includes('stopped (turned off during the fetch)'))).toBe(true));
    expect(frame()).not.toContain('failed');
    expect(digest).not.toHaveBeenCalled();
    expect(audit.recent().some((e) => e.level === 'error')).toBe(false);
  });

  it('a details pane opened while signing in shows it on once signed in, so saving keeps it on', async () => {
    const { run, signIn } = pendingSignIn();
    const { setups, svc } = setup(signIn);
    const { press, frame, onConfigChange } = await openRow({ experimental: setups, service: svc, liveConfig: true });
    await press(' ');
    await press(' ');
    await press('\r');
    expect(frame()).toContain('⟳ signing in — check your browser or account picker');
    expect(frame()).toContain('[ ] off');
    await act(async () => run.finish({ ok: true, output: 'Signed in' }));
    await vi.waitFor(() => expect(frame()).toContain('[x] on'));
    expect(frame()).not.toContain('● unsaved');
    await press('s');
    expect(onConfigChange).toHaveBeenCalledTimes(1);
    expect(onConfigChange).toHaveBeenCalledWith({ experimentalSources: [ID] });
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
    expect(frame()).toContain('Pick source color');
    await press('/');
    for (const ch of 'color') await press(ch);
    expect(frame()).toContain('Pick source color');
    expect(frame()).not.toContain('Fetch this source now');
    await press('\u001B'); // clears the search
    await press('\u001B'); // closes help
    expect(frame()).toContain('⚙️  Config');
  });
});

describe('settings rows', () => {
  it('keeps source metric columns fixed when values are empty, populated, or too wide', () => {
    expect(fixedColumn('', 7)).toBe('       ');
    expect(fixedColumn('667', 7)).toBe('667    ');
    expect(fixedColumn('+4', 7)).toBe('+4     ');
    expect(fixedColumn('12345678', 7)).toBe('123456…');
  });

  it('filters rows and drops sections without matches', () => {
    const rows = buildSettingsRows([], new Set(['h-actions']), (r) => r.kind === 'config' && r.field === 'webUrl');
    expect(rows.map((r) => r.key)).toEqual(['h-local', 'c-webUrl']);
    expect(rows[0]).toMatchObject({ collapsed: false, count: 1 });
  });

  it('leaves out the rows of collapsed sections', () => {
    const rows = buildSettingsRows([], new Set(['h-local', 'h-actions']));
    expect(rows.map((r) => r.key)).toEqual(['h-actions', 'h-sources', 'source-columns', 'add-source', 'h-experimental', 'x-teams-meetings', 'h-display', 'preview', 'h-local']);
    expect(rows[0]).toMatchObject({ collapsed: true, count: 6 });
    expect(moveFocus(rows, 1, 1)).toBe(3);
    expect(moveFocus(rows, 7, 10)).toBe(8);
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

  it('never shows the YouTube API key in full', () => {
    const key = 'fake-youtube-key-0123456789-abcdefghi-rstu';
    expect(configDisplay({ youtubeApiKey: key }, 'youtubeApiKey', { youtubeApiKey: key }).value).toBe('••••rstu');
    expect(configDisplay({}, 'youtubeApiKey', {})).toMatchObject({ value: expect.stringContaining('no video lengths'), muted: true });
    expect(editStartValue('youtubeApiKey', { youtubeApiKey: key })).toBe('');
    expect(parseConfigEdit('youtubeApiKey', ` ${key} `)).toEqual({ patch: { youtubeApiKey: key } });
    expect(parseConfigEdit('youtubeApiKey', '')).toEqual({ patch: { youtubeApiKey: undefined } });
    expect(parseConfigEdit('youtubeApiKey', 'oops')).toHaveProperty('error');
  });

  it('searches the values of the profile in use', () => {
    const row = buildSettingsRows([]).find((r) => r.key === 'c-interests')!;
    expect(settingsRowText(row, { interests: 'rust' }, { interests: 'rust' }, 'work')).toContain('rust');
  });
});
