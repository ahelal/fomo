import React, { act } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, jumpStep } from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import type { DigestResult } from '@fomo/core/digest';
import { App } from '../src/ui/App.js';
import { createMemoryAuditLog } from '../src/audit.js';
import type { ProfileInfo } from '../src/config.js';
import type { ProfileControls } from '../src/ui/hooks/useProfilePicker.js';
import { buildSettingsRows, findRow, firstFocusable, moveFocus } from '../src/ui/settings.js';

type FakeStdin = PassThrough & { isTTY: boolean; setRawMode(on: boolean): void; ref(): void; unref(): void };

const ENTER = '\r';
const ESC = '\u001B';
const UP = '\u001B[A';
const DOWN = '\u001B[B';
const SHIFT_UP = '\u001B[1;2A';
const SHIFT_DOWN = '\u001B[1;2B';
const BACKSPACE = '\u007F';
const CTRL_U = '\u0015';

const TITLE = '🔀 Profiles';
const CONNECTION = 'AccountName=homeacct;AccountKey=c2VjcmV0;EndpointSuffix=core.windows.net';

const service = {
  getSettings: async () => ({ ...DEFAULT_SETTINGS }),
  getSources: async () => [],
  getDigest: async () => ({ entries: [], pending: 0 }),
  listUpdates: async () => ({ updates: [], total: 0 }),
  getStats: async () => ({ total: 0, byStatus: { unread: 0, read: 0 }, bySource: {}, saved: 0 }),
  listTodos: async () => ({ todos: [] }),
  listReferences: async () => ({ references: [] }),
} as unknown as FomoDirectService;

const result: DigestResult = { processed: 0, remaining: 0, created: 0, updated: 0, errors: [] };

const PROFILES: ProfileInfo[] = [
  { name: 'work', account: 'fomowork' },
  { name: 'private', account: 'fomohome' },
  { name: 'draft' },
];

