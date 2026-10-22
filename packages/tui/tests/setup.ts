import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// src/config.ts reads FOMO_CONFIG_DIR when it is first imported, so it is set here, before any test
// imports it (and without importing src/config.ts itself). Config, logs, backups and Copilot state of
// every test file go to a throwaway folder instead of the real ~/.fomo.
const dir = mkdtempSync(join(tmpdir(), 'fomo-tui-test-'));
process.env.FOMO_CONFIG_DIR = dir;

// Variables that change which profile or settings are used must not leak in from the developer's shell.
for (const name of [
  'AZURE_STORAGE_CONNECTION_STRING',
  'FOMO_PROFILE',
  'FOMO_WEB_URL',
  'FOMO_COPILOT_MODEL',
  'FOMO_INTERESTS',
  'FOMO_GROUPING_HINTS',
]) delete process.env[name];

afterAll(() => rmSync(dir, { recursive: true, force: true }));
