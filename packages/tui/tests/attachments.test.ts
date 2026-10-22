import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openTodoAttachment } from '../src/attachments.js';

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  open: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({ stat: mocks.stat }));
vi.mock('open', () => ({ default: mocks.open }));

function launcher(code = 0, error?: Error) {
  const process = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  setTimeout(() => {
    if (error) process.emit('error', error);
    process.emit('close', code, null);
  }, 0);
  return process;
}

beforeEach(() => {
  mocks.stat.mockReset().mockResolvedValue({ isFile: () => true, isDirectory: () => false });
  mocks.open.mockReset().mockImplementation(async () => launcher());
});

describe('opening todo references', () => {
  it('opens a web URL without touching the filesystem', async () => {
    await openTodoAttachment('https://example.com/report');
    expect(mocks.open).toHaveBeenCalledWith('https://example.com/report');
    expect(mocks.stat).not.toHaveBeenCalled();
  });

  it('resolves home, relative, file-URL and dash-prefixed paths before passing them to the opener', async () => {
    const absolute = resolve('report with spaces.pdf');
    for (const [value, expected] of [
      ['~/Documents/report.pdf', resolve(homedir(), 'Documents/report.pdf')],
      ['./report with spaces.pdf', absolute],
      [pathToFileURL(absolute).href, absolute],
      ['--args', resolve('--args')],
    ]) {
      await openTodoAttachment(value!);
      expect(mocks.stat).toHaveBeenLastCalledWith(expected);
      expect(mocks.open).toHaveBeenLastCalledWith(expected);
    }
  });

  it('opens directory references too', async () => {
    mocks.stat.mockResolvedValueOnce({ isFile: () => false, isDirectory: () => true });
    await openTodoAttachment('./docs');
    expect(mocks.open).toHaveBeenCalledWith(resolve('docs'));
  });

  it('surfaces missing files and never launches invalid targets', async () => {
    mocks.stat.mockRejectedValueOnce(new Error('File not found'));
    await expect(openTodoAttachment('./missing.pdf')).rejects.toThrow('File not found');
    await expect(openTodoAttachment('javascript:alert(1)')).rejects.toThrow(/support/);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('surfaces errors from the OS opener', async () => {
    mocks.open.mockRejectedValueOnce(new Error('No application'));
    await expect(openTodoAttachment('https://example.com')).rejects.toThrow('No application');
  });

  it('reports launcher exit and spawn failures instead of claiming a successful open', async () => {
    mocks.open.mockImplementationOnce(async () => launcher(7));
    await expect(openTodoAttachment('https://example.com')).rejects.toThrow('opener exited with code 7');
    mocks.open.mockImplementationOnce(async () => launcher(1, new Error('Opener not found')));
    await expect(openTodoAttachment('https://example.com')).rejects.toThrow('Opener not found');
  });
});