/** Controls whose calls are recorded and that do what Root does on success; each test can make them fail. */
function makeControls(opts: { active?: string; profiles?: ProfileInfo[] } = {}) {
  const switchTo = vi.fn((_name: string): string | undefined => undefined);
  const add = vi.fn(async (_name: string, _connectionString: string, _skipCheck: boolean): Promise<string | undefined> => undefined);
  const rename = vi.fn((_from: string, _to: string): string | undefined => undefined);
  const remove = vi.fn((_name: string): string | undefined => undefined);
  const value: ProfileControls = { active: opts.active ?? 'work', profiles: opts.profiles ?? PROFILES, switchTo, add, rename, remove };
  return { value, switchTo, add, rename, remove };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Run `fn` (which settles a promise the app awaits) and let the app finish what follows. */
const settle = (fn: () => void) => act(async () => {
  fn();
  await new Promise((resolve) => setTimeout(resolve, 20));
});

const stripAnsi = (text: string) => text.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
/** The profile the picker's cursor is on. */
const focused = (frame: string) => /▸ [●○] (\S+)/.exec(frame)?.[1];

let columns: PropertyDescriptor | undefined;
let rows: PropertyDescriptor | undefined;
let unmount: (() => void) | undefined;

beforeEach(() => {
  columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  Object.defineProperty(process.stdout, 'columns', { value: 200, configurable: true });
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  if (columns) Object.defineProperty(process.stdout, 'columns', columns);
  else delete (process.stdout as { columns?: number }).columns;
  if (rows) Object.defineProperty(process.stdout, 'rows', rows);
  else delete (process.stdout as { rows?: number }).rows;
});

async function renderApp(props: Partial<React.ComponentProps<typeof App>> = {}) {
  const digest = props.digest ?? vi.fn(async () => result);
  const stdin = new PassThrough() as FakeStdin;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = new PassThrough();
  let frame = '';
  stdout.on('data', (chunk: Buffer) => { frame = chunk.toString(); });
  await act(async () => {
    const instance = render(
      <App
        service={service}
        config={{}}
        onConfigChange={() => undefined}
        digest={digest}
        audit={createMemoryAuditLog()}
        auditFile="/tmp/audit.log"
        {...props}
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
  return { digest, press, plain: () => stripAnsi(frame) };
}

describe('w profile picker', () => {
  it('lists the profiles with their storage accounts; the one in use is marked', async () => {
    const { press, plain } = await renderApp({ profiles: makeControls().value });
    await press('w');
    expect(plain()).toContain(TITLE);
    expect(plain()).toMatch(/▸ ● work\s+fomowork/);
    expect(plain()).toMatch(/ {2}○ private\s+fomohome/);
    expect(plain()).toMatch(/ {2}○ draft\s+no connection string/);
  });

  it('starts on the profile in use', async () => {
    const { press, plain } = await renderApp({ profiles: makeControls({ active: 'private' }).value });
    await press('w');
    expect(focused(plain())).toBe('private');
  });

  it('does nothing without profile controls', async () => {
    const { press, plain } = await renderApp();
    await press('w');
    expect(plain()).not.toContain(TITLE);
  });

  it.each([['Esc', ESC], ['w', 'w'], ['⌫', BACKSPACE]])('closes with %s without switching', async (_name, key) => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'j');
    expect(plain()).toContain(TITLE);
    await press(key);
    expect(plain()).not.toContain(TITLE);
    expect(ctl.switchTo).not.toHaveBeenCalled();
  });

  it('moves with j/k and the arrows, stopping at both ends', async () => {
    const { press, plain } = await renderApp({ profiles: makeControls().value });
    await press('w');
    const trail: (string | undefined)[] = [focused(plain())];
    for (const key of ['k', 'j', DOWN, 'j', UP, 'k', 'k']) {
      await press(key);
      trail.push(focused(plain()));
    }
    expect(trail).toEqual(['work', 'work', 'private', 'draft', 'draft', 'private', 'work', 'work']);
  });

  it('jumps with Shift+↑/↓ by the same step as the other lists', async () => {
    Object.defineProperty(process.stdout, 'rows', { value: 45, configurable: true });
    const step = jumpStep(45);
    const profiles = Array.from({ length: 30 }, (_, i) => ({ name: `p${i}`, account: `acct${i}` }));
    const { press, plain } = await renderApp({ profiles: makeControls({ profiles, active: 'p0' }).value });
    await press('w', SHIFT_DOWN);
    expect(focused(plain())).toBe(`p${step}`);
    await press(SHIFT_DOWN);
    expect(focused(plain())).toBe(`p${2 * step}`);
    await press(SHIFT_UP);
    expect(focused(plain())).toBe(`p${step}`);
    await press(SHIFT_DOWN, SHIFT_DOWN, SHIFT_DOWN);
    expect(focused(plain())).toBe('p29');
  });

  it('keeps the keys of the main list from reaching the app behind it', async () => {
    const { digest, press } = await renderApp({ profiles: makeControls().value });
    await press('w', 'z', 'z');
    expect(digest).not.toHaveBeenCalled();
  });

  it('takes capital letters like lower case ones', async () => {
    const ctl = makeControls();
    ctl.remove.mockReturnValue(undefined);
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('W', 'J');
    expect(plain()).toContain(TITLE);
    expect(focused(plain())).toBe('private');
    await press('X', 'Y');
    expect(ctl.remove.mock.calls).toEqual([['private']]);
    await press('E');
    expect(plain()).toContain('Rename “private” to:');
    await press(ESC, 'A');
    expect(plain()).toContain('New profile name:');
    await press(ESC, 'K', 'W');
    expect(plain()).not.toContain(TITLE);
  });
});

describe('switching', () => {
  it('switches to the profile in focus with ↵ and closes', async () => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'j', ENTER);
    expect(ctl.switchTo.mock.calls).toEqual([['private']]);
    expect(plain()).not.toContain(TITLE);
  });

  it('just closes on the profile that is already in use', async () => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', ENTER);
    expect(ctl.switchTo).not.toHaveBeenCalled();
    expect(plain()).not.toContain(TITLE);
  });

  it('says why a profile can’t be opened and stays on the list', async () => {
    const ctl = makeControls();
    ctl.switchTo.mockReturnValueOnce('“draft” has no connection string yet');
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'j', 'j', ENTER);
    expect(plain()).toContain(TITLE);
    expect(plain()).toContain('“draft” has no connection string yet');
    expect(focused(plain())).toBe('draft');
  });

  it('waits for a running fetch or digest to finish', async () => {
    const run = deferred<DigestResult>();
    const ctl = makeControls();
    const { digest, press, plain } = await renderApp({ profiles: ctl.value, digest: vi.fn(() => run.promise) });
    await press('z', 'z');
    expect(digest).toHaveBeenCalledTimes(1);

    await press('w', 'j', ENTER);
    expect(ctl.switchTo).not.toHaveBeenCalled();
    expect(plain()).toContain('A run is still going');
    expect(plain()).toContain(TITLE);

    await settle(() => run.resolve(result));
    await press(ENTER);
    expect(ctl.switchTo.mock.calls).toEqual([['private']]);
  });
});

