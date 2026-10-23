import React, { act } from 'react';
import { PassThrough } from 'node:stream';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ created: [] as string[] }));

// Each account answers with its own total, so the status bar shows which account is open.
vi.mock('@fomo/core/service', async () => {
  const { DEFAULT_SETTINGS } = await import('@fomo/core');
  const totals: Record<string, number> = { workacct: 11, homeacct: 22, newacct: 33 };
  class FomoDirectService {
    private readonly account: string;
    constructor(connectionString: string) {
      this.account = /AccountName=([^;]+)/.exec(connectionString)?.[1] ?? '';
      fake.created.push(this.account);
    }
    getSettings = async () => ({ ...DEFAULT_SETTINGS });
    setExperimentalProviders = () => {};
    getSources = async () => [];
    getDigest = async () => ({ entries: [], pending: 0 });
    listUpdates = async () => ({ updates: [], total: 0 });
    listTodos = async () => ({ todos: [] });
    listReferences = async () => ({ references: [] });
    getStats = async () => {
      if (this.account === 'badacct') throw new Error('getaddrinfo ENOTFOUND badacct.table.core.windows.net');
      const total = totals[this.account] ?? 0;
      return { total, byStatus: { unread: total, read: 0 }, bySource: {}, saved: 0 };
    };
  }
  return { FomoDirectService };
});

import { createMemoryAuditLog } from '../src/audit.js';
import { CONFIG_DIR, CONFIG_FILE, defaultBackupDir, loadConfig, readConfigFile } from '../src/config.js';
import { SummarizerCache } from '../src/copilot.js';
import { Root } from '../src/ui/Root.js';

type FakeStdin = PassThrough & { isTTY: boolean; setRawMode(on: boolean): void; ref(): void; unref(): void };

const ENTER = '\r';
const ESC = '\u001B';
const CTRL_U = '\u0015';

const connection = (account: string) => `AccountName=${account};AccountKey=c2VjcmV0;EndpointSuffix=core.windows.net`;
const TITLE = '🔀 Profiles';

const stripAnsi = (text: string) => text.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
const stored = () => JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
const write = (doc: unknown) => {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(doc));
};

let columns: PropertyDescriptor | undefined;
let unmount: (() => void) | undefined;

beforeEach(() => {
  columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  Object.defineProperty(process.stdout, 'columns', { value: 200, configurable: true });
  fake.created.length = 0;
  rmSync(CONFIG_FILE, { force: true });
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  if (columns) Object.defineProperty(process.stdout, 'columns', columns);
  else delete (process.stdout as { columns?: number }).columns;
});

/** Three profiles, `work` in use; `draft` has no storage account yet. */
function twoAccounts() {
  write({
    activeProfile: 'work',
    profiles: { work: { connectionString: connection('workacct') }, home: { connectionString: connection('homeacct') }, draft: {} },
  });
}

