import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountLabel,
  addProfile,
  CONFIG_DIR,
  CONFIG_FILE,
  connectionStringProblem,
  DEFAULT_BACKUP_DIR,
  defaultBackupDir,
  describeProfiles,
  envSource,
  listProfiles,
  loadConfig,
  maskSecret,
  profileNameProblem,
  readConfigFile,
  removeProfile,
  renameProfile,
  saveConfig,
  selectProfile,
  setActiveProfile,
  youtubeApiKeyProblem,
} from '../src/config.js';

const KEY = 'AccountName=acct;AccountKey=c2VjcmV0;EndpointSuffix=core.windows.net';
const stored = () => JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
const write = (value: unknown) => {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, typeof value === 'string' ? value : JSON.stringify(value));
};

beforeEach(() => {
  rmSync(CONFIG_FILE, { force: true });
  vi.unstubAllEnvs();
});

describe('config folder', () => {
  it('follows FOMO_CONFIG_DIR, which the tests point at a throwaway folder', () => {
    expect(CONFIG_DIR).toBe(resolve(process.env.FOMO_CONFIG_DIR!));
    expect(CONFIG_FILE).toBe(join(CONFIG_DIR, 'config.json'));
    expect(DEFAULT_BACKUP_DIR).toBe(join(CONFIG_DIR, 'backups'));
  });
});

describe('a config file from before profiles', () => {
  const legacy = { connectionString: KEY, interests: 'ai', autoFetchMinutes: 30 };

  it('is the default profile', () => {
    write(legacy);
    expect(listProfiles()).toEqual(['default']);
    expect(selectProfile()).toBe('default');
    expect(readConfigFile('default')).toEqual(legacy);
  });

  it('is rewritten with profiles on the first save, keeping its settings', () => {
    write(legacy);
    saveConfig('default', { interests: 'rust' });
    expect(stored()).toEqual({ profiles: { default: { ...legacy, interests: 'rust' } } });
    expect(listProfiles()).toEqual(['default']);
  });

  it('keeps unknown or malformed values out of the profile', () => {
    write({ connectionString: KEY, linkDays: -3, autoFetch: 'yes', autoFetchMinutes: 1, extra: true });
    expect(readConfigFile('default')).toEqual({ connectionString: KEY });
  });
});

describe('profiles', () => {
  it('has a virtual empty default profile when there is no file or it is empty', () => {
    expect(listProfiles()).toEqual(['default']);
    expect(selectProfile()).toBe('default');
    expect(loadConfig('default').connectionString).toBeUndefined();
    write({});
    expect(listProfiles()).toEqual(['default']);
  });

  it('stores profiles with the one used last, in the order they were added', () => {
    addProfile('work', { connectionString: KEY });
    addProfile('private', { connectionString: 'UseDevelopmentStorage=true' });
    setActiveProfile('private');
    expect(stored()).toEqual({
      activeProfile: 'private',
      profiles: { default: {}, work: { connectionString: KEY }, private: { connectionString: 'UseDevelopmentStorage=true' } },
    });
    expect(listProfiles()).toEqual(['default', 'work', 'private']);
  });

  it('opens the requested profile, else the one used last, else the first', () => {
    saveConfig('default', { connectionString: KEY });
    addProfile('two', { connectionString: KEY });
    expect(selectProfile()).toBe('default');
    setActiveProfile('two');
    expect(selectProfile()).toBe('two');
    expect(selectProfile('default')).toBe('default');
    // The name is matched ignoring case, and the stored spelling is returned
    expect(selectProfile('TWO')).toBe('two');
  });

  it('falls back to the first profile when the one used last is gone', () => {
    write({ activeProfile: 'gone', profiles: { a: {}, b: {} } });
    expect(selectProfile()).toBe('a');
  });

  it('keeps the known experimental sources a profile turned on, once each', () => {
    write({ profiles: { default: { experimentalSources: ['teams-meetings', 'nope', 7, 'teams-meetings'] }, other: { experimentalSources: ['nope'] } } });
    expect(loadConfig('default').experimentalSources).toEqual(['teams-meetings']);
    expect(loadConfig('other').experimentalSources).toBeUndefined();
    // Turning the last one off leaves no empty list behind
    saveConfig('default', { experimentalSources: [] });
    expect(stored().profiles.default).toEqual({});
  });

  it('says which profiles exist when the requested one does not', () => {
    addProfile('work');
    expect(() => selectProfile('nope')).toThrow('Unknown profile “nope” (have: default, work)');
  });

  it('only remembers a profile that exists', () => {
    expect(() => setActiveProfile('nope')).toThrow('Unknown profile “nope”');
  });

  it('checks names for shape and, ignoring case, for clashes', () => {
    expect(profileNameProblem('work')).toBeUndefined();
    expect(profileNameProblem('a.b_c-1')).toBeUndefined();
    for (const bad of ['', ' ', '-x', '.x', 'a b', 'a/b', '../x', 'ä', 'x'.repeat(33)]) {
      expect(profileNameProblem(bad), JSON.stringify(bad)).toContain('Use 1–32 letters');
    }
    expect(profileNameProblem('x'.repeat(32))).toBeUndefined();
    expect(profileNameProblem('WORK', ['work'])).toContain('already exists');
    expect(profileNameProblem('Work', ['work'], 'work')).toBeUndefined();
    expect(() => addProfile('bad name')).toThrow('Use 1–32 letters');
    addProfile('work');
    expect(() => addProfile('Work')).toThrow('A profile named “work” already exists');
  });

  it('refuses a file with a profile name that could not have been created', () => {
    write({ profiles: { 'bad name': {} } });
    expect(() => listProfiles()).toThrow('Invalid profile “bad name”');
    write({ profiles: { a: {}, A: {} } });
    expect(() => listProfiles()).toThrow('already exists');
  });

  it('reports a file it cannot parse', () => {
    write('{ not json');
    expect(() => listProfiles()).toThrow('Failed to parse');
    write('[]');
    expect(() => listProfiles()).toThrow('expected a JSON object');
  });

  it('saves settings per profile and drops emptied ones', () => {
    saveConfig('work', { interests: 'cloud', linkDays: 30 });
    saveConfig('private', { interests: 'games' });
    saveConfig('work', { interests: '', linkDays: undefined });
    expect(readConfigFile('work')).toEqual({});
    expect(readConfigFile('private')).toEqual({ interests: 'games' });
    expect(() => saveConfig('bad name', {})).toThrow('Invalid profile name');
  });

  it('writes the file readable by its owner only', () => {
    saveConfig('work', { connectionString: KEY });
    expect(statSync(CONFIG_FILE).mode & 0o777).toBe(0o600);
  });
});