describe('adding a profile', () => {
  const startAdding = async (press: (...keys: string[]) => Promise<void>, name = 'home') => {
    await press('w', 'a', name, ENTER);
  };

  it('asks for a name, then the connection string, and connects', async () => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'a');
    expect(plain()).toContain('New profile name:');
    await press('home');
    expect(plain()).toMatch(/home▏/);
    await press(ENTER);
    expect(plain()).toContain('Connection string for “home”:');

    // A pasted string may have wrapped; the key is hidden while it is typed
    await press('AccountName=homeacct;AccountKey=c2VjcmV0 ;EndpointSuffix=core.windows.net');
    expect(plain()).toContain('AccountKey=***');
    expect(plain()).not.toContain('c2VjcmV0');
    await press(ENTER);
    expect(ctl.add.mock.calls).toEqual([['home', CONNECTION, false]]);
    expect(plain()).not.toContain(TITLE);
  });

  it('checks the name before asking for the connection string', async () => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'a', ENTER);
    expect(plain()).toContain('✗ Use 1–32 letters');

    await press('WORK', ENTER);
    expect(plain()).toContain('already exists');
    expect(plain()).not.toContain('Connection string for');

    await press(CTRL_U, 'my work', ENTER);
    expect(plain()).toContain('✗ Use 1–32 letters');
    expect(ctl.add).not.toHaveBeenCalled();
  });

  it('checks the shape of the connection string before connecting', async () => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await startAdding(press);
    await press('hello', ENTER);
    expect(plain()).toContain('doesn’t look like a storage connection string');
    expect(ctl.add).not.toHaveBeenCalled();
    // An empty line does nothing
    await press(CTRL_U, ENTER);
    expect(ctl.add).not.toHaveBeenCalled();
  });

  it('shows why connecting failed, and a second ↵ saves it anyway', async () => {
    const ctl = makeControls();
    ctl.add.mockResolvedValueOnce('Could not connect: getaddrinfo ENOTFOUND');
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await startAdding(press);
    await press(CONNECTION, ENTER);
    expect(plain()).toContain('✗ Could not connect: getaddrinfo ENOTFOUND');
    expect(plain()).toContain('↵ again saves it anyway');
    expect(plain()).toContain(TITLE);

    await press(ENTER);
    expect(ctl.add).toHaveBeenCalledTimes(2);
    expect(ctl.add).toHaveBeenNthCalledWith(1, 'home', CONNECTION, false);
    expect(ctl.add).toHaveBeenNthCalledWith(2, 'home', CONNECTION, true);
    expect(plain()).not.toContain(TITLE);
  });

  it('checks again, instead of saving anyway, once the value was edited', async () => {
    const ctl = makeControls();
    ctl.add.mockResolvedValueOnce('Could not connect');
    const { press } = await renderApp({ profiles: ctl.value });
    await startAdding(press);
    await press(CONNECTION, ENTER);
    await press(BACKSPACE, 'y', ENTER);
    expect(ctl.add).toHaveBeenCalledTimes(2);
    expect(ctl.add).toHaveBeenNthCalledWith(2, 'home', `${CONNECTION.slice(0, -1)}y`, false);
  });

  it('shows an error thrown while connecting the same way', async () => {
    const ctl = makeControls();
    ctl.add.mockRejectedValueOnce(new Error('socket hang up'));
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await startAdding(press);
    await press(CONNECTION, ENTER);
    expect(plain()).toContain('✗ socket hang up');
  });

  it('ignores keys while connecting', async () => {
    const pending = deferred<string | undefined>();
    const ctl = makeControls();
    ctl.add.mockReturnValueOnce(pending.promise);
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await startAdding(press);
    await press(CONNECTION, ENTER);
    expect(plain()).toContain('Connecting…');
    await press('x', ENTER, ESC, 'q');
    expect(ctl.add).toHaveBeenCalledTimes(1);
    expect(plain()).toContain('Connecting…');

    await settle(() => pending.resolve(undefined));
    expect(plain()).not.toContain(TITLE);
  });

  it('waits for a running fetch or digest before connecting', async () => {
    const run = deferred<DigestResult>();
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value, digest: vi.fn(() => run.promise) });
    await press('z', 'z');
    await startAdding(press);
    await press(CONNECTION, ENTER);
    expect(ctl.add).not.toHaveBeenCalled();
    expect(plain()).toContain('A run is still going');
    await settle(() => run.resolve(result));
  });

  it('goes back to the list with Esc, from either step', async () => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'a', ESC);
    expect(plain()).toContain('↵ switch');
    await press('a', 'home', ENTER);
    expect(plain()).toContain('Connection string for “home”:');
    await press(ESC);
    expect(plain()).toContain('↵ switch');
    expect(plain()).toContain(TITLE);
    expect(ctl.add).not.toHaveBeenCalled();
  });

  it('takes q as text instead of quitting', async () => {
    const { press, plain } = await renderApp({ profiles: makeControls().value });
    await press('w', 'a', 'q');
    expect(plain()).toContain('New profile name:');
    expect(plain()).toMatch(/q▏/);
    await press(ENTER, 'q');
    expect(plain()).toContain('Connection string for “q”:');
  });
});

