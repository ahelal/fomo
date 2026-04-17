import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.fomo');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface CliConfig {
  connectionString: string;
}

/**
 * Load config from ~/.fomo/config.json.
 * Falls back to AZURE_STORAGE_CONNECTION_STRING env var.
 */
export function loadConfig(): CliConfig {
  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Record<string, unknown>;
      if (typeof raw.connectionString === 'string') {
        return raw as unknown as CliConfig;
      }
      // Old config format detected — fall through to env var
    } catch (err) {
      console.error(`Failed to parse ${CONFIG_FILE}:`, err);
      process.exit(1);
    }
  }

  const connectionString = process.env['AZURE_STORAGE_CONNECTION_STRING'];

  if (connectionString) return { connectionString };

  console.error(
    'No config found.\n' +
      'Run: fomo config set --connection-string <connection-string>\n' +
      'Or set AZURE_STORAGE_CONNECTION_STRING environment variable.',
  );
  process.exit(1);
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  console.log(`Config saved to ${CONFIG_FILE}`);
}

export function printConfig(): void {
  if (!existsSync(CONFIG_FILE)) {
    console.log('No config file found. Run: fomo config set --connection-string <connection-string>');
    return;
  }
  const cfg = loadConfig();
  const cs = cfg.connectionString;
  const masked = cs.length > 20 ? cs.slice(0, 20) + '***' : '***';
  console.log(`Connection String : ${masked}`);
}
