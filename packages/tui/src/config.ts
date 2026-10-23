import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { isExperimentalSource } from '@fomo/core';

/** Config, logs and backups live here. FOMO_CONFIG_DIR moves them off ~/.fomo (tests, a second setup). */
export const CONFIG_DIR = process.env.FOMO_CONFIG_DIR ? resolve(process.env.FOMO_CONFIG_DIR) : join(homedir(), '.fomo');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
/** Backups of the `default` profile; every other profile gets a subfolder (see defaultBackupDir). */
export const DEFAULT_BACKUP_DIR = join(CONFIG_DIR, 'backups');
/** Console and stderr output while the UI is open (scraper errors, Copilot runtime logs). */
export const LOG_FILE = join(CONFIG_DIR, 'fomo.log');
/** Audit trail of every action and error (JSON lines, viewed with `a`). */
export const AUDIT_FILE = join(CONFIG_DIR, 'audit.log');
export const DEFAULT_LINK_DAYS = 365;
export const DEFAULT_DIGEST_MAX_ITEMS = 300;
export const DEFAULT_AUTO_FETCH_MINUTES = 15;
export const MIN_AUTO_FETCH_MINUTES = 5;
export const MAX_AUTO_FETCH_MINUTES = 1440;

export const isAutoFetchMinutes = (n: number): boolean =>
  Number.isInteger(n) && n >= MIN_AUTO_FETCH_MINUTES && n <= MAX_AUTO_FETCH_MINUTES;

/** Minutes between automatic fetches, or undefined when auto-fetch is off. */
export function autoFetchInterval(config: LocalConfig): number | undefined {
  if (config.autoFetch === false) return undefined;
  return config.autoFetchMinutes ?? DEFAULT_AUTO_FETCH_MINUTES;
}

/** One profile's local, per-machine settings, stored in ~/.fomo/config.json (edited from the config screen). */
export interface LocalConfig {
  connectionString?: string;
  /** Static website URL of the web app, used for magic links. */
  webUrl?: string;
  /** Copilot model used for digests. */
  copilotModel?: string;
  /** GitHub account (gh CLI login) whose Copilot access is used; unset uses a token variable, else gh's active account. */
  copilotAccount?: string;
  /** Reader interests that nudge digest importance. */
  interests?: string;
  /** Free-text instructions for how the digest groups updates into topics. */
  groupingHints?: string;
  /** Group new updates with Copilot after each fetch. Default true. */
  autoDigest?: boolean;
  /** Fetch automatically while the TUI is open; false turns it off. Default true. */
  autoFetch?: boolean;
  /** Minutes between automatic fetches (5–1440). Default 15. */
  autoFetchMinutes?: number;
  /** Most updates one digest run sends to Copilot; the rest wait for the next run. Default 300. */
  digestMaxItems?: number;
  /** Magic link validity in days. Default 365. */
  linkDays?: number;
  /** Folder for backups. Default ~/.fomo/backups, or ~/.fomo/backups/<profile> for profiles other than `default`. */
  backupDir?: string;
  /** Experimental sources turned on for this profile (ids from EXPERIMENTAL_SOURCE_INFOS), e.g. Teams meetings. Default none. */
  experimentalSources?: string[];
}

/**
 * Environment variables that override the file, for every profile. The connection string is the exception:
 * the file wins and the variable is only a fallback for profiles that have none.
 */
export const CONFIG_ENV: Partial<Record<keyof LocalConfig, string>> = {
  connectionString: 'AZURE_STORAGE_CONNECTION_STRING',
  webUrl: 'FOMO_WEB_URL',
  copilotModel: 'FOMO_COPILOT_MODEL',
  interests: 'FOMO_INTERESTS',
  groupingHints: 'FOMO_GROUPING_HINTS',
};

// ─── Profiles ────────────────────────────────────────────────────────────────
// A profile is one storage account plus the local settings that go with it (Copilot account,
// interests, backup folder, …). config.json holds all of them:
//   { "activeProfile": "work", "profiles": { "work": { … }, "private": { … } } }
// A file from before profiles is one flat LocalConfig; it is read as the `default` profile.

/** Profile that first-run setup creates and that a pre-profile config file becomes. */
export const DEFAULT_PROFILE = 'default';

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/**
 * Why `name` can't be a profile name, if it can't. `except` is the profile being renamed.
 * Names end up in folder names, flags and the status bar, so the charset is strict.
 */
export function profileNameProblem(name: string, existing: readonly string[] = [], except?: string): string | undefined {
  if (!PROFILE_NAME.test(name)) return 'Use 1–32 letters, digits, “.”, “_” or “-”, starting with a letter or digit';
  // Case-insensitive: the name is also a backup folder and macOS volumes ignore case.
  const clash = existing.find((n) => n !== except && n.toLowerCase() === name.toLowerCase());
  return clash ? `A profile named “${clash}” already exists` : undefined;
}

