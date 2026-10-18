import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ghAuthToken, listGhAccounts, parseGhAccounts } from '../src/ghAccounts.js';

/** Shape of `gh auth status --json hosts` (gh 2.x); it never includes tokens. */
const STATUS = JSON.stringify({
  hosts: {
    'github.com': [
      { state: 'success', active: true, host: 'github.com', login: 'work-emu', tokenSource: 'keyring', scopes: 'repo', gitProtocol: 'https' },
      { state: 'success', active: false, host: 'github.com', login: 'personal', tokenSource: 'keyring', scopes: 'repo', gitProtocol: 'https' },
    ],
    'ghe.example.com': [{ state: 'success', active: true, host: 'ghe.example.com', login: 'enterprise', tokenSource: 'keyring' }],
  },
});

describe('parseGhAccounts', () => {
  it('lists the accounts for the host and marks the active one', () => {
    expect(parseGhAccounts(STATUS)).toEqual([
      { login: 'work-emu', active: true },
      { login: 'personal', active: false },
    ]);
    expect(parseGhAccounts(STATUS, 'ghe.example.com')).toEqual([{ login: 'enterprise', active: true }]);
  });

  it('returns no accounts when gh has none for the host', () => {
    expect(parseGhAccounts('{"hosts":{}}')).toEqual([]);
    expect(parseGhAccounts(STATUS, 'other.example.com')).toEqual([]);
  });

  it('skips entries without a login and repeated logins', () => {
    const json = JSON.stringify({ hosts: { 'github.com': [{ active: true }, { login: 'a' }, { login: 'a', active: true }, null] } });
    expect(parseGhAccounts(json)).toEqual([{ login: 'a', active: false }]);
  });

  it('throws on output that is not JSON', () => {
    expect(() => parseGhAccounts('You are not logged into any GitHub hosts')).toThrow();
  });
});

describe.skipIf(process.platform === 'win32')('gh CLI calls', () => {
  let dir: string;
  const read = (name: string) => readFileSync(join(dir, name), 'utf8').trim();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fomo-gh-'));
    // Fake gh: records its arguments and any token variable it receives.
    writeFileSync(join(dir, 'gh'), [
      '#!/bin/sh',
      `printf '%s' "$*" > '${dir}/args'`,
      `printf '%s' "\${GH_TOKEN:-}\${GITHUB_TOKEN:-}" > '${dir}/env'`,
      'case "$2" in',
      `  status) printf '%s' '${STATUS}' ;;`,
      '  token) if [ "$4" = "--user=personal" ]; then echo tok-personal; else echo "no oauth token found for github.com account x" >&2; exit 1; fi ;;',
      'esac',
      '',
    ].join('\n'));
    chmodSync(join(dir, 'gh'), 0o755);
    vi.stubEnv('PATH', `${dir}:${process.env['PATH'] ?? ''}`);
    vi.stubEnv('GH_TOKEN', 'env-token');
    vi.stubEnv('GITHUB_TOKEN', 'env-token-2');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists the stored accounts, without passing token variables to gh', async () => {
    await expect(listGhAccounts()).resolves.toEqual([
      { login: 'work-emu', active: true },
      { login: 'personal', active: false },
    ]);
    expect(read('args')).toBe('auth status --json hosts --hostname=github.com');
    expect(read('env')).toBe('');
  });

  it('gets an account token with --user=', async () => {
    await expect(ghAuthToken('personal')).resolves.toBe('tok-personal');
    expect(read('args')).toBe('auth token --hostname=github.com --user=personal');
    expect(read('env')).toBe('');
  });

  it('names the account when gh has no token for it', async () => {
    await expect(ghAuthToken('x')).rejects.toThrow(
      'Copilot account x: gh has no token for it (no oauth token found for github.com account x)',
    );
  });

  it('says so when gh is not installed', async () => {
    vi.stubEnv('PATH', join(dir, 'missing'));
    await expect(listGhAccounts()).rejects.toThrow('GitHub CLI (gh) not found');
    await expect(ghAuthToken('personal')).rejects.toThrow('GitHub CLI (gh) not found');
  });
});