describe('renaming a profile', () => {
  it('prefills the name of the profile in focus', async () => {
    const { press, plain } = await renderApp({ profiles: makeControls().value });
    await press('w', 'j', 'e');
    expect(plain()).toContain('Rename “private” to:');
    expect(plain()).toMatch(/private▏/);
  });

  it('renames it, and says so', async () => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'j', 'e', CTRL_U, 'home', ENTER);
    expect(ctl.rename.mock.calls).toEqual([['private', 'home']]);
    expect(plain()).toContain('Renamed “private” to “home”');
    expect(plain()).toContain('↵ switch');
  });

  it('can edit the old name instead of retyping it', async () => {
    const ctl = makeControls();
    const { press } = await renderApp({ profiles: ctl.value });
    await press('w', 'j', 'e', BACKSPACE, BACKSPACE, BACKSPACE, 'ate-2', ENTER);
    expect(ctl.rename.mock.calls).toEqual([['private', 'private-2']]);
  });

  it('closes without a call when the name is unchanged', async () => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'j', 'e', ENTER);
    expect(ctl.rename).not.toHaveBeenCalled();
    expect(plain()).toContain('↵ switch');
  });

  it('refuses a bad name or the name of another profile, ignoring case', async () => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'j', 'e', CTRL_U, 'WORK', ENTER);
    expect(plain()).toContain('already exists');
    await press(CTRL_U, 'a b', ENTER);
    expect(plain()).toContain('✗ Use 1–32 letters');
    expect(ctl.rename).not.toHaveBeenCalled();
    expect(plain()).toContain('Rename “private” to:');
  });

  it('shows what the rename itself ran into', async () => {
    const ctl = makeControls();
    ctl.rename.mockReturnValueOnce('EACCES: permission denied');
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'j', 'e', CTRL_U, 'home', ENTER);
    expect(plain()).toContain('✗ EACCES: permission denied');
    expect(plain()).toContain('Rename “private” to:');
  });

  it('goes back to the list with Esc', async () => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'e', ESC);
    expect(plain()).toContain('↵ switch');
    expect(ctl.rename).not.toHaveBeenCalled();
  });
});