/** Where a profile's backups go unless its config sets backupDir. */
export const defaultBackupDir = (profile: string): string =>
  profile === DEFAULT_PROFILE ? DEFAULT_BACKUP_DIR : join(DEFAULT_BACKUP_DIR, profile);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function sanitizeProfile(raw: Record<string, unknown>): LocalConfig {
  const out: LocalConfig = {};
  for (const key of ['connectionString', 'webUrl', 'copilotModel', 'copilotAccount', 'interests', 'groupingHints', 'backupDir'] as const) {
    if (typeof raw[key] === 'string' && raw[key]) out[key] = raw[key] as string;
  }
  for (const key of ['autoDigest', 'autoFetch'] as const) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key] as boolean;
  }
  for (const key of ['linkDays', 'digestMaxItems'] as const) {
    if (typeof raw[key] === 'number' && (raw[key] as number) > 0) out[key] = raw[key] as number;
  }
  if (typeof raw.autoFetchMinutes === 'number' && isAutoFetchMinutes(raw.autoFetchMinutes)) out.autoFetchMinutes = raw.autoFetchMinutes;
  if (Array.isArray(raw.experimentalSources)) {
    const ids = [...new Set(raw.experimentalSources.filter((id): id is string => typeof id === 'string' && isExperimentalSource(id)))];
    if (ids.length) out.experimentalSources = ids;
  }
  return out;
}

interface ConfigDoc {
  /** Profile used last; the one opened when no --profile is given. */
  activeProfile?: string;
  /** Never empty: a missing or empty file reads as one empty `default` profile. */
  profiles: Map<string, LocalConfig>;
}