async function renderRoot(initialProfile: string) {
  const audit = createMemoryAuditLog();
  const stdin = new PassThrough() as FakeStdin;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = new PassThrough();
  let frame = '';
  stdout.on('data', (chunk: Buffer) => { frame = chunk.toString(); });
  await act(async () => {
    const instance = render(
      <Root
        initialProfile={initialProfile}
        initialConfig={loadConfig(initialProfile)}
        summarizers={new SummarizerCache()}
        audit={audit}
        auditFile="/tmp/audit.log"
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
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      await act(async () => {
        stdin.write(key);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  };
  return { audit, press, plain: () => stripAnsi(frame) };
}

describe('opening a profile', () => {
  it('connects to the account of the profile it is given', async () => {
    twoAccounts();
    const { plain } = await renderRoot('home');
    expect(plain()).toContain('Total: 22');
    expect(plain()).toContain('[w] home');
    expect(fake.created).toEqual(['homeacct']);
  });

  it('asks for the connection string of a profile that has none, naming the profile', async () => {
    twoAccounts();
    const { press, plain } = await renderRoot('draft');
    expect(plain()).toContain('set up profile “draft”');
    await press(connection('newacct'), ENTER);
    expect(plain()).toContain('Total: 33');
    expect(readConfigFile('draft').connectionString).toBe(connection('newacct'));
    expect(readConfigFile('work').connectionString).toBe(connection('workacct'));
  });

  it('says first-time setup when there is only the default profile', async () => {
    const { plain } = await renderRoot('default');
    expect(plain()).toContain('first-time setup');
  });
});

describe('switching', () => {
  it('opens the other account, remembers the choice and confirms it in the new app', async () => {
    twoAccounts();
    const { audit, press, plain } = await renderRoot('work');
    expect(plain()).toContain('Total: 11');
    await press('w', 'j', ENTER);
    expect(plain()).not.toContain(TITLE);
    expect(plain()).toContain('Total: 22');
    expect(plain()).toContain('[w] home');
    expect(plain()).toContain('✓ Switched to “home”');
    expect(stored().activeProfile).toBe('home');
    expect(fake.created).toEqual(['workacct', 'homeacct']);
    expect(audit.entries.find((e) => e.action === 'profile')).toMatchObject({ detail: 'switched from work', profile: 'home' });
  });

  it('tags the audit trail with the profile in use, from the moment of the switch', async () => {
    twoAccounts();
    const { audit, press } = await renderRoot('work');
    audit.log('before');
    await press('w', 'j', ENTER);
    audit.log('after');
    const tag = (action: string) => audit.entries.find((e) => e.action === action)?.profile;
    expect(tag('before')).toBe('work');
    expect(tag('after')).toBe('home');
  });

  it('refuses a profile that has no connection string, and stays on the list', async () => {
    twoAccounts();
    const { press, plain } = await renderRoot('work');
    await press('w', 'j', 'j', ENTER);
    expect(plain()).toContain(TITLE);
    expect(plain()).toContain('“draft” has no connection string');
    expect(stored().activeProfile).toBe('work');
    expect(fake.created).toEqual(['workacct']);
  });

  it('keeps the one used by --profile out of the file: only in-app switches are remembered', async () => {
    twoAccounts();
    await renderRoot('home');
    expect(stored().activeProfile).toBe('work');
  });
});

describe('adding', () => {
  it('checks the account, saves the profile, switches to it and confirms', async () => {
    twoAccounts();
    const { audit, press, plain } = await renderRoot('work');
    await press('w', 'a', 'new', ENTER, connection('newacct'), ENTER);
    expect(plain()).not.toContain(TITLE);
    expect(plain()).toContain('Total: 33');
    expect(plain()).toContain('[w] new');
    expect(plain()).toContain('✓ Added profile “new”');
    expect(stored().activeProfile).toBe('new');
    expect(Object.keys(stored().profiles)).toEqual(['work', 'home', 'draft', 'new']);
    expect(stored().profiles.new).toEqual({ connectionString: connection('newacct') });
    expect(audit.entries.find((e) => e.action === 'profile')).toMatchObject({ detail: 'added (newacct), switched from work', profile: 'new' });
  });

  it('keeps an account it can’t reach out of the file, until asked a second time', async () => {
    twoAccounts();
    const { audit, press, plain } = await renderRoot('work');
    await press('w', 'a', 'bad', ENTER, connection('badacct'), ENTER);
    expect(plain()).toContain('✗ getaddrinfo ENOTFOUND badacct.table.core.windows.net');
    expect(plain()).toContain('↵ again saves it anyway');
    expect(stored().profiles.bad).toBeUndefined();
    expect(stored().activeProfile).toBe('work');
    expect(audit.entries.find((e) => e.level === 'error')).toMatchObject({ action: 'profile', profile: 'work' });

    await press(ENTER);
    expect(stored().profiles.bad).toEqual({ connectionString: connection('badacct') });
    expect(stored().activeProfile).toBe('bad');
    expect(audit.entries.find((e) => e.action === 'profile' && e.level === 'info')?.detail).toBe('added (badacct, check skipped), switched from work');
  });

  it('refuses a name that is taken, ignoring case, before asking for anything else', async () => {
    twoAccounts();
    const { press, plain } = await renderRoot('work');
    await press('w', 'a', 'HOME', ENTER);
    expect(plain()).toContain('already exists');
    expect(plain()).not.toContain('Connection string for');
  });

  it('can add a profile when the file only has the default profile', async () => {
    write({ connectionString: connection('workacct') });
    const { press, plain } = await renderRoot('default');
    expect(plain()).not.toContain('[w]');
    await press('w', 'a', 'home', ENTER, connection('homeacct'), ENTER);
    expect(plain()).toContain('Total: 22');
    expect(plain()).toContain('[w] home');
    expect(stored()).toEqual({
      activeProfile: 'home',
      profiles: { default: { connectionString: connection('workacct') }, home: { connectionString: connection('homeacct') } },
    });
  });
});

describe('renaming', () => {
  it('renames the profile in use, and keeps its backups where they were', async () => {
    twoAccounts();
    const { audit, press, plain } = await renderRoot('work');
    await press('w', 'e', CTRL_U, 'job', ENTER);
    expect(plain()).toContain('Renamed “work” to “job”');
    expect(plain()).toContain('[w] job');
    expect(Object.keys(stored().profiles)).toEqual(['job', 'home', 'draft']);
    expect(stored().activeProfile).toBe('job');
    expect(readConfigFile('job').backupDir).toBe(defaultBackupDir('work'));
    expect(audit.entries.find((e) => e.action === 'profile')).toMatchObject({ detail: 'renamed work → job', profile: 'job' });
  });

  it('renames another profile without leaving the one in use', async () => {
    twoAccounts();
    const { press, plain } = await renderRoot('work');
    await press('w', 'j', 'e', CTRL_U, 'house', ENTER);
    expect(plain()).toContain('[w] work');
    expect(plain()).toContain('Total: 11');
    expect(Object.keys(stored().profiles)).toEqual(['work', 'house', 'draft']);
    expect(stored().activeProfile).toBe('work');
    expect(fake.created).toEqual(['workacct']);
  });
});

describe('removing', () => {
  it('forgets another profile, updates the list, and leaves the one in use', async () => {
    twoAccounts();
    const { press, plain } = await renderRoot('work');
    await press('w', 'j', 'x', 'y');
    expect(plain()).toContain('Removed profile “home”');
    expect(plain()).not.toMatch(/○ home/);
    expect(Object.keys(stored().profiles)).toEqual(['work', 'draft']);
    expect(plain()).toContain('Total: 11');
  });

  it('refuses the profile in use', async () => {
    twoAccounts();
    const { press, plain } = await renderRoot('work');
    await press('w', 'x');
    expect(plain()).toContain('Can’t remove the profile in use');
    expect(Object.keys(stored().profiles)).toEqual(['work', 'home', 'draft']);
  });

  it('drops the status bar badge and the audit tag once one profile is left', async () => {
    write({ activeProfile: 'work', profiles: { work: { connectionString: connection('workacct') }, home: { connectionString: connection('homeacct') } } });
    const { audit, press, plain } = await renderRoot('work');
    expect(plain()).toContain('[w] work');
    await press('w', 'j', 'x', 'y', ESC);
    expect(plain()).not.toContain('[w]');
    audit.log('later');
    expect(audit.entries.find((e) => e.action === 'later')?.profile).toBeUndefined();
    expect(audit.entries.find((e) => e.detail === 'removed home')).toMatchObject({ profile: 'work' });
  });
});
