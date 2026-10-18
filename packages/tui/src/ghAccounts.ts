import { execFile } from 'node:child_process';

/** An account signed in to the GitHub CLI (`gh auth login`). */
export interface GhAccount {
  login: string;
  /** The account gh uses by default (`gh auth switch` changes it). */
  active: boolean;
}

const GH_TIMEOUT_MS = 15_000;

/** gh's environment without token variables, so it works with its stored accounts instead. */
function ghEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[name];
  return env;
}

/** Runs gh without a shell; a non-zero exit still resolves so callers can read its output. */
function runGh(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { env: ghEnv(), timeout: GH_TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
      if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
        reject(new Error('GitHub CLI (gh) not found — install it and run gh auth login'));
      } else if (err?.killed) {
        reject(new Error(`gh ${args[0]} ${args[1]} timed out`));
      } else {
        resolve({ stdout: String(stdout), stderr: String(stderr).trim() });
      }
    });
  });
}

/** Accounts for `host` in `gh auth status --json hosts` output. */
export function parseGhAccounts(json: string, host = 'github.com'): GhAccount[] {
  const data = JSON.parse(json) as { hosts?: Record<string, Array<{ login?: unknown; active?: unknown }> | undefined> };
  const accounts: GhAccount[] = [];
  for (const entry of data.hosts?.[host] ?? []) {
    if (typeof entry?.login !== 'string' || !entry.login || accounts.some((a) => a.login === entry.login)) continue;
    accounts.push({ login: entry.login, active: entry.active === true });
  }
  return accounts;
}

/** Accounts signed in to gh for `host` (none when gh has no account there). */
export async function listGhAccounts(host = 'github.com'): Promise<GhAccount[]> {
  const { stdout, stderr } = await runGh(['auth', 'status', '--json', 'hosts', `--hostname=${host}`]);
  try {
    return parseGhAccounts(stdout, host);
  } catch {
    throw new Error(`gh auth status failed${stderr ? `: ${stderr}` : ''}`);
  }
}

/** The gh token stored for `login` on `host`. */
export async function ghAuthToken(login: string, host = 'github.com'): Promise<string> {
  const { stdout, stderr } = await runGh(['auth', 'token', `--hostname=${host}`, `--user=${login}`]);
  const token = stdout.trim();
  if (!token) {
    throw new Error(`Copilot account ${login}: gh has no token for it (${stderr || 'empty output'}) — run gh auth login, or pick another account in Config`);
  }
  return token;
}