describe('renaming a profile', () => {
  it('keeps its place and settings, and follows it as the one used last', () => {
    addProfile('a', { interests: 'x' });
    addProfile('b');
    addProfile('c');
    setActiveProfile('b');
    renameProfile('b', 'beta');
    expect(listProfiles()).toEqual(['default', 'a', 'beta', 'c']);
    expect(stored().activeProfile).toBe('beta');
    renameProfile('a', 'alpha');
    expect(readConfigFile('alpha').interests).toBe('x');
  });

  it('pins the backup folder so that existing backups stay visible', () => {
    addProfile('work');
    renameProfile('work', 'job');
    expect(readConfigFile('job').backupDir).toBe(join(DEFAULT_BACKUP_DIR, 'work'));
    // The default profile keeps its backups in the folder itself, which a new name would not
    renameProfile('default', 'main');
    expect(readConfigFile('main').backupDir).toBe(DEFAULT_BACKUP_DIR);
  });

  it('leaves a folder chosen in the config alone', () => {
    addProfile('work', { backupDir: '/somewhere' });
    renameProfile('work', 'job');
    expect(readConfigFile('job').backupDir).toBe('/somewhere');
  });

  it('does not touch the file when the name is unchanged, and refuses bad targets', () => {
    addProfile('work');
    renameProfile('work', 'work');
    expect(readConfigFile('work').backupDir).toBeUndefined();
    expect(() => renameProfile('nope', 'x')).toThrow('Unknown profile “nope”');
    expect(() => renameProfile('work', 'default')).toThrow('already exists');
    expect(() => renameProfile('work', 'a b')).toThrow('Use 1–32 letters');
    // Only the case changes
    renameProfile('work', 'Work');
    expect(listProfiles()).toEqual(['default', 'Work']);
  });
});

describe('removing a profile', () => {
  it('forgets its settings and, when it was the one used last, that choice', () => {
    addProfile('work');
    setActiveProfile('work');
    removeProfile('work');
    expect(listProfiles()).toEqual(['default']);
    expect(stored().activeProfile).toBeUndefined();
  });

  it('keeps the one used last when another profile goes', () => {
    addProfile('a');
    addProfile('b');
    setActiveProfile('a');
    removeProfile('b');
    expect(stored().activeProfile).toBe('a');
  });

  it('refuses to remove the only profile or one that is not there', () => {
    expect(() => removeProfile('default')).toThrow('Can’t remove the only profile');
    expect(() => removeProfile('nope')).toThrow('Unknown profile “nope”');
  });
});