function readDoc(): ConfigDoc {
  const profiles = new Map<string, LocalConfig>();
  let activeProfile: string | undefined;
  if (existsSync(CONFIG_FILE)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) {
      throw new Error(`Failed to parse ${CONFIG_FILE}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!isRecord(raw)) throw new Error(`Failed to parse ${CONFIG_FILE}: expected a JSON object`);
    if (isRecord(raw.profiles)) {
      for (const [name, value] of Object.entries(raw.profiles)) {
        const problem = profileNameProblem(name, [...profiles.keys()]);
        if (problem) throw new Error(`Invalid profile “${name}” in ${CONFIG_FILE}: ${problem}`);
        profiles.set(name, sanitizeProfile(isRecord(value) ? value : {}));
      }
      if (typeof raw.activeProfile === 'string') activeProfile = raw.activeProfile;
    } else {
      profiles.set(DEFAULT_PROFILE, sanitizeProfile(raw));
    }
  }
  if (profiles.size === 0) profiles.set(DEFAULT_PROFILE, {});
  return { activeProfile, profiles };
}

function writeDoc(doc: ConfigDoc): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const out = { activeProfile: doc.activeProfile, profiles: Object.fromEntries(doc.profiles) };
  writeFileSync(CONFIG_FILE, JSON.stringify(out, null, 2), { mode: 0o600 });
}

/** Drop undefined, empty and empty-list values; they mean "unset". */
function compact(config: Partial<LocalConfig>): LocalConfig {
  const out: Record<string, unknown> = { ...config };
  for (const [key, value] of Object.entries(out)) {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) delete out[key];
  }
  return out as LocalConfig;
}

export interface ProfileInfo {
  name: string;
  /** Storage account the profile points at, for display. */
  account?: string;
}

/** Profile names in file order. There is always at least one. */
export function listProfiles(): string[] {
  return [...readDoc().profiles.keys()];
}

/** Profile names with the storage account each one points at. */
export function describeProfiles(): ProfileInfo[] {
  return [...readDoc().profiles].map(([name, config]) => ({
    name,
    account: accountLabel(config.connectionString || process.env.AZURE_STORAGE_CONNECTION_STRING),
  }));
}

/** Which profile to open: the requested one (--profile, FOMO_PROFILE), else the one used last, else the first. */
export function selectProfile(requested?: string): string {
  const { activeProfile, profiles } = readDoc();
  const names = [...profiles.keys()];
  if (requested) {
    const match = names.find((n) => n.toLowerCase() === requested.toLowerCase());
    if (!match) throw new Error(`Unknown profile “${requested}” (have: ${names.join(', ')}). Add one in the app: w, then a.`);
    return match;
  }
  return names.find((n) => n === activeProfile) ?? names[0] ?? DEFAULT_PROFILE;
}

/** Remember `name` as the profile to open next time. */
export function setActiveProfile(name: string): void {
  const doc = readDoc();
  if (!doc.profiles.has(name)) throw new Error(`Unknown profile “${name}”`);
  if (doc.activeProfile === name) return;
  doc.activeProfile = name;
  writeDoc(doc);
}

/** Create a profile. Throws when the name is invalid or taken. */
export function addProfile(name: string, config: Partial<LocalConfig> = {}): void {
  const doc = readDoc();
  const problem = profileNameProblem(name, [...doc.profiles.keys()]);
  if (problem) throw new Error(problem);
  doc.profiles.set(name, compact(config));
  writeDoc(doc);
}

/** Rename a profile in place. Its backups stay visible: the folder is pinned when it was named after the profile. */
export function renameProfile(from: string, to: string): void {
  const doc = readDoc();
  const config = doc.profiles.get(from);
  if (!config) throw new Error(`Unknown profile “${from}”`);
  if (from === to) return;
  const problem = profileNameProblem(to, [...doc.profiles.keys()], from);
  if (problem) throw new Error(problem);
  const moved: LocalConfig =
    config.backupDir || defaultBackupDir(from) === defaultBackupDir(to) ? config : { ...config, backupDir: defaultBackupDir(from) };
  doc.profiles = new Map([...doc.profiles].map(([name, c]) => (name === from ? [to, moved] : [name, c])));
  if (doc.activeProfile === from) doc.activeProfile = to;
  writeDoc(doc);
}

/** Forget a profile's local settings. The storage account and the profile's backup files are left alone. */
export function removeProfile(name: string): void {
  const doc = readDoc();
  if (!doc.profiles.has(name)) throw new Error(`Unknown profile “${name}”`);
  if (doc.profiles.size === 1) throw new Error('Can’t remove the only profile');
  doc.profiles.delete(name);
  if (doc.activeProfile === name) delete doc.activeProfile;
  writeDoc(doc);
}

/** The settings stored for a profile, without environment overrides. */
export function readConfigFile(profile: string): LocalConfig {
  return readDoc().profiles.get(profile) ?? {};
}

/** Which environment variable currently supplies `key`, if any. `file` is the profile's stored config. */
export function envSource(key: keyof LocalConfig, file: LocalConfig): string | undefined {
  const name = CONFIG_ENV[key];
  if (!name || !process.env[name]) return undefined;
  if (key === 'connectionString' && file.connectionString) return undefined;
  return name;
}

/** Effective config of a profile: its file settings merged with environment variables. */
export function loadConfig(profile: string): LocalConfig {
  const file = readConfigFile(profile);
  const env = (key: keyof LocalConfig) => {
    const name = envSource(key, file);
    return name ? process.env[name] : undefined;
  };
  return {
    ...file,
    connectionString: file.connectionString || env('connectionString'),
    webUrl: env('webUrl') || file.webUrl,
    copilotModel: env('copilotModel') || file.copilotModel,
    interests: env('interests') || file.interests,
    groupingHints: env('groupingHints') || file.groupingHints,
  };
}

/** Merge `patch` into a profile's settings (undefined or empty values remove a key) and return its effective config. */
export function saveConfig(profile: string, patch: Partial<LocalConfig>): LocalConfig {
  if (!PROFILE_NAME.test(profile)) throw new Error(`Invalid profile name “${profile}”`);
  const doc = readDoc();
  doc.profiles.set(profile, compact({ ...doc.profiles.get(profile), ...patch }));
  writeDoc(doc);
  return loadConfig(profile);
}

export function maskConnectionString(cs: string): string {
  return cs.replace(/(AccountKey=)[^;]+/i, '$1***').replace(/(SharedAccessSignature=)[^;]+/i, '$1***');
}

/** Storage account a connection string points at, for display. Never includes a key. */
export function accountLabel(cs: string | undefined): string | undefined {
  if (!cs) return undefined;
  if (/^\s*UseDevelopmentStorage\s*=\s*true\s*;?\s*$/i.test(cs)) return 'devstoreaccount1';
  const parts = new Map<string, string>();
  for (const segment of cs.split(';')) {
    const eq = segment.indexOf('=');
    if (eq > 0) parts.set(segment.slice(0, eq).trim().toLowerCase(), segment.slice(eq + 1).trim());
  }
  const name = parts.get('accountname');
  if (name) return name;
  try {
    return new URL(parts.get('tableendpoint') ?? '').hostname.split('.')[0] || undefined;
  } catch {
    return undefined;
  }
}

/** Cheap shape check before handing a connection string to the Azure SDK, whose parse errors are cryptic. */
export function connectionStringProblem(cs: string): string | undefined {
  if (/^\s*UseDevelopmentStorage\s*=\s*true\s*;?\s*$/i.test(cs)) return undefined;
  const keys = new Set(
    cs.split(';').map((s) => s.slice(0, s.indexOf('=')).trim().toLowerCase()).filter(Boolean),
  );
  if (keys.has('tableendpoint') && keys.has('sharedaccesssignature')) return undefined;
  if (keys.has('accountname') && keys.has('accountkey')) return undefined;
  return 'That doesn’t look like a storage connection string (expected AccountName=…;AccountKey=…)';
}

/** Replace the home directory with `~` for display. */
export function tildify(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** Expand a leading `~` to the home directory. */
export function untildify(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
}
