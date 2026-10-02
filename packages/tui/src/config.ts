import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR = join(homedir(), '.fomo');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const DEFAULT_BACKUP_DIR = join(CONFIG_DIR, 'backups');
export const DEFAULT_LINK_DAYS = 365;
export const DEFAULT_DIGEST_MAX_ITEMS = 300;

/** Local, per-machine settings stored in ~/.fomo/config.json (edited from the config screen). */
export interface LocalConfig {
  connectionString?: string;
  /** Static website URL of the web app, used for magic links. */
  webUrl?: string;
  /** Copilot model used for digests. */
  copilotModel?: string;
  /** Reader interests that nudge digest importance. */
  interests?: string;
  /** Group new updates with Copilot after each fetch. Default true. */
  autoDigest?: boolean;
  /** Most unread updates one digest run sends to Copilot; the rest wait for the next run. Default 300. */
  digestMaxItems?: number;
  /** Magic link validity in days. Default 365. */
  linkDays?: number;
  /** Folder for backups. Default ~/.fomo/backups. */
  backupDir?: string;
}

/**
 * Environment variables that override the file. The connection string is the exception:
 * the file wins and the variable is only a fallback.
 */
export const CONFIG_ENV: Partial<Record<keyof LocalConfig, string>> = {
  connectionString: 'AZURE_STORAGE_CONNECTION_STRING',
  webUrl: 'FOMO_WEB_URL',
  copilotModel: 'FOMO_COPILOT_MODEL',
  interests: 'FOMO_INTERESTS',
};

export function readConfigFile(): LocalConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to parse ${CONFIG_FILE}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const out: LocalConfig = {};
  for (const key of ['connectionString', 'webUrl', 'copilotModel', 'interests', 'backupDir'] as const) {
    if (typeof raw[key] === 'string' && raw[key]) out[key] = raw[key] as string;
  }
  if (typeof raw.autoDigest === 'boolean') out.autoDigest = raw.autoDigest;
  for (const key of ['linkDays', 'digestMaxItems'] as const) {
    if (typeof raw[key] === 'number' && (raw[key] as number) > 0) out[key] = raw[key] as number;
  }
  return out;
}

/** Which environment variable currently supplies `key`, if any. */
export function envSource(key: keyof LocalConfig, file: LocalConfig = readConfigFile()): string | undefined {
  const name = CONFIG_ENV[key];
  if (!name || !process.env[name]) return undefined;
  if (key === 'connectionString' && file.connectionString) return undefined;
  return name;
}

/** Effective config: the file merged with environment variables. */
export function loadConfig(): LocalConfig {
  const file = readConfigFile();
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
  };
}

/** Merge `patch` into the config file (undefined or empty values remove a key) and return the effective config. */
export function saveConfig(patch: Partial<LocalConfig>): LocalConfig {
  const next: Record<string, unknown> = { ...readConfigFile(), ...patch };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined || value === '') delete next[key];
  }
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return loadConfig();
}

export function maskConnectionString(cs: string): string {
  return cs.replace(/(AccountKey=)[^;]+/i, '$1***').replace(/(SharedAccessSignature=)[^;]+/i, '$1***');
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