describe('masking secrets', () => {
  it('shows only the last 4 characters of a long one', () => {
    expect(maskSecret('fake-youtube-key-0123456789-abcdefghi-rstu')).toBe('••••rstu');
    expect(maskSecret('short')).toBe('••••');
  });

  it('checks the shape of a YouTube API key', () => {
    expect(youtubeApiKeyProblem('fake-youtube-key-0123456789-abcdefghi-rstu')).toBeUndefined();
    expect(youtubeApiKeyProblem('not a key')).toMatch(/Google API key/);
  });
});

describe('backup folders', () => {
  it('give each profile its own folder, except the default one', () => {
    expect(defaultBackupDir('default')).toBe(DEFAULT_BACKUP_DIR);
    expect(defaultBackupDir('work')).toBe(join(DEFAULT_BACKUP_DIR, 'work'));
  });
});

describe('environment variables', () => {
  it('override the file for every profile', () => {
    saveConfig('a', { webUrl: 'https://a.example', interests: 'file' });
    saveConfig('b', { webUrl: 'https://b.example' });
    vi.stubEnv('FOMO_WEB_URL', 'https://env.example');
    vi.stubEnv('FOMO_INTERESTS', 'env');
    expect(loadConfig('a')).toMatchObject({ webUrl: 'https://env.example', interests: 'env' });
    expect(loadConfig('b').webUrl).toBe('https://env.example');
    expect(envSource('webUrl', readConfigFile('a'))).toBe('FOMO_WEB_URL');
    expect(envSource('backupDir', {})).toBeUndefined();
  });

  it('only stand in for the connection string of a profile that has none', () => {
    saveConfig('has', { connectionString: KEY });
    saveConfig('lacks', {});
    vi.stubEnv('AZURE_STORAGE_CONNECTION_STRING', 'UseDevelopmentStorage=true');
    expect(loadConfig('has').connectionString).toBe(KEY);
    expect(loadConfig('lacks').connectionString).toBe('UseDevelopmentStorage=true');
    expect(envSource('connectionString', readConfigFile('has'))).toBeUndefined();
    expect(envSource('connectionString', readConfigFile('lacks'))).toBe('AZURE_STORAGE_CONNECTION_STRING');
  });

  it('supply the YouTube API key without changing the file', () => {
    saveConfig('a', { youtubeApiKey: 'file-key' });
    vi.stubEnv('FOMO_YOUTUBE_API_KEY', 'env-key');
    expect(loadConfig('a').youtubeApiKey).toBe('env-key');
    expect(loadConfig('b').youtubeApiKey).toBe('env-key');
    expect(envSource('youtubeApiKey', readConfigFile('a'))).toBe('FOMO_YOUTUBE_API_KEY');
    expect(readConfigFile('a').youtubeApiKey).toBe('file-key');
  });

  it('ignore an empty value', () => {
    saveConfig('a', { interests: 'file' });
    vi.stubEnv('FOMO_INTERESTS', '');
    expect(loadConfig('a').interests).toBe('file');
  });
});

describe('describing profiles', () => {
  it('names the storage account of each one, without its key', () => {
    addProfile('work', { connectionString: KEY });
    addProfile('dev', { connectionString: 'UseDevelopmentStorage=true' });
    const profiles = describeProfiles();
    expect(profiles).toEqual([
      { name: 'default', account: undefined },
      { name: 'work', account: 'acct' },
      { name: 'dev', account: 'devstoreaccount1' },
    ]);
    expect(JSON.stringify(profiles)).not.toContain('c2VjcmV0');
  });

  it('counts the environment variable for a profile without a connection string', () => {
    vi.stubEnv('AZURE_STORAGE_CONNECTION_STRING', KEY);
    expect(describeProfiles()).toEqual([{ name: 'default', account: 'acct' }]);
  });

  it('reads the account from a connection string of any shape', () => {
    expect(accountLabel(undefined)).toBeUndefined();
    expect(accountLabel('')).toBeUndefined();
    expect(accountLabel(KEY)).toBe('acct');
    expect(accountLabel('  UseDevelopmentStorage=true; ')).toBe('devstoreaccount1');
    expect(accountLabel('TableEndpoint=https://fomo42.table.core.windows.net/;SharedAccessSignature=sv=1&sig=zzz')).toBe('fomo42');
    expect(accountLabel('nonsense')).toBeUndefined();
  });
});

describe('connectionStringProblem', () => {
  it('accepts the shapes the Azure SDK takes and rejects the rest', () => {
    expect(connectionStringProblem(KEY)).toBeUndefined();
    expect(connectionStringProblem('UseDevelopmentStorage=true')).toBeUndefined();
    expect(connectionStringProblem('TableEndpoint=https://a.table.core.windows.net;SharedAccessSignature=sv=1')).toBeUndefined();
    expect(connectionStringProblem('AccountName=a')).toContain('doesn’t look like a storage connection string');
    expect(connectionStringProblem('hello')).toContain('doesn’t look like a storage connection string');
  });
});