describe('removing a profile', () => {
  it('asks first, and says nothing is deleted', async () => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'j', 'x');
    expect(plain()).toContain('Remove profile “private”?');
    expect(plain()).toContain('the storage account and your backup files are not touched');
    expect(ctl.remove).not.toHaveBeenCalled();
  });

  it.each([['x', 'x'], ['y', 'y'], ['↵', ENTER]])('removes it on %s', async (_name, key) => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'j', 'x', key);
    expect(ctl.remove.mock.calls).toEqual([['private']]);
    expect(plain()).toContain('Removed profile “private”');
  });

  it.each([['n', 'n'], ['Esc', ESC], ['j', 'j']])('keeps it on %s', async (_name, key) => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'j', 'x', key);
    expect(ctl.remove).not.toHaveBeenCalled();
    expect(plain()).toContain('↵ switch');
    expect(plain()).not.toContain('Removed profile');
  });

  it('keeps the profile in use: switch first', async () => {
    const ctl = makeControls();
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'x');
    expect(plain()).toContain('Can’t remove the profile in use');
    expect(plain()).not.toContain('Remove profile “work”?');
    expect(ctl.remove).not.toHaveBeenCalled();
  });

  it('shows what the removal ran into', async () => {
    const ctl = makeControls();
    ctl.remove.mockReturnValueOnce('EACCES: permission denied');
    const { press, plain } = await renderApp({ profiles: ctl.value });
    await press('w', 'j', 'x', 'y');
    expect(plain()).toContain('EACCES: permission denied');
    expect(plain()).not.toContain('Removed profile');
  });
});

describe('reaching the picker', () => {
  it('from the Config screen, and back to it', async () => {
    const { press, plain } = await renderApp({ profiles: makeControls().value });
    await press('c');
    expect(plain()).toContain('Link a device');
    await press('w');
    expect(plain()).toContain(TITLE);
    await press(ESC);
    expect(plain()).not.toContain(TITLE);
    expect(plain()).toContain('Link a device');
  });

  it('from the Todos view, and back to it', async () => {
    const { press, plain } = await renderApp({ profiles: makeControls().value });
    await press('6');
    expect(plain()).toContain('✓ Todos');
    await press('w');
    expect(plain()).toContain(TITLE);
    await press(ESC);
    expect(plain()).toContain('✓ Todos');
  });

  it('from the Bookmarks view, and back to it', async () => {
    const { press, plain } = await renderApp({ profiles: makeControls().value });
    await press('5');
    expect(plain()).toContain('Bookmarks');
    await press('w');
    expect(plain()).toContain(TITLE);
    await press(ESC);
    expect(plain()).not.toContain(TITLE);
    expect(plain()).toContain('Bookmarks');
  });

  it('from the “Switch profile” action in Config', async () => {
    const { press, plain } = await renderApp({ profiles: makeControls().value });
    await press('c');
    const rows = buildSettingsRows([]);
    for (let i = firstFocusable(rows); i < findRow(rows, 'a-profiles'); i = moveFocus(rows, i, 1)) await press('j');
    expect(plain()).toContain('↵ open the profile list');
    await press(ENTER);
    expect(plain()).toContain(TITLE);
  });

  it('with w typed into a search instead of opening it', async () => {
    const { press, plain } = await renderApp({ profiles: makeControls().value });
    await press('/', 'w');
    expect(plain()).not.toContain(TITLE);
    await press(ESC, 'c', '/', 'w');
    expect(plain()).not.toContain(TITLE);
  });
});

describe('status bar', () => {
  it('names the profile in use, and the key that switches, when there are several', async () => {
    const { plain } = await renderApp({ profiles: makeControls({ active: 'private' }).value });
    expect(plain()).toContain('[w] private');
  });

  it('stays quiet with a single profile', async () => {
    const single = makeControls({ profiles: [{ name: 'default', account: 'acct' }], active: 'default' });
    const { plain } = await renderApp({ profiles: single.value });
    expect(plain()).not.toContain('[w]');
  });

  it('stays quiet without profile controls', async () => {
    const { plain } = await renderApp();
    expect(plain()).not.toContain('[w]');
  });

  it('shows the notice it is given, such as the confirmation after a switch', async () => {
    const { plain } = await renderApp({ profiles: makeControls().value, notice: '✓ Switched to “private”' });
    expect(plain()).toContain('✓ Switched to “private”');
  });
});
