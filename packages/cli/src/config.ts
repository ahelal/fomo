import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_COPILOT_MODEL } from './copilot.js';

const CONFIG_DIR = join(homedir(), '.fomo');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface CliConfig {
  connectionString: string;
  /** Static website URL of the web app (used by `fomo link`). */
  webUrl?: string;
  /** Model used by `fomo digest`. */
  copilotModel?: string;
  /** Optional reader interests that nudge digest importance. */
  interests?: string;
}

function readConfigFile(): Partial<CliConfig> {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Record<string, unknown>;
    const out: Partial<CliConfig> = {};
    if (typeof raw.connectionString === 'string') out.connectionString = raw.connectionString;
    if (typeof raw.webUrl === 'string') out.webUrl = raw.webUrl;
    if (typeof raw.copilotModel === 'string') out.copilotModel = raw.copilotModel;
    if (typeof raw.interests === 'string') out.interests = raw.interests;
    return out;
  } catch (err) {
    console.error(`Failed to parse ${CONFIG_FILE}:`, err);
    process.exit(1);
  }
}

/**
 * Load config from ~/.fomo/config.json.
 * The connection string falls back to AZURE_STORAGE_CONNECTION_STRING;
 * FOMO_WEB_URL, FOMO_COPILOT_MODEL and FOMO_INTERESTS override the file.
 */
export function loadConfig(): CliConfig {
  const file = readConfigFile();
  const connectionString = file.connectionString || process.env['AZURE_STORAGE_CONNECTION_STRING'];
  if (!connectionString) {
    console.error(
      'No config found.\n' +
        'Run: fomo config set --connection-string <connection-string>\n' +
        'Or set AZURE_STORAGE_CONNECTION_STRING environment variable.',
    );
    process.exit(1);
  }
  return {
    connectionString,
    webUrl: process.env['FOMO_WEB_URL'] || file.webUrl,
    copilotModel: process.env['FOMO_COPILOT_MODEL'] || file.copilotModel,
    interests: process.env['FOMO_INTERESTS'] || file.interests,
  };
}

/** Merge `patch` into the saved config file. */
export function saveConfig(patch: Partial<CliConfig>): void {
  const next = { ...readConfigFile(), ...patch };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined || value === '') delete (next as Record<string, unknown>)[key];
  }
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  console.log(`Config saved to ${CONFIG_FILE}`);
}

function mask(cs: string): string {
  return cs.replace(/(AccountKey=)[^;]+/i, '$1***').replace(/(SharedAccessSignature=)[^;]+/i, '$1***');
}

export function printConfig(): void {
  const file = readConfigFile();
  if (!existsSync(CONFIG_FILE)) {
    console.log('No config file found. Run: fomo config set --connection-string <connection-string>');
  }
  const envCs = process.env['AZURE_STORAGE_CONNECTION_STRING'];
  const cs = file.connectionString || envCs;
  console.log(`Connection String : ${cs ? mask(cs) : '(not set)'}${!file.connectionString && envCs ? '  [env]' : ''}`);
  console.log(`Web URL           : ${process.env['FOMO_WEB_URL'] || file.webUrl || '(not set)'}`);
  console.log(
    `Copilot model     : ${process.env['FOMO_COPILOT_MODEL'] || file.copilotModel || `${DEFAULT_COPILOT_MODEL} (default)`}`,
  );
  console.log(`Interests         : ${process.env['FOMO_INTERESTS'] || file.interests || '(not set)'}`);
}
