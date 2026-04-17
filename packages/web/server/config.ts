import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Web server configuration — all values from environment variables.
 * Fail fast if required vars are missing.
 */
function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function loadAllowedUsers(filePath: string): Set<string> {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const emails = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    return new Set(emails.map((e) => e.toLowerCase()));
  } catch {
    console.warn(`⚠ Could not read allowed users file: ${filePath}`);
    return new Set();
  }
}

const allowedUsersFile = resolve(process.env['ALLOWED_USERS_FILE'] ?? '.allowed_users.txt');

export const config = {
  port: Number(process.env['PORT'] ?? 3000),

  storageConnectionString: required('AZURE_STORAGE_CONNECTION_STRING'),

  /** Google OAuth 2.0 credentials */
  googleClientId: required('GOOGLE_CLIENT_ID'),
  googleClientSecret: required('GOOGLE_CLIENT_SECRET'),

  /** Secret for signing session cookies (HMAC-SHA256) */
  sessionSecret: required('SESSION_SECRET'),

  /** Set of lowercase email addresses allowed to log in */
  allowedUsers: loadAllowedUsers(allowedUsersFile),

  /** Session cookie max age in seconds (30 days) */
  sessionMaxAge: 30 * 24 * 60 * 60,
} as const;
